import "server-only";
import { env } from "@/lib/env";
import { enforceKind } from "@/lib/pipeline/compliance";
import { checkDuplicates } from "@/lib/pipeline/duplicates";
import { IDENTIFY_SYSTEM, identifyPrompt } from "@/lib/pipeline/prompts";
import { readReference, webResearch } from "@/lib/pipeline/research";
import { selectImages } from "@/lib/pipeline/select-images";
import {
  resolveDecision,
  type SyncDecision,
  SyncRejectedError,
  storeChanged,
  syncToCatalog,
} from "@/lib/pipeline/sync";
import { writeListing } from "@/lib/pipeline/write";
import { getProviders, type Providers } from "@/lib/providers";
import { MATCH_THRESHOLD } from "@/lib/text/similarity";
import { IdentitySchema, type Job, type Source, type StepKey } from "@/lib/types";
import { type ClassifiedError, classifyError } from "./errors";
import { bootId, createJob, getJob, isStale, listJobs, mediaDir, setStep, updateJob } from "./store";

// =============================================================================
// Pipeline orchestration
// =============================================================================
// reference -> identify -> research -> write -> images -> duplicates -> ready
// Each step updates the job file, so the UI can show live progress and the
// history keeps a full audit trail. Only one pipeline runs per job, and at
// most STUDIO_MAX_CONCURRENT_JOBS run at the same time (the rest wait in line,
// protecting the paid AI/search quotas).

type RunnerState = {
  running: Set<string>;
  active: number;
  waiting: Array<() => void>;
  retries: Map<string, Promise<{ id: string; created: boolean } | null>>;
  recentStarts: number[];
  /** Tail of the sync queue: one store write at a time (see withSyncLock). */
  syncLock: Promise<void>;
};

const STATE_KEY = Symbol.for("mimos.studio.runner");

function state(): RunnerState {
  const g = globalThis as unknown as Record<symbol, RunnerState | undefined>;
  g[STATE_KEY] ??= {
    running: new Set(),
    active: 0,
    waiting: [],
    retries: new Map(),
    recentStarts: [],
    syncLock: Promise.resolve(),
  };
  return g[STATE_KEY];
}

const syncKey = (jobId: string) => `sync:${jobId}`;

/** The request cannot be applied in the job's current state (HTTP 409). */
export class JobConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobConflictError";
  }
}

/** The sync failed for a technical reason (network, store, credentials): HTTP 502 with advice. */
export class SyncFailedError extends Error {
  constructor(readonly classified: ClassifiedError) {
    super(classified.message);
    this.name = "SyncFailedError";
  }
}

/** Thrown between steps when the operator discarded the job: stop spending AI/search quota. */
class CancelledError extends Error {
  constructor() {
    super("Cadastro descartado pelo operador.");
    this.name = "CancelledError";
  }
}

export function isActive(jobId: string) {
  const { running } = state();
  return running.has(jobId) || running.has(syncKey(jobId));
}

/** True when a new registration may start now (simple per-minute budget for the whole app). */
export function takeStartSlot(): boolean {
  const s = state();
  const minuteAgo = Date.now() - 60_000;
  s.recentStarts = s.recentStarts.filter((t) => t > minuteAgo);
  if (s.recentStarts.length >= env().STUDIO_MAX_JOBS_PER_MINUTE) return false;
  s.recentStarts.push(Date.now());
  return true;
}

async function acquireSlot(onWait: () => Promise<unknown>): Promise<() => void> {
  const s = state();
  const max = env().STUDIO_MAX_CONCURRENT_JOBS;
  if (s.active >= max) {
    await onWait();
    await new Promise<void>((resolve) => s.waiting.push(resolve));
  }
  s.active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    s.active--;
    s.waiting.shift()?.();
  };
}

