"use client";

import { CloudArrowUpIcon } from "@phosphor-icons/react";
import { AlertDialog } from "radix-ui";
import { useState } from "react";
import { ApiError, syncJob } from "@/lib/client/api";
import type { JobView } from "@/lib/jobs/view";
import type { SyncPlan } from "@/lib/pipeline/plan";
import type { Decision } from "./review-panel";
import { Button } from "./ui/button";

// =============================================================================
// Confirmation: say in plain words exactly what will happen in the store
// =============================================================================
// The lines come from the same pure plan function the server applies, so the
// dialog can never promise something different from what the sync does.

export function SyncDialog({
  job,
  decision,
  plan,
  open,
  onOpenChange,
  onSynced,
  onFailed,
}: {
  job: JobView;
  decision: Decision;
  plan: Extract<SyncPlan, { ok: true }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSynced: (job: JobView) => void;
  onFailed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await syncJob(job.id, decision);
      onOpenChange(false);
      onSynced(result);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
      // The server may have stored a fresh duplicate check: reload the review behind the dialog.
      if (e instanceof ApiError && e.status !== 0) onFailed();
    }
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px]" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 grid max-h-[90dvh] w-[min(92vw,34rem)] -translate-x-1/2 -translate-y-1/2 gap-5 overflow-y-auto border-[3px] border-ink bg-paper p-7 shadow-[10px_10px_0_0_var(--color-ink)]">
          <AlertDialog.Title className="display text-3xl">
            {plan.mode === "update" ? "Atualizar produto" : "Criar produto"}
          </AlertDialog.Title>
          <AlertDialog.Description asChild>
            <ul className="grid gap-2 text-ink-2">
              {plan.lines.map((l) => (
                <li key={l} className="border-rule border-b pb-2">
                  {l}
                </li>
              ))}
            </ul>
          </AlertDialog.Description>
          {error ? (
            <p role="alert" className="border-ink border-l-4 pl-3 font-medium">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost" disabled={busy}>
                Voltar
              </Button>
            </AlertDialog.Cancel>
            <Button onClick={confirm} loading={busy} icon={<CloudArrowUpIcon size={20} weight="bold" aria-hidden />}>
              {busy ? "Enviando... não feche esta página" : "Confirmar e sincronizar"}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
