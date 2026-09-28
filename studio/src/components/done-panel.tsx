"use client";

import { ArrowSquareOutIcon, CheckIcon, PlusIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import type { JobView } from "@/lib/jobs/view";
import { Button } from "./ui/button";

// =============================================================================
// Step 4: synced
// =============================================================================

const STATUS_LABEL: Record<string, string> = {
  publish: "publicado na loja",
  pending: "aguardando aprovação do administrador",
  draft: "salvo como rascunho",
  private: "privado",
};

export function DonePanel({ job, onNew }: { job: JobView; onNew: () => void }) {
  const sync = job.sync;
  if (!sync) return null;
  return (
    <motion.section
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35 }}
      aria-labelledby="done-title"
      className="grid max-w-3xl gap-8"
    >
      <span className="grid size-20 place-items-center bg-ink text-paper">
        <CheckIcon size={44} weight="bold" aria-hidden />
      </span>
      <div className="grid gap-3">
        <p className="font-mono text-ink-3 text-sm uppercase tracking-[0.2em]">
          {sync.mode === "create" ? "Produto criado" : "Produto atualizado"}
        </p>
        <h1 id="done-title" className="display text-4xl sm:text-6xl">
          {job.draft?.title}
        </h1>
        <p className="text-ink-2 text-lg">
          ID {sync.productId} · {STATUS_LABEL[sync.status] ?? sync.status} · estoque {sync.stockQuantity} un. ·{" "}
          {sync.mediaIds.length} foto(s)
        </p>
      </div>
      {sync.contentUpdated === false ? (
        <p className="border-2 border-ink p-4 font-medium">
          Só o estoque foi atualizado. Faltam informações obrigatórias, então o texto novo ficou guardado no histórico
          para o administrador revisar.
        </p>
      ) : null}
      {sync.notes?.length ? (
        <div className="grid gap-2">
          <p className="font-mono text-ink-3 text-xs uppercase tracking-[0.2em]">Observações</p>
          <ul className="grid gap-1">
            {sync.notes.map((note) => (
              <li
                key={note}
                className={`border-ink border-l-4 pl-3 ${note.startsWith("ATENÇÃO") ? "font-semibold" : "text-ink-2"}`}
              >
                {note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <a
          href={sync.adminUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-h-12 items-center gap-2 border-2 border-ink px-5 font-semibold hover:bg-ink hover:text-paper"
        >
          Abrir no WordPress <ArrowSquareOutIcon size={18} weight="bold" aria-hidden />
        </a>
        {sync.status === "publish" ? (
          <a
            href={sync.permalink}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-h-12 items-center gap-2 border-2 border-ink px-5 font-semibold hover:bg-ink hover:text-paper"
          >
            Ver na loja <ArrowSquareOutIcon size={18} weight="bold" aria-hidden />
          </a>
        ) : null}
        <Button onClick={onNew} icon={<PlusIcon size={20} weight="bold" aria-hidden />}>
          Cadastrar outro produto
        </Button>
      </div>
    </motion.section>
  );
}