/** Mark jobs interrupted by a restart (or hung) so the operator can retry them. */
export async function reconcile(job: Job): Promise<Job> {
  if (!isStale(job, isActive(job.id))) return job;
  return updateJob(job.id, (j) => {
    if (!isStale(j, isActive(j.id))) return;
    const wasSyncing = j.status === "syncing";
    j.status = wasSyncing && j.draft ? "ready" : "failed";
    j.errorCode = "interrupted";
    j.errorDetail = null;
    j.error = wasSyncing
      ? "A sincronização foi interrompida. Sincronize de novo: o sistema confere a loja antes e não duplica o produto."
      : "O processamento foi interrompido (o servidor reiniciou ou travou).";
    for (const s of j.steps) if (s.status === "running") s.status = "failed";
  });
}

export async function listJobsReconciled(limit: number): Promise<Job[]> {
  return Promise.all((await listJobs(limit)).map(reconcile));
}

async function logUsage(jobId: string, provider: string, operation: string, detail: string) {
  await updateJob(jobId, (job) => {
    job.usage.push({ provider, operation, detail });
  });
}

async function step<T>(jobId: string, key: StepKey, fn: () => Promise<{ value: T; detail: string }>): Promise<T> {
  const current = await getJob(jobId);
  if (!current || !stillRunning(current)) throw new CancelledError();
  await setStep(jobId, key, "running");
  try {
    const { value, detail } = await fn();
    await setStep(jobId, key, "done", detail);
    return value;
  } catch (error) {
    await setStep(jobId, key, "failed", classifyError(error).message).catch(() => undefined);
    throw error;
  }
}

/** Only a job still marked "running" may move on (the operator may have discarded it meanwhile). */
function stillRunning(j: Job) {
  return j.status === "running";
}

