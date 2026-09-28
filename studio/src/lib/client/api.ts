"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JobView } from "@/lib/jobs/view";
import type { JobInput } from "@/lib/types";

// =============================================================================
// Browser-side API helpers
// =============================================================================

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const OFFLINE = "Sem conexão com o sistema. Confira se ele está aberto e se a internet está funcionando.";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", ...init });
  } catch {
    throw new ApiError(OFFLINE, 0, "network");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    const fallback =
      res.status >= 500 ? "O sistema teve um problema. Tente de novo em instantes." : `Erro ${res.status}`;
    throw new ApiError(body.error ?? fallback, res.status, body.code ?? null);
  }
  return body as T;
}

const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function createJob(input: JobInput): Promise<string> {
  return (await request<{ id: string }>("/api/jobs", postJson(input))).id;
}

export async function fetchJob(id: string): Promise<JobView> {
  return request<JobView>(`/api/jobs/${id}`);
}

export async function syncJob(
  id: string,
  decision: { mode: "create" } | { mode: "update"; productId: number },
): Promise<JobView> {
  return request<JobView>(`/api/jobs/${id}/sync`, postJson(decision));
}

export async function retryJob(id: string): Promise<string> {
  return (await request<{ id: string }>(`/api/jobs/${id}/retry`, postJson({}))).id;
}

export async function discardJob(id: string): Promise<JobView> {
  return request<JobView>(`/api/jobs/${id}/discard`, postJson({}));
}

const ACTIVE = new Set(["running", "syncing"]);
const POLL_MS = 1200;
const MAX_BACKOFF_MS = 15_000;

/**
 * Follow a job. While it is running or syncing, polling never gives up: a
 * network hiccup only slows it down (capped backoff) and raises `offline`,
 * so the screen can never freeze on a stale state.
 */
export function useJob(id: string | null) {
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const lastId = useRef<string | null>(null);

  useEffect(() => {
    void nonce; // reload() re-runs this effect
    if (lastId.current !== id) {
      // A different job: forget the previous one immediately.
      lastId.current = id;
      setJob(null);
      setError(null);
    }
    setOffline(false);
    if (!id) return;
    let cancelled = false;
    let failures = 0;
    let lastActive = true;
    const schedule = (ms: number) => {
      if (!cancelled) timer.current = setTimeout(tick, ms);
    };
    const tick = async () => {
      try {
        const next = await fetchJob(id);
        if (cancelled) return;
        failures = 0;
        lastActive = ACTIVE.has(next.status);
        setJob(next);
        setError(null);
        setOffline(false);
        if (lastActive) schedule(POLL_MS);
      } catch (e) {
        if (cancelled) return;
        failures++;
        const status = e instanceof ApiError ? e.status : 0;
        if (status === 404) {
          setError("Cadastro não encontrado. Ele pode ter sido apagado do histórico.");
          return;
        }
        setError(e instanceof Error ? e.message : String(e));
        if (failures >= 2) setOffline(true);
        if (lastActive) schedule(Math.min(MAX_BACKOFF_MS, 1500 * 2 ** Math.min(failures, 4)));
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [id, nonce]);

  return { job, setJob, error, offline, reload };
}
