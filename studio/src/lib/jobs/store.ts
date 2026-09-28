import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/lib/env";
import { type Job, type JobInput, STEP_KEYS, type StepKey, type StepState } from "@/lib/types";

// =============================================================================
// File-backed job store
// =============================================================================
// One JSON file per job under .data/jobs/. Every registration is kept as an
// audit trail (who asked what, what the AI produced, what was synced, when).
// Writes are serialised per job and atomic (write temp file, then rename).
//
// Process-wide state lives on globalThis: Next.js may load this module more
// than once (one copy per route bundle), and all copies must share one cache,
// one write queue per job and one boot id.

type StoreState = {
  bootId: string;
  cache: Map<string, Job>;
  queues: Map<string, Promise<unknown>>;
};

const STATE_KEY = Symbol.for("mimos.studio.store");
const MAX_CACHED = 300;

function state(): StoreState {
  const g = globalThis as unknown as Record<symbol, StoreState | undefined>;
  g[STATE_KEY] ??= { bootId: randomUUID(), cache: new Map(), queues: new Map() };
  return g[STATE_KEY];
}

/** Random id of this server process; a job "running" under another boot id was interrupted by a restart. */
export function bootId(): string {
  return state().bootId;
}

function remember(job: Job) {
  const { cache, queues } = state();
  cache.delete(job.id);
  cache.set(job.id, job);
  if (cache.size <= MAX_CACHED) return;
  for (const id of cache.keys()) {
    if (cache.size <= MAX_CACHED) break;
    if (!queues.has(id)) cache.delete(id);
  }
}

function jobsDir() {
  return dataDir("jobs");
}

export function isJobId(id: string): boolean {
  return /^[a-z0-9-]{8,64}$/.test(id);
}

function jobPath(id: string) {
  if (!isJobId(id)) throw new Error("ID de trabalho inválido");
  return path.join(jobsDir(), `${id}.json`);
}

async function persist(job: Job) {
  await mkdir(jobsDir(), { recursive: true });
  const file = jobPath(job.id);
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, JSON.stringify(job, null, 2), "utf8");
  await rename(tmp, file);
}

function now() {
  return new Date().toISOString();
}

export function initialSteps(): StepState[] {
  return STEP_KEYS.map((key) => ({
    key,
    status: "pending",
    detail: null,
    startedAt: null,
    finishedAt: null,
  }));
}

/** Fill fields added after a job file was written (older history entries). */
function upgrade(job: Job): Job {
  return {
    ...job,
    errorCode: job.errorCode ?? null,
    errorDetail: job.errorDetail ?? null,
    bootId: job.bootId ?? null,
    supersededBy: job.supersededBy ?? null,
    syncMedia: job.syncMedia ?? {},
    usage: job.usage ?? [],
  };
}

export async function createJob(input: JobInput): Promise<Job> {
  const id = randomUUID();
  const job: Job = {
    id,
    createdAt: now(),
    updatedAt: now(),
    input,
    status: "running",
    steps: initialSteps(),
    error: null,
    errorCode: null,
    errorDetail: null,
    bootId: bootId(),
    supersededBy: null,
    identity: null,
    sources: [],
    draft: null,
    duplicates: null,
    sync: null,
    syncMedia: {},
    usage: [],
  };
  remember(job);
  await persist(job);
  return job;
}

/** A job that should be making progress but is not: the server restarted, or a step hung. */
const HUNG_AFTER_MS = 15 * 60 * 1000;

export function isStale(job: Job, active: boolean): boolean {
  if (active || (job.status !== "running" && job.status !== "syncing")) return false;
  if (job.bootId !== bootId()) return true;
  return Date.now() - new Date(job.updatedAt).getTime() > HUNG_AFTER_MS;
}

export async function getJob(id: string): Promise<Job | null> {
  if (!isJobId(id)) return null;
  const cached = state().cache.get(id);
  if (cached) return cached;
  try {
    const job = upgrade(JSON.parse(await readFile(jobPath(id), "utf8")) as Job);
    remember(job);
    return job;
  } catch {
    return null;
  }
}

/** Apply a mutation atomically (serialised per job) and persist the result. */
export async function updateJob(id: string, mutate: (job: Job) => void): Promise<Job> {
  const { queues } = state();
  const previous = queues.get(id) ?? Promise.resolve();
  const next = previous.then(async () => {
    const job = await getJob(id);
    if (!job) throw new Error(`Trabalho ${id} não encontrado`);
    const copy = structuredClone(job);
    mutate(copy);
    copy.updatedAt = now();
    remember(copy);
    await persist(copy);
    return copy;
  });
  const settled = next.catch(() => undefined);
  queues.set(id, settled);
  void settled.then(() => {
    if (queues.get(id) === settled) queues.delete(id);
  });
  return next;
}

export async function setStep(id: string, key: StepKey, status: StepState["status"], detail: string | null = null) {
  return updateJob(id, (job) => {
    const step = job.steps.find((s) => s.key === key);
    if (!step) return;
    step.status = status;
    if (detail !== null) step.detail = detail;
    if (status === "running") {
      step.startedAt = now();
      step.finishedAt = null;
      if (detail === null) step.detail = null;
    }
    if (status === "done" || status === "failed" || status === "skipped") step.finishedAt = now();
  });
}

export async function listJobs(limit = 100): Promise<Job[]> {
  await mkdir(jobsDir(), { recursive: true });
  const ids = (await readdir(jobsDir())).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  const jobs = await Promise.all(ids.filter(isJobId).map((id) => getJob(id)));
  return jobs
    .filter((j): j is Job => Boolean(j))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function mediaDir(jobId: string) {
  jobPath(jobId); // validates the id
  return dataDir("media", jobId);
}
