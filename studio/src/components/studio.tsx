"use client";

import { ArchiveIcon, WarningOctagonIcon, WifiSlashIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { discardJob, retryJob, useJob } from "@/lib/client/api";
import type { JobView } from "@/lib/jobs/view";
import type { ErrorCode } from "@/lib/types";
import { DonePanel } from "./done-panel";
import { NewProductForm } from "./new-product-form";
import { ProgressPanel } from "./progress-panel";
import { ReviewPanel } from "./review-panel";
import { Button } from "./ui/button";

// =============================================================================
// Flow controller: form -> progress -> review -> done
// The job id lives in the URL (?job=...), so a refresh never loses work.
// =============================================================================

/** What the operator should do next, by failure class. */
const ADVICE: Record<ErrorCode, string> = {
  config: "O sistema não está configurado por completo. Avise o administrador (arquivo .env.local).",
  credentials: "Uma chave de acesso foi recusada. Avise o administrador para conferir as chaves no arquivo .env.local.",
  quota:
    "O limite de uso de um serviço acabou. Espere alguns minutos e tente de novo. Se continuar, avise o administrador.",
  network: "Um serviço externo não respondeu. Espere um minuto e clique em “Tentar de novo”.",
  store: "A loja recusou o pedido. Leia a mensagem acima. Se não entender, avise o administrador.",
  ai: "A inteligência artificial respondeu fora do formato. Clique em “Tentar de novo”.",
  interrupted: "O servidor foi reiniciado no meio do trabalho. Clique em “Tentar de novo”.",
  unknown: "Confira se o link abre no navegador e se o nome está correto. Depois clique em “Tentar de novo”.",
};

const ANNOUNCE: Record<string, string> = {
  running: "Gerando o cadastro.",
  syncing: "Enviando para a loja.",
  ready: "Cadastro pronto. Confira e sincronize.",
  synced: "Produto sincronizado com a loja.",
  failed: "Não foi possível gerar o cadastro.",
  superseded: "Este cadastro foi substituído por um mais novo.",
  discarded: "Este cadastro foi descartado.",
};

function FailedView({
  job,
  onRetry,
  retrying,
  onNew,
}: {
  job: JobView;
  onRetry: () => void;
  retrying: boolean;
  onNew: () => void;
}) {
  return (
    <section className="grid max-w-3xl gap-6" aria-labelledby="failed-title">
      <WarningOctagonIcon size={56} weight="bold" aria-hidden />
      <h1 id="failed-title" className="display text-4xl sm:text-5xl">
        Não foi possível gerar o cadastro
      </h1>
      <p className="border-ink border-l-4 pl-3 font-medium text-lg">{job.error}</p>
      <p className="text-ink-2">{ADVICE[job.errorCode ?? "unknown"]}</p>
      {job.errorDetail ? (
        <details className="font-mono text-ink-3 text-xs">
          <summary className="cursor-pointer">Detalhe técnico (para o administrador)</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words">{job.errorDetail}</pre>
        </details>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button onClick={onRetry} loading={retrying}>
          Tentar de novo
        </Button>
        <Button variant="secondary" onClick={onNew}>
          Começar outro cadastro
        </Button>
      </div>
    </section>
  );
}

function ClosedView({ job, onOpen, onNew }: { job: JobView; onOpen: (id: string) => void; onNew: () => void }) {
  const superseded = job.status === "superseded";
  return (
    <section className="grid max-w-3xl gap-6" aria-labelledby="closed-title">
      <ArchiveIcon size={56} weight="bold" aria-hidden />
      <p className="font-mono text-ink-3 text-sm uppercase tracking-[0.2em]">Somente leitura</p>
      <h1 id="closed-title" className="display text-4xl sm:text-5xl">
        {superseded ? "Este cadastro foi substituído" : "Este cadastro foi descartado"}
      </h1>
      <p className="text-ink-2 text-lg">
        {job.draft?.title ?? job.input.productName} · estoque informado {job.input.stockQuantity} un.
      </p>
      <p className="text-ink-2">
        {superseded
          ? "Existe um cadastro mais novo do mesmo produto. Use o mais novo, para não enviar informações antigas para a loja."
          : "Nada foi enviado para a loja. O registro continua no histórico."}
      </p>
      <div className="flex flex-wrap gap-3">
        {superseded && job.supersededBy ? (
          <Button onClick={() => onOpen(job.supersededBy as string)}>Abrir o cadastro mais novo</Button>
        ) : null}
        <Button variant={superseded ? "secondary" : "primary"} onClick={onNew}>
          Começar outro cadastro
        </Button>
      </div>
    </section>
  );
}

export function Studio() {
  const router = useRouter();
  const params = useSearchParams();
  const jobId = params.get("job");
  const { job, setJob, error, offline, reload } = useJob(jobId);
  const [busy, setBusy] = useState<"retry" | "discard" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  const go = useCallback(
    (id: string | null) => {
      setActionError(null);
      router.push(id ? `/?job=${id}` : "/");
    },
    [router],
  );

  const retry = useCallback(async () => {
    if (!jobId || busy) return;
    setBusy("retry");
    setActionError(null);
    try {
      go(await retryJob(jobId));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [jobId, go, busy]);

  const discard = useCallback(async () => {
    if (!jobId || busy) return;
    setBusy("discard");
    setActionError(null);
    try {
      await discardJob(jobId);
      go(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [jobId, go, busy]);

  let view: React.ReactNode;
  let key: string;
  if (!jobId) {
    key = "form";
    view = <NewProductForm onCreated={go} />;
  } else if (!job) {
    key = "loading";
    view = error ? (
      <div className="grid max-w-3xl gap-4">
        <p role="alert" className="border-ink border-l-4 pl-3 font-medium">
          {error}
        </p>
        <div>
          <Button variant="secondary" onClick={() => go(null)}>
            Começar outro cadastro
          </Button>
        </div>
      </div>
    ) : (
      <div role="status" aria-label="Carregando" className="hatch-march h-3 w-48 border-2 border-ink" />
    );
  } else if (job.status === "running" || job.status === "syncing") {
    key = `progress-${job.id}`;
    view = <ProgressPanel job={job} />;
  } else if (job.status === "failed") {
    key = `failed-${job.id}`;
    view = <FailedView job={job} onRetry={retry} retrying={busy === "retry"} onNew={() => go(null)} />;
  } else if (job.status === "synced") {
    key = `done-${job.id}`;
    view = <DonePanel job={job} onNew={() => go(null)} />;
  } else if (job.status === "superseded" || job.status === "discarded") {
    key = `closed-${job.id}`;
    view = <ClosedView job={job} onOpen={go} onNew={() => go(null)} />;
  } else {
    // Re-mount on every server change (e.g. fresh duplicate check after a refused sync).
    key = `review-${job.id}-${job.updatedAt}`;
    view = (
      <ReviewPanel job={job} onSynced={setJob} onSyncFailed={reload} onRetry={retry} onDiscard={discard} busy={busy} />
    );
  }

  // Move keyboard/screen-reader focus to the new screen's heading.
  const screen = key.split("-")[0];
  useEffect(() => {
    if (screen === "loading") return;
    const t = setTimeout(() => {
      const heading = container.current?.querySelector("h1");
      if (!heading) return;
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: screen === "form" });
    }, 260);
    return () => clearTimeout(t);
  }, [screen]);

  return (
    <div ref={container} className="grid gap-6">
      <p className="sr-only" aria-live="polite">
        {job ? ANNOUNCE[job.status] : ""}
      </p>
      {offline ? (
        <p role="status" className="flex items-center gap-2 border-2 border-ink bg-ink p-3 font-medium text-paper">
          <WifiSlashIcon size={20} weight="bold" aria-hidden /> Sem conexão com o sistema. Tentando de novo
          automaticamente...
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="border-ink border-l-4 pl-3 font-medium">
          {actionError}
        </p>
      ) : null}
      <AnimatePresence mode="wait">
        <motion.div
          key={key}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {view}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
