import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { listJobsReconciled } from "@/lib/jobs/runner";
import { toSummary } from "@/lib/jobs/view";

export const metadata: Metadata = { title: "Histórico | Mimos Catalog Studio" };

const STATUS: Record<string, string> = {
  running: "gerando",
  ready: "aguardando revisão",
  syncing: "sincronizando",
  synced: "sincronizado",
  failed: "falhou",
  superseded: "substituído",
  discarded: "descartado",
};

export default async function HistoryPage() {
  await connection();
  const jobs = (await listJobsReconciled(300)).map(toSummary);
  return (
    <section className="grid gap-8" aria-labelledby="history-title">
      <div className="grid gap-3">
        <p className="font-mono text-ink-3 text-sm uppercase tracking-[0.2em]">Registro de auditoria</p>
        <h1 id="history-title" className="display text-5xl sm:text-6xl">
          Histórico
        </h1>
        <p className="max-w-2xl text-ink-2">
          Tudo o que foi gerado e enviado para a loja fica registrado aqui, com data, conteúdo e fontes.
        </p>
      </div>
      {jobs.length === 0 ? (
        <p className="border-ink border-l-4 pl-3">Nenhum cadastro ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-left">
            <thead>
              <tr className="border-ink border-b-[6px] font-mono text-xs uppercase tracking-widest">
                <th className="py-3 pr-4 font-semibold">Data</th>
                <th className="py-3 pr-4 font-semibold">Produto</th>
                <th className="py-3 pr-4 font-semibold">Estoque</th>
                <th className="py-3 pr-4 font-semibold">Situação</th>
                <th className="py-3 font-semibold">Loja</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-rule border-b align-top">
                  <td className="py-3 pr-4 font-mono text-sm whitespace-nowrap">
                    {new Date(j.createdAt).toLocaleString("pt-BR")}
                  </td>
                  <td className="py-3 pr-4">
                    <Link href={`/?job=${j.id}`} className="font-semibold underline-offset-4 hover:underline">
                      {j.title ?? j.productName}
                    </Link>
                    {j.title && j.title !== j.productName ? (
                      <p className="font-mono text-ink-3 text-xs">digitado: {j.productName}</p>
                    ) : null}
                  </td>
                  <td className="py-3 pr-4 font-mono">{j.stockQuantity}</td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-block border border-ink px-2 py-0.5 font-mono text-xs ${j.status === "synced" ? "bg-ink text-paper" : ""}`}
                    >
                      {STATUS[j.status] ?? j.status}
                    </span>
                    {j.complete === false ? <p className="mt-1 font-mono text-ink-3 text-xs">com pendências</p> : null}
                  </td>
                  <td className="py-3 font-mono text-sm">
                    {j.adminUrl ? (
                      <a
                        href={j.adminUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        {j.syncMode === "create" ? "criado" : "atualizado"} #{j.productId}
                        <ArrowSquareOutIcon size={12} weight="bold" aria-hidden />
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