export async function runPipeline(jobId: string, injected?: Providers): Promise<void> {
  const { running } = state();
  if (running.has(jobId)) return;
  running.add(jobId);
  let release: (() => void) | null = null;
  try {
    const job = await getJob(jobId);
    if (!job || !stillRunning(job)) return;
    await updateJob(jobId, (j) => {
      j.bootId = bootId();
    });

    release = await acquireSlot(() =>
      setStep(jobId, "reference", "pending", "Na fila: outro cadastro está sendo pesquisado. Começa em seguida."),
    );
    const e = env();
    const providers = injected ?? getProviders();
    const { input } = job;
    const { llm, research, catalog } = providers;
    const log = (l: { provider: string; operation: string; detail: string }) =>
      void logUsage(jobId, l.provider, l.operation, l.detail).catch(() => undefined);

    // 1. Reference page -----------------------------------------------------------
    const reference = await step(jobId, "reference", async () => {
      const hit = await readReference(input.referenceUrl, research, log);
      return {
        value: hit,
        detail: hit
          ? `Página lida: ${hit.title.slice(0, 80)}`
          : "Não foi possível ler o link. Seguindo com o nome do produto.",
      };
    });

    // 2. Identify -------------------------------------------------------------------
    const referenceSource: Source | null = reference
      ? {
          id: "S1",
          url: reference.url,
          title: reference.title,
          domain: new URL(reference.url).hostname,
          origin: "reference",
          text: reference.text,
          images: reference.images,
        }
      : null;
    const identity = await step(jobId, "identify", async () => {
      const result = await llm.generateJson({
        operation: "identify",
        system: IDENTIFY_SYSTEM,
        prompt: identifyPrompt(input, referenceSource),
        schema: IdentitySchema,
        thinking: "low",
      });
      log({ provider: llm.name, operation: "identify", detail: result.usage });
      // The 18+ rule never depends on the model's classification alone.
      const data = enforceKind(result.data, input.productName);
      const label = [data.productType, data.brand, data.line, data.variant, data.netContent].filter(Boolean).join(" ");
      return {
        value: data,
        detail: `${label} (confiança ${data.confidence === "high" ? "alta" : data.confidence === "medium" ? "média" : "baixa"})`,
      };
    });
    await updateJob(jobId, (j) => {
      j.identity = identity;
    });

    // 3. Research -----------------------------------------------------------------
    const sources = await step(jobId, "research", async () => {
      const value = await webResearch({
        identity,
        reference,
        providers: research,
        maxSources: e.RESEARCH_MAX_SOURCES,
        log,
      });
      return {
        value,
        detail: `${value.length} fontes relevantes (${[...new Set(value.map((s) => s.domain))].slice(0, 4).join(", ")})`,
      };
    });
    await updateJob(jobId, (j) => {
      j.sources = sources;
    });

    // 4. Write ----------------------------------------------------------------------
    // Categories come from the store; failing here fails closed (no guessed category ids).
    const categories = await catalog.listCategories();
    const written = await step(jobId, "write", async () => {
      const { draft, usage, notes } = await writeListing({
        input,
        identity,
        sources,
        categories,
        llm,
        options: { storeName: e.STORE_NAME, titleMaxChars: e.TITLE_MAX_CHARS },
      });
      log({ provider: llm.name, operation: "write", detail: usage });
      for (const note of notes) log({ provider: "verify", operation: "write", detail: note });
      const verified = draft.facts.filter((f) => f.verified).length;
      return {
        value: draft,
        detail: `${verified} informações confirmadas nas fontes, ${draft.facts.length - verified} descartadas`,
      };
    });
    // Keep the (paid) text even if a later step fails.
    await updateJob(jobId, (j) => {
      j.draft = { ...written, images: [], complete: false };
    });

    // 5. Images ---------------------------------------------------------------------
    const images = await step(jobId, "images", async () => {
      const { images: value, usage } = await selectImages({
        identity,
        sources,
        llm,
        visionModel: providers.visionModel,
        fetchImage: providers.fetchImage,
        options: {
          size: e.IMAGE_SIZE,
          quality: e.IMAGE_QUALITY,
          maxCount: e.IMAGE_MAX_COUNT,
          maxBytes: e.IMAGE_MAX_BYTES,
          minSide: 500,
          outputDir: mediaDir(jobId),
          slug: written.slug,
          title: written.title,
        },
        log: (detail) => log({ provider: "images", operation: "select", detail }),
      });
      if (usage) log({ provider: llm.name, operation: "images", detail: usage });
      return {
        value,
        detail: value.length
          ? `${value.length} imagens tratadas em WebP ${e.IMAGE_SIZE}x${e.IMAGE_SIZE}`
          : "Nenhuma imagem confiável encontrada",
      };
    });

    const missing = [...written.missing];
    if (!images.length) {
      missing.unshift({
        field: "photos",
        label: "Foto do produto",
        severity: "blocker",
        why: "Nenhuma foto confiável do produto exato foi encontrada.",
      });
    }
    const draft = {
      ...written,
      images,
      missing,
      complete: !missing.some((m) => m.severity === "blocker"),
    };
    await updateJob(jobId, (j) => {
      j.draft = draft;
    });

    // 6. Duplicates -----------------------------------------------------------------
    const duplicates = await step(jobId, "duplicates", async () => {
      const value = await checkDuplicates({ catalog, identity, draft, typedName: input.productName });
      const detail =
        value.verdict === "match"
          ? `Já existe na loja: ${value.candidates[0].name} (ID ${value.candidates[0].id})`
          : value.verdict === "possible"
            ? `${value.candidates.length} produto(s) parecido(s) na loja`
            : "Nenhum produto igual na loja";
      return { value, detail };
    });

    await updateJob(jobId, (j) => {
      j.duplicates = duplicates;
      if (stillRunning(j)) j.status = "ready";
    });
  } catch (error) {
    if (error instanceof CancelledError) return;
    const c = classifyError(error);
    await updateJob(jobId, (j) => {
      for (const s of j.steps) if (s.status === "running") s.status = "failed";
      if (!stillRunning(j)) return;
      j.status = "failed";
      j.error = c.message;
      j.errorCode = c.code;
      j.errorDetail = c.detail;
    }).catch(() => undefined);
  } finally {
    release?.();
    running.delete(jobId);
  }
}

// =============================================================================
// Retry and discard
// =============================================================================

