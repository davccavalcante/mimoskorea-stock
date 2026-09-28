"use client";

import { WarningOctagonIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { retryJob, useJob } from "@/lib/client/api";
import { DonePanel } from "./done-panel";
import { NewProductForm } from "./new-product-form";
import { ProgressPanel } from "./progress-panel";
import { ReviewPanel } from "./review-panel";
import { Button } from "./ui/button";

// =============================================================================
// Flow controller: form -> progress -> review -> done
// The job id lives in the URL (?job=...), so a refresh never loses work.
// =============================================================================

export function Studio() {
  const router = useRouter();
  const params = useSearchParams();
  const jobId = params.get("job");
  const { job, setJob, error } = useJob(jobId);
  const [retrying, setRetrying] = useState(false);

  const go = useCallback((id: string | null) => router.push(id ? `/?job=${id}` : "/"), [router]);

  const retry = useCallback(async () => {
    if (!jobId) return;
    setRetrying(true);
    try {
      go(await retryJob(jobId));
    } finally {
      setRetrying(false);
    }
  }, [jobId, go]);

  let view: React.ReactNode;
  let key: string;
  if (!jobId) {
    key = "form";
    view = <NewProductForm onCreated={go} />;
  } else if (!job) {
    key = "loading";
    view = error ? (
      <p role="alert" className="border-ink border-l-4 pl-3">
        {error}
      </p>
    ) : (
      <div role="status" aria-label="Carregando" className="hatch-march h-3 w-48 border-2 border-ink" />
    );
  } else if (job.status === "running" || job.status === "syncing") {
    key = "progress";
    view = <ProgressPanel job={job} />;
  } else if (job.status === "failed") {
    key = "failed";
    view = (
      <section className="grid max-w-3xl gap-6">
        <WarningOctagonIcon size={56} weight="bold" aria-hidden />
        <h1 className="display text-4xl sm:text-5xl">Não foi possível gerar o cadastro</h1>
        <p className="border-ink border-l-4 pl-3 font-mono text-sm">{job.error}</p>
        <p className="text-ink-2">
          Confira se o link abre no navegador e se o nome está correto. Depois tente de novo.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={retry} loading={retrying}>
            Tentar de novo
          </Button>
          <Button variant="secondary" onClick={() => go(null)}>
            Começar outro cadastro
          </Button>
        </div>
      </section>
    );
  } else if (job.status === "synced") {
    key = "done";
    view = <DonePanel job={job} onNew={() => go(null)} />;
  } else {
    key = `review-${job.id}`;
    view = <ReviewPanel job={job} onSynced={setJob} onRetry={retry} onDiscard={() => go(null)} />;
  }

  return (
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
  );
}
