import { ClockCounterClockwiseIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { connection } from "next/server";
import { readiness } from "@/lib/env";

// =============================================================================
// Header: wordmark, mode badge (test vs live) and navigation
// =============================================================================

export async function SiteHeader() {
  await connection(); // read the environment at request time, not at build time
  let status: { label: string; live: boolean; problems: string[] };
  try {
    const r = readiness();
    status = {
      label: r.mode === "mock" ? "Modo teste" : "Modo real",
      live: r.mode === "live",
      problems: r.problems,
    };
  } catch (error) {
    status = {
      label: "Configuração inválida",
      live: false,
      problems: [error instanceof Error ? error.message : String(error)],
    };
  }

  return (
    <header className="border-ink border-b-[3px]">
      <div className="mx-auto flex w-full max-w-6xl items-end justify-between gap-6 px-5 py-4 sm:px-8">
        <Link href="/" className="group flex items-baseline gap-3" aria-label="Início: novo cadastro">
          <span className="display text-2xl sm:text-3xl">MIMOS</span>
          <span className="font-mono text-ink-3 text-xs uppercase tracking-[0.25em]">catalog studio</span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-4">
          <span
            title={status.problems.join("\n") || "Tudo configurado"}
            className={`font-mono text-[11px] uppercase tracking-[0.18em] px-2.5 py-1 border border-ink ${
              status.live ? "bg-ink text-paper" : "bg-paper text-ink"
            }`}
          >
            {status.label}
            {status.problems.length ? " / pendências" : ""}
            {status.problems.length ? <span className="sr-only">: {status.problems.join("; ")}</span> : null}
          </span>
          <Link
            href="/historico"
            aria-label="Histórico de cadastros"
            className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 px-2 text-sm font-medium underline-offset-4 hover:underline"
          >
            <ClockCounterClockwiseIcon size={20} weight="bold" aria-hidden />
            <span className="hidden sm:inline">Histórico</span>
          </Link>
          <Link
            href="/"
            aria-label="Novo cadastro"
            className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 bg-ink px-3 text-paper text-sm font-semibold"
          >
            <PlusIcon size={18} weight="bold" aria-hidden />
            <span className="hidden sm:inline">Novo</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
