"use client";

import { useEffect, useRef, useState } from "react";
import type { JobView } from "@/lib/jobs/view";
import type { JobInput } from "@/lib/types";

// =============================================================================
// Browser-side API helpers
// =============================================================================

export class ApiError extends Error {}

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `Erro ${res.status}`);
  return body as T;
}

export async function createJob(input: JobInput): Promise<string> {
  const res = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parse<{ id: string }>(res)).id;
}

export async function fetchJob(id: string): Promise<JobView> {
  return parse<JobView>(await fetch(`/api/jobs/${id}`, { cache: "no-store" }));
}

export async function syncJob(
  id: string,
  decision: { mode: "create" } | { mode: "update"; productId: number },
): Promise<JobView> {
  const res = await fetch(`/api/jobs/${id}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(decision),
  });
  return parse<JobView>(res);
}

export async function retryJob(id: string): Promise<string> {
  return (await parse<{ id: string }>(await fetch(`/api/jobs/${id}/retry`, { method: "POST" }))).id;
}

/** Poll a job while it is running or syncing. */
export function useJob(id: string | null) {
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setJob(null);
    setError(null);
    if (!id) return;
    let cancelled = false;
    let failures = 0;
    const tick = async () => {
      try {
        const next = await fetchJob(id);
        if (cancelled) return;
        failures = 0;
        setJob(next);
        setError(null);
        if (next.status === "running" || next.status === "syncing") timer.current = setTimeout(tick, 1200);
      } catch (e) {
        if (cancelled) return;
        failures++;
        setError(e instanceof Error ? e.message : String(e));
        if (failures < 5) timer.current = setTimeout(tick, 2500);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [id]);

  return { job, setJob, error };
}