/**
 * "Gerar de novo": a new job with the same input; the previous one is kept in
 * the history as superseded. Idempotent: a double click returns the same job.
 */
export function retryJob(id: string): Promise<{ id: string; created: boolean } | null> {
  const { retries } = state();
  const inflight = retries.get(id);
  if (inflight) return inflight;
  // Registered synchronously, before any await, so a double click shares this promise.
  const work = (async () => {
    const previous = await getJob(id);
    if (!previous) return null;
    if (previous.supersededBy) return { id: previous.supersededBy, created: false };
    if (previous.status === "running" || previous.status === "syncing" || isActive(id)) {
      throw new JobConflictError("Este cadastro ainda está em andamento. Aguarde terminar.");
    }
    if (previous.status === "synced") {
      throw new JobConflictError("Este cadastro já foi sincronizado. Para outra entrada de estoque, comece um novo.");
    }
    const job = await createJob(previous.input);
    await updateJob(id, (j) => {
      j.status = "superseded";
      j.supersededBy = job.id;
    });
    return { id: job.id, created: true };
  })();
  retries.set(id, work);
  const cleanup = () => {
    if (retries.get(id) === work) retries.delete(id);
  };
  work.then(cleanup, cleanup);
  return work;
}

export async function discardJob(id: string): Promise<Job | null> {
  const job = await getJob(id);
  if (!job) return null;
  if (job.status === "discarded") return job;
  if (job.status === "syncing" || state().running.has(syncKey(id))) {
    throw new JobConflictError("A sincronização está em andamento. Aguarde terminar.");
  }
  if (job.status === "synced") throw new JobConflictError("Um cadastro já sincronizado não pode ser descartado.");
  if (job.status === "superseded") throw new JobConflictError("Este cadastro já foi substituído por outro.");
  return updateJob(id, (j) => {
    if (j.status === "syncing" || j.status === "synced") return;
    j.status = "discarded";
  });
}

// =============================================================================
// Sync
// =============================================================================

const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|[a-z0-9-]+\.(?:localhost|local|test))(:\d+)?$/i;

/**
 * Syncs run one at a time. Two operators syncing the same new product at the
 * same moment would otherwise both pass the duplicate re-check and create it
 * twice; serialised, the second re-check sees the first product.
 */
async function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  const s = state();
  const previous = s.syncLock;
  let release = () => {};
  s.syncLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Mock mode invents content from fixtures: it must never write to a real store. */
function assertMockSafe(providers: Providers) {
  const e = env();
  if (e.STUDIO_PROVIDERS !== "mock" || providers.catalog.name !== "woocommerce") return;
  const host = new URL(providers.catalog.baseUrl).host;
  if (!LOCAL_HOST.test(host)) {
    throw new SyncRejectedError(
      `O sistema está em modo de demonstração (STUDIO_PROVIDERS=mock) e não envia conteúdo de teste para a loja real (${host}).`,
    );
  }
}

export async function runSync(jobId: string, requested: SyncDecision, injected?: Providers): Promise<Job> {
  const { running } = state();
  const job = await getJob(jobId);
  if (!job) throw new SyncRejectedError("Cadastro não encontrado.");
  if (job.status === "synced" && job.sync) return job;
  if (job.status === "superseded") throw new SyncRejectedError("Este cadastro foi substituído por um mais novo.");
  if (job.status === "discarded") throw new SyncRejectedError("Este cadastro foi descartado.");
  if (job.status !== "ready") throw new SyncRejectedError("O cadastro ainda não está pronto para sincronizar.");
  if (!job.draft || !job.identity || !job.duplicates) {
    throw new SyncRejectedError("O cadastro está incompleto. Clique em “Gerar de novo”.");
  }
  resolveDecision(job, requested); // cheap early answer for an invalid choice

  const key = syncKey(jobId);
  if (running.has(key)) throw new SyncRejectedError("A sincronização já está em andamento.");
  running.add(key);
  try {
    return await withSyncLock(() => syncLocked(jobId, requested, injected));
  } catch (error) {
    const c = classifyError(error);
    await setStep(jobId, "sync", "failed", c.message).catch(() => undefined);
    await updateJob(jobId, (j) => {
      if (j.status !== "syncing") return;
      j.status = "ready";
      j.error = c.message;
      j.errorCode = c.code;
      j.errorDetail = c.detail;
    }).catch(() => undefined);
    if (error instanceof SyncRejectedError) throw error;
    throw new SyncFailedError(c);
  } finally {
    running.delete(key);
  }
}

