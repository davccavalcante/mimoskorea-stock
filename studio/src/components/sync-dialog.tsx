"use client";

import { CloudArrowUpIcon } from "@phosphor-icons/react";
import { AlertDialog } from "radix-ui";
import { useState } from "react";
import { syncJob } from "@/lib/client/api";
import type { JobView } from "@/lib/jobs/view";
import type { Decision } from "./review-panel";
import { Button } from "./ui/button";

// =============================================================================
// Confirmation: say in plain words exactly what will happen in the store
// =============================================================================

export function SyncDialog({
  job,
  decision,
  open,
  onOpenChange,
  onSynced,
}: {
  job: JobView;
  decision: Decision;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSynced: (job: JobView) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = job.draft;
  if (!draft) return null;
  const target =
    decision.mode === "update" ? job.duplicates?.candidates.find((c) => c.id === decision.productId) : null;

  const lines =
    decision.mode === "update"
      ? [
          `Atualizar o produto ID ${decision.productId}${target ? ` (${target.name})` : ""}.`,
          `Estoque passa de ${target?.stockQuantity ?? 0} para ${job.input.stockQuantity} unidades.`,
          `Título, descrições, informações e ${draft.images.length} foto(s) serão substituídos pelo novo conteúdo.`,
          "O endereço (link) do produto na loja não muda.",
        ]
      : [
          "Criar um produto novo na loja.",
          `Estoque inicial: ${job.input.stockQuantity} unidades.`,
          `${draft.images.length} foto(s) em WebP serão enviadas para a biblioteca de mídia.`,
          "O produto fica aguardando preço e aprovação do administrador antes de aparecer para os clientes.",
        ];

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const result = await syncJob(job.id, decision);
      onOpenChange(false);
      onSynced(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px]" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 grid w-[min(92vw,34rem)] -translate-x-1/2 -translate-y-1/2 gap-5 border-[3px] border-ink bg-paper p-7 shadow-[10px_10px_0_0_var(--color-ink)]">
          <AlertDialog.Title className="display text-3xl">
            {decision.mode === "update" ? "Atualizar produto" : "Criar produto"}
          </AlertDialog.Title>
          <AlertDialog.Description asChild>
            <ul className="grid gap-2 text-ink-2">
              {lines.map((l) => (
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
              {busy ? "Enviando..." : "Confirmar e sincronizar"}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
