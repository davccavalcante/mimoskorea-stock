import "server-only";
import { env } from "@/lib/env";
import { checkDuplicates } from "@/lib/pipeline/duplicates";
import { IDENTIFY_SYSTEM, identifyPrompt } from "@/lib/pipeline/prompts";
import { readReference, webResearch } from "@/lib/pipeline/research";
import { selectImages } from "@/lib/pipeline/select-images";
import { type SyncDecision, SyncRejectedError, syncToCatalog } from "@/lib/pipeline/sync";
import { writeListing } from "@/lib/pipeline/write";
import { getProviders, type Providers } from "@/lib/providers";
import { IdentitySchema, type Job, type Source, type StepKey } from "@/lib/types";
import { getJob, isStale, mediaDir, setStep, updateJob } from "./store";

// =============================================================================
// Pipeline orchestration
// =============================================================================
// reference -> identify -> research -> write -> images -> duplicates -> ready
// Each step updates the job file, so the UI can show live progress and the
// history keeps a full audit trail. Only one pipeline runs per job.

const running = new Set<string>();

export function isActive(jobId: string) {
  return running.has(jobId);
}

/** Mark jobs interrupted by a restart so the operator can retry them. */
export async function reconcile(job: Job): Promise<Job> {
  if (!isStale(job, isActive(job.id))) return job;
  return updateJob(job.id, (j) => {
    const wasSyncing = j.status === "syncing";
    j.status = wasSyncing && j.draft ? "ready" : "failed";
    j.error = "O processamento foi interrompido (o servidor reiniciou). Tente de novo.";
    for (const s of j.steps) if (s.status === "running") s.status = "failed";
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function logUsage(jobId: string, provider: string, operation: string, detail: string) {
  await updateJob(jobId, (job) => {
    job.usage.push({ provider, operation, detail });
  });
}

async function step<T>(jobId: string, key: StepKey, fn: () => Promise<{ value: T; detail: string }>): Promise<T> {
  await setStep(jobId, key, "running");
  try {
    const { value, detail } = await fn();
    await setStep(jobId, key, "done", detail);
    return value;
  } catch (error) {
    await setStep(jobId, key, "failed", message(error));
    throw error;
  }
}

export async function runPipeline(jobId: string, providers: Providers = getProviders()): Promise<void> {
  if (running.has(jobId)) return;
  running.add(jobId);
  const e = env();
  try {
    const job = await getJob(jobId);
    if (!job) return;
    const { input } = job;
    const { llm, research, catalog } = providers;
    const log = (l: { provider: string; operation: string; detail: string }) =>
      void logUsage(jobId, l.provider, l.operation, l.detail);

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
      const { data, usage } = await llm.generateJson({
        operation: "identify",
        system: IDENTIFY_SYSTEM,
        prompt: identifyPrompt(input, referenceSource),
        schema: IdentitySchema,
        thinking: "low",
      });
      log({ provider: llm.name, operation: "identify", detail: usage });
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
    const categories = await catalog.listCategories().catch(() => []);
    const written = await step(jobId, "write", async () => {
      const { draft, usage } = await writeListing({
        input,
        identity,
        sources,
        categories,
        llm,
        options: { storeName: e.STORE_NAME, titleMaxChars: e.TITLE_MAX_CHARS },
      });
      log({ provider: llm.name, operation: "write", detail: usage });
      const verified = draft.facts.filter((f) => f.verified).length;
      return {
        value: draft,
        detail: `${verified} informações confirmadas nas fontes, ${draft.facts.length - verified} descartadas`,
      };
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
      const value = await checkDuplicates({ catalog, identity, draft });
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
      j.status = "ready";
    });
  } catch (error) {
    await updateJob(jobId, (j) => {
      j.status = "failed";
      j.error = message(error);
    }).catch(() => undefined);
  } finally {
    running.delete(jobId);
  }
}

// =============================================================================
// Sync
// =============================================================================

export async function runSync(
  jobId: string,
  decision: SyncDecision,
  providers: Providers = getProviders(),
): Promise<Job> {
  const e = env();
  const job = await getJob(jobId);
  if (!job) throw new SyncRejectedError("Cadastro não encontrado.");
  if (job.status === "synced" && job.sync) return job;
  if (job.status !== "ready" && job.status !== "failed")
    throw new SyncRejectedError("O cadastro ainda não está pronto para sincronizar.");
  if (!job.draft) throw new SyncRejectedError("O cadastro não tem conteúdo gerado.");

  if (running.has(`sync:${jobId}`)) throw new SyncRejectedError("A sincronização já está em andamento.");
  running.add(`sync:${jobId}`);
  await updateJob(jobId, (j) => {
    j.status = "syncing";
    j.error = null;
  });
  await setStep(jobId, "sync", "running");
  try {
    const fresh = (await getJob(jobId)) as Job;
    const result = await syncToCatalog({
      job: fresh,
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
    return await updateJob(jobId, (j) => {
      j.sync = result;
      j.status = "synced";
    });
  } catch (error) {
    await setStep(jobId, "sync", "failed", message(error));
    await updateJob(jobId, (j) => {
      j.status = "ready";
      j.error = message(error);
    });
    throw error;
  } finally {
    running.delete(`sync:${jobId}`);
  }
}
