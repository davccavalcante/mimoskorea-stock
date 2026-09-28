"use client";

import { CheckIcon, CircleNotchIcon, MinusIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { Progress } from "radix-ui";
import type { JobView } from "@/lib/jobs/view";
import type { StepKey, StepState } from "@/lib/types";

// =============================================================================
// Step 2: live progress, printed like a receipt
// =============================================================================

export const STEP_LABELS: Record<StepKey, string> = {
  reference: "Lendo o link de referência",
  identify: "Identificando o produto exato",
  research: "Pesquisando fontes confiáveis",
  write: "Escrevendo e conferindo as informações",
  images: "Tratando as fotos",
  duplicates: "Procurando duplicatas na loja",
  sync: "Enviando para a loja",
};

function time(iso: string | null) {
  return iso
    ? new Date(iso).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "--:--:--";
}

function StatusGlyph({ status }: { status: StepState["status"] }) {
  const common = "grid size-8 shrink-0 place-items-center border-2 border-ink";
  if (status === "done")
    return (
      <span className={`${common} bg-ink text-paper`}>
        <CheckIcon size={18} weight="bold" aria-hidden />
      </span>
    );
  if (status === "running")
    return (
      <span className={common}>
        <CircleNotchIcon size={18} weight="bold" className="animate-spin" aria-hidden />
      </span>
    );
  if (status === "failed")
    return (
      <span className={`${common} hatch`}>
        <XIcon size={18} weight="bold" className="bg-paper" aria-hidden />
      </span>
    );
  if (status === "skipped")
    return (
      <span className={common}>
        <MinusIcon size={18} weight="bold" aria-hidden />
      </span>
    );
  return <span className={`${common} border-rule`} aria-hidden />;
}

export function ProgressPanel({ job }: { job: JobView }) {
  const steps = job.steps.filter((s) => s.key !== "sync" || job.status === "syncing" || s.status !== "pending");
  const done = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const pct = Math.round((done / steps.length) * 100);
  const current = steps.find((s) => s.status === "running");

  return (
    <section aria-labelledby="progress-title" className="grid gap-8">
      <div className="grid gap-3">
        <p className="font-mono text-ink-3 text-sm uppercase tracking-[0.2em]">
          {job.status === "syncing" ? "Sincronizando" : "Trabalhando"}
        </p>
        <h1 id="progress-title" className="display max-w-4xl text-4xl sm:text-6xl">
          {job.input.productName}
        </h1>
        <p className="font-mono text-ink-2 text-sm">
          Estoque informado: <strong className="text-ink">{job.input.stockQuantity} un.</strong> · referência:{" "}
          <span className="break-all">{new URL(job.input.referenceUrl).hostname}</span>
        </p>
      </div>

      <div className="grid gap-2">
        <Progress.Root
          value={pct}
          className="relative h-4 overflow-hidden border-2 border-ink bg-paper"
          aria-label="Progresso do cadastro"
        >
          <Progress.Indicator
            className="hatch-march h-full bg-paper transition-[width] duration-500 ease-out"
            style={{ width: `${Math.max(pct, 4)}%` }}
          />
        </Progress.Root>
        <p className="font-mono text-ink-3 text-xs" aria-live="polite">
          {pct}% · {current ? STEP_LABELS[current.key] : "preparando"}
        </p>
      </div>

      <ol className="border-ink border-y-2 font-mono">
        <AnimatePresence initial={false}>
          {steps.map((s, i) => (
            <motion.li
              key={s.key}
              layout
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: s.status === "pending" ? 0.4 : 1, x: 0 }}
              transition={{ delay: i * 0.04, duration: 0.3 }}
              className="grid grid-cols-[2rem_1fr] gap-4 border-rule border-b border-dashed py-4 last:border-b-0 sm:grid-cols-[2rem_6.5rem_1fr]"
            >
              <StatusGlyph status={s.status} />
              <span className="hidden pt-1 text-ink-3 text-xs sm:block">{time(s.finishedAt ?? s.startedAt)}</span>
              <div className="grid gap-1">
                <span className={`font-sans text-base ${s.status === "running" ? "font-bold" : "font-medium"}`}>
                  {STEP_LABELS[s.key]}
                </span>
                {s.detail ? <span className="text-ink-2 text-sm leading-snug">{s.detail}</span> : null}
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </section>
  );
}