async function syncLocked(jobId: string, requested: SyncDecision, injected?: Providers): Promise<Job> {
  // Re-read after waiting for the lock: the job may have changed meanwhile.
  const job = await getJob(jobId);
  if (job?.status !== "ready" || !job.draft || !job.identity || !job.duplicates) {
    throw new SyncRejectedError("O cadastro mudou enquanto aguardava a vez. Confira de novo.");
  }
  await updateJob(jobId, (j) => {
    j.status = "syncing";
    j.error = null;
    j.errorCode = null;
    j.errorDetail = null;
    j.bootId = bootId();
  });
  await setStep(jobId, "sync", "running", "Conferindo a loja de novo antes de gravar");

  const providers = injected ?? getProviders();
  assertMockSafe(providers);

  // The store may have changed since the operator reviewed the duplicates.
  const fresh = await checkDuplicates({
    catalog: providers.catalog,
    identity: job.identity,
    draft: job.draft,
    typedName: job.input.productName,
  });
  const changed = storeChanged(job.duplicates, fresh, requested);
  if (changed) {
    await updateJob(jobId, (j) => {
      j.duplicates = fresh;
    });
    throw new SyncRejectedError(`${changed} A revisão foi atualizada: confira e sincronize de novo.`);
  }
  const decision = resolveDecision({ duplicates: fresh }, requested);

  const e = env();
  const current = (await getJob(jobId)) as Job;
  const result = await syncToCatalog({
    job: current,
    decision,
    catalog: providers.catalog,
    settings: {
      statusWhenComplete: e.WC_STATUS_WHEN_COMPLETE,
      statusWhenIncomplete: e.WC_STATUS_WHEN_INCOMPLETE,
      seoPlugin: e.SEO_PLUGIN,
      mediaDir: mediaDir(jobId),
    },
    rememberMedia: async (fileName, mediaId) => {
      await updateJob(jobId, (j) => {
        j.syncMedia[fileName] = mediaId;
      });
    },
  });
  await setStep(
    jobId,
    "sync",
    "done",
    result.mode === "create" ? `Produto criado (ID ${result.productId})` : `Produto ${result.productId} atualizado`,
  );
  const synced = await updateJob(jobId, (j) => {
    j.sync = result;
    j.status = "synced";
    j.duplicates = fresh;
  });
  await supersedeSiblings(synced);
  return synced;
}

/**
 * Older reviewed registrations of the same product are now stale (their stock
 * count and duplicate check predate this sync): take them out of the queue.
 */
async function supersedeSiblings(synced: Job) {
  const sku = synced.draft?.sku;
  const productId = synced.sync?.productId;
  const jobs = await listJobs(300).catch(() => []);
  for (const other of jobs) {
    if (other.id === synced.id || other.status !== "ready" || isActive(other.id)) continue;
    // Only OLDER registrations are stale; a newer one may carry a newer stock count.
    if (other.createdAt >= synced.createdAt) continue;
    const sameSku = Boolean(sku && other.draft?.sku === sku);
    const sameTarget = Boolean(
      productId && other.duplicates?.candidates.some((c) => c.id === productId && c.score >= MATCH_THRESHOLD),
    );
    if (!sameSku && !sameTarget) continue;
    await updateJob(other.id, (j) => {
      if (j.status !== "ready") return;
      j.status = "superseded";
      j.supersededBy = synced.id;
    }).catch(() => undefined);
  }
}
