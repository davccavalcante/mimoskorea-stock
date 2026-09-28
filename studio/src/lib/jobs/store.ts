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

const cache = new Map<string, Job>();
const queues = new Map<string, Promise<unknown>>();

function jobsDir() {
  return dataDir("jobs");
}

function jobPath(id: string) {
  if (!/^[a-z0-9-]{8,64}$/.test(id)) throw new Error("ID de trabalho inválido");
  return path.join(jobsDir(), `${id}.json`);
}

async function persist(job: Job) {
  await mkdir(jobsDir(), { recursive: true });
  const file = jobPath(job.id);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
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
    identity: null,
    sources: [],
    draft: null,
    duplicates: null,
    sync: null,
    syncMedia: {},
    usage: [],
  };
  cache.set(id, job);
  await persist(job);
  return job;
}

/** Jobs left "running"/"syncing" by a server restart are marked as interrupted. */
const STALE_AFTER_MS = 15 * 60 * 1000;

export function isStale(job: Job, active: boolean): boolean {
  if (active || (job.status !== "running" && job.status !== "syncing")) return false;
  return Date.now() - new Date(job.updatedAt).getTime() > STALE_AFTER_MS;
}

export async function getJob(id: string): Promise<Job | null> {
  const cached = cache.get(id);
  if (cached) return cached;
  try {
    const job = JSON.parse(await readFile(jobPath(id), "utf8")) as Job;
    cache.set(id, job);
    return job;
  } catch {
    return null;
  }
}

/** Apply a mutation atomically (serialised per job) and persist the result. */
export async function updateJob(id: string, mutate: (job: Job) => void): Promise<Job> {
  const previous = queues.get(id) ?? Promise.resolve();
  const next = previous.then(async () => {
    const job = await getJob(id);
    if (!job) throw new Error(`Trabalho ${id} não encontrado`);
    const copy = structuredClone(job);
    mutate(copy);
    copy.updatedAt = now();
    cache.set(id, copy);
    await persist(copy);
    return copy;
  });
  queues.set(
    id,
    next.catch(() => undefined),
  );
  return next;
}

export async function setStep(id: string, key: StepKey, status: StepState["status"], detail: string | null = null) {
  return updateJob(id, (job) => {
    const step = job.steps.find((s) => s.key === key);
    if (!step) return;
    step.status = status;
    if (detail !== null) step.detail = detail;
    if (status === "running") step.startedAt = now();
    if (status === "done" || status === "failed" || status === "skipped") step.finishedAt = now();
  });
}

export async function listJobs(limit = 100): Promise<Job[]> {
  await mkdir(jobsDir(), { recursive: true });
  const files = (await readdir(jobsDir())).filter((f) => f.endsWith(".json"));
  const jobs = await Promise.all(files.map((f) => getJob(f.replace(/\.json$/, ""))));
  return jobs
    .filter((j): j is Job => Boolean(j))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function mediaDir(jobId: string) {
  jobPath(jobId); // validates the id
  return dataDir("media", jobId);
}
