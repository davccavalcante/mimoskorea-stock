"use client";

import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CheckIcon,
  CloudArrowUpIcon,
  SealCheckIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import { RadioGroup, Tabs } from "radix-ui";
import { useState } from "react";
import type { JobView } from "@/lib/jobs/view";
import { planCreate, planUpdate, type SyncPlan, updatableCandidates } from "@/lib/pipeline/plan";
import { formatBrl } from "@/lib/text/normalize";
import type { DuplicateCandidate } from "@/lib/types";
import { SyncDialog } from "./sync-dialog";
import { Button } from "./ui/button";

// =============================================================================
// Step 3: read-only review of the generated listing
// =============================================================================

export type Decision = { mode: "create" } | { mode: "update"; productId: number };

function initialDecision(job: JobView): Decision | null {
  const dup = job.duplicates;
  if (!dup) return null;
  const matches = updatableCandidates(dup);
  if (dup.verdict === "match" && matches.length === 1) return { mode: "update", productId: matches[0].id };
  if (dup.verdict === "none") return { mode: "create" };
  return null; // several matches or "possible": the operator must choose
}

/** The exact plan the server will apply (same pure function as the server). */
export function planFor(job: JobView, decision: Decision | null): SyncPlan | null {
  const draft = job.draft;
  if (!draft || !decision) return null;
  if (decision.mode === "create") return planCreate(draft, job.input.stockQuantity, job.syncSettings);
  const target = job.duplicates?.candidates.find((c) => c.id === decision.productId);
  if (!target) return { ok: false, reason: "Produto escolhido não encontrado na verificação." };
  return planUpdate(draft, target, job.input.stockQuantity, job.syncSettings);
}

const KIND_LABELS: Record<string, string> = {
  food: "Alimento",
  beverage: "Bebida",
  alcoholic_beverage: "Bebida alcoólica",
  plush_toy: "Pelúcia",
  toy: "Brinquedo",
  backpack_bag: "Mochila / bolsa",
  apparel_footwear: "Vestuário / calçado",
  cosmetics: "Cosmético",
  stationery: "Papelaria",
  home_kitchen: "Casa / cozinha",
  electronics: "Eletrônico",
  other: "Outro",
};

function Candidate({ c }: { c: DuplicateCandidate }) {
  return (
    <div className="grid gap-1">
      <span className="font-semibold">{c.name}</span>
      <span className="font-mono text-sm opacity-80">
        ID {c.id} · {c.status === "publish" ? "publicado" : c.status} · estoque atual{" "}
        {c.stockQuantity ?? "não controlado"}
        {c.sku ? ` · SKU ${c.sku}` : ""}
      </span>
      <span className="font-mono text-xs opacity-70">{c.reasons.join(" · ")}</span>
    </div>
  );
}

function CandidateOption({ c, label }: { c: DuplicateCandidate; label: string }) {
  return (
    <label
      htmlFor={`candidate-${c.id}`}
      className="flex cursor-pointer items-start gap-4 border-2 border-rule p-4 has-[[data-state=checked]]:border-ink"
    >
      <RadioGroup.Item
        id={`candidate-${c.id}`}
        value={String(c.id)}
        className="mt-1 grid size-6 shrink-0 place-items-center rounded-full border-2 border-ink"
      >
        <RadioGroup.Indicator className="size-3 rounded-full bg-ink" />
      </RadioGroup.Item>
      <div className="grid gap-1">
        <span className="font-mono text-xs uppercase tracking-widest">{label}</span>
        <Candidate c={c} />
      </div>
    </label>
  );
}

function DuplicateBlock({
  job,
  decision,
  onChange,
}: {
  job: JobView;
  decision: Decision | null;
  onChange: (d: Decision) => void;
}) {
  const dup = job.duplicates;
  if (!dup) return null;
  const radioValue = decision ? (decision.mode === "update" ? String(decision.productId) : "create") : "";
  const choose = (v: string) =>
    onChange(v === "create" ? { mode: "create" } : { mode: "update", productId: Number(v) });

  if (dup.verdict === "match") {
    const matches = updatableCandidates(dup);
    if (matches.length > 1) {
      // The store already has the same item more than once (the audit found many). Never create a third.
      return (
        <fieldset className="grid gap-4 bg-ink p-6 text-paper">
          <legend className="sr-only">Este produto já existe na loja mais de uma vez</legend>
          <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em]">
            <WarningIcon size={18} weight="bold" aria-hidden /> Este produto já existe na loja {matches.length} vezes
          </p>
          <p className="text-sm">
            Escolha qual cadastro atualizar (de preferência o publicado). Nenhum produto novo será criado. Avise o
            administrador para apagar os repetidos.
          </p>
          <RadioGroup.Root
            value={radioValue}
            onValueChange={choose}
            className="grid gap-3 bg-paper p-3 text-ink"
            aria-label="Escolha qual produto atualizar"
          >
            {matches.map((c) => (
              <CandidateOption key={c.id} c={c} label="Atualizar este" />
            ))}
          </RadioGroup.Root>
        </fieldset>
      );
    }
    const top = matches[0];
    const plan = planFor(job, { mode: "update", productId: top.id });
    return (
      <div className="grid gap-4 bg-ink p-6 text-paper">
        <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em]">
          <WarningIcon size={18} weight="bold" aria-hidden /> Este produto já existe na loja
        </p>
        <Candidate c={top} />
        <p className="display text-2xl sm:text-3xl">
          Vamos atualizar o estoque de {top.stockQuantity ?? 0} para {job.input.stockQuantity} unidades.
        </p>
        <p className="text-sm">
          {plan?.ok && !plan.contentUpdated
            ? "Como faltam informações obrigatórias e o produto está publicado, só o estoque será atualizado."
            : "Os textos e as fotos também serão atualizados."}{" "}
          Nenhum produto novo será criado, para não duplicar.
        </p>
      </div>
    );
  }

  if (dup.verdict === "possible") {
    return (
      <fieldset className="grid gap-4 border-2 border-ink p-6">
        <legend className="bg-paper px-2 font-mono text-xs uppercase tracking-[0.2em]">
          Encontramos produtos parecidos
        </legend>
        <p className="text-ink-2">Algum destes é o mesmo produto que você tem na mão? Escolha uma opção.</p>
        <RadioGroup.Root
          value={radioValue}
          onValueChange={choose}
          className="grid gap-3"
          aria-label="Escolha o que fazer"
        >
          {dup.candidates.map((c) => (
            <CandidateOption key={c.id} c={c} label="É este: atualizar o estoque" />
          ))}
          <label
            htmlFor="candidate-create"
            className="flex cursor-pointer items-start gap-4 border-2 border-rule p-4 has-[[data-state=checked]]:border-ink"
          >
            <RadioGroup.Item
              id="candidate-create"
              value="create"
              className="mt-1 grid size-6 shrink-0 place-items-center rounded-full border-2 border-ink"
            >
              <RadioGroup.Indicator className="size-3 rounded-full bg-ink" />
            </RadioGroup.Item>
            <div className="grid gap-1">
              <span className="font-mono text-xs uppercase tracking-widest">Nenhum destes</span>
              <span className="font-semibold">É um produto diferente: criar um novo</span>
            </div>
          </label>
        </RadioGroup.Root>
      </fieldset>
    );
  }

  return (
    <p className="flex items-center gap-2 border-ink border-l-4 pl-3 font-medium">
      <SealCheckIcon size={20} weight="bold" aria-hidden /> Produto novo: não encontramos nenhum igual na loja.
    </p>
  );
}

function ReadinessBlock({ job, plan }: { job: JobView; plan: SyncPlan | null }) {
  const draft = job.draft;
  if (!draft) return null;
  const blockers = draft.missing.filter((m) => m.severity === "blocker");
  const after = plan?.ok ? plan.lines.find((l) => l.startsWith("Situação na loja depois")) : null;
  if (draft.complete) {
    return (
      <div className="grid gap-1">
        <p className="flex items-center gap-2 font-medium">
          <CheckIcon size={20} weight="bold" aria-hidden /> Todas as informações obrigatórias foram encontradas e
          conferidas.
        </p>
        {plan?.ok && plan.mode === "create" ? (
          <p className="text-ink-2 text-sm">
            Produto novo entra sem preço: fica aguardando o administrador definir o preço e aprovar.
          </p>
        ) : after ? (
          <p className="text-ink-2 text-sm">{after}</p>
        ) : null}
      </div>
    );
  }
  const stockOnly = plan?.ok && plan.mode === "update" && !plan.contentUpdated;
  return (
    <div className="grid gap-2 border-2 border-ink p-5">
      <p className="flex items-center gap-2 font-semibold">
        <span className="hatch inline-block size-4 border border-ink" aria-hidden />{" "}
        {stockOnly ? "Só o estoque será atualizado" : "Vai para aprovação do administrador"}
      </p>
      <p className="text-ink-2 text-sm">
        {stockOnly
          ? "O produto já está publicado e faltam informações obrigatórias. Para não piorar o que o cliente vê, só o estoque muda; o texto novo fica guardado para o administrador:"
          : "Faltam informações obrigatórias que não encontramos em fontes confiáveis. O produto será salvo, mas só aparece na loja depois que o administrador completar e aprovar:"}
      </p>
      <ul className="grid gap-1 font-mono text-sm">
        {blockers.map((m) => (
          <li key={m.field}>- {m.label}</li>
        ))}
      </ul>
    </div>
  );
}

function Gallery({ job }: { job: JobView }) {
  const images = job.draft?.images ?? [];
  const [active, setActive] = useState(0);
  if (!images.length) {
    return (
      <div className="hatch grid aspect-square w-full min-w-0 place-items-center border-2 border-ink">
        <span className="bg-paper px-3 py-2 font-mono text-sm">Nenhuma foto confiável encontrada</span>
      </div>
    );
  }
  const current = images[Math.min(active, images.length - 1)];
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3">
      <div className="relative aspect-square w-full overflow-hidden border-2 border-ink bg-paper">
        {/* biome-ignore lint/performance/noImgElement: local processed previews served by our API */}
        <img
          src={`/api/media/${job.id}/${current.fileName}`}
          alt={current.alt}
          className="absolute inset-0 size-full object-contain"
        />
        <span className="absolute top-0 left-0 bg-ink px-2 py-1 font-mono text-[11px] text-paper">
          {current.fileName} · {Math.round(current.bytes / 1024)} KB
        </span>
      </div>
      {images.length > 1 ? (
        <div className="grid grid-cols-5 gap-2">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Ver foto ${i + 1}`}
              aria-pressed={i === active}
              className={`relative aspect-square overflow-hidden border-2 ${i === active ? "border-ink" : "border-rule hover:border-ink-3"}`}
            >
              {/* biome-ignore lint/performance/noImgElement: local processed previews served by our API */}
              <img
                src={`/api/media/${job.id}/${img.fileName}`}
                alt=""
                className="absolute inset-0 size-full object-contain"
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const tabTrigger =
  "border-b-4 border-transparent px-1 pb-2 font-semibold text-ink-3 data-[state=active]:border-ink data-[state=active]:text-ink hover:text-ink";

export function ReviewPanel({
  job,
  onSynced,
  onSyncFailed,
  onRetry,
  onDiscard,
  busy,
}: {
  job: JobView;
  onSynced: (job: JobView) => void;
  onSyncFailed: () => void;
  onRetry: () => void;
  onDiscard: () => void;
  busy: "retry" | "discard" | null;
}) {
  const [decision, setDecision] = useState<Decision | null>(() => initialDecision(job));
  const [open, setOpen] = useState(false);
  const draft = job.draft;
  if (!draft) return null;
  const verified = draft.facts.filter((f) => f.verified);
  const discarded = draft.facts.filter((f) => !f.verified);
  const plan = planFor(job, decision);
  // On update the store keeps its own SKU and barcode when it already has them.
  const target =
    decision?.mode === "update" ? job.duplicates?.candidates.find((c) => c.id === decision.productId) : null;
  const skuShown = target?.sku ? `${target.sku} (atual, mantido)` : draft.sku;
  const eanShown = target?.gtin ? `${target.gtin} (atual, mantido)` : (draft.gtin ?? "não encontrado");

  return (
    <section aria-labelledby="review-title" className="grid gap-10">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid gap-4">
        <p className="font-mono text-ink-3 text-sm uppercase tracking-[0.2em]">Confira antes de enviar</p>
        {job.error ? (
          <p role="alert" className="border-ink border-l-4 pl-3 font-medium">
            A última tentativa de sincronizar não foi concluída: {job.error}
          </p>
        ) : null}
        <DuplicateBlock job={job} decision={decision} onChange={setDecision} />
        <ReadinessBlock job={job} plan={plan} />
      </motion.div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Gallery job={job} />

        <div className="grid min-w-0 content-start gap-6">
          <div className="grid gap-3 border-ink border-b-[6px] pb-6">
            <span className="font-mono text-ink-3 text-xs uppercase tracking-[0.2em]">
              {KIND_LABELS[draft.kind] ?? draft.kind}
              {draft.category ? ` · ${draft.category.name}` : " · sem categoria"}
            </span>
            <h1 id="review-title" className="display text-3xl sm:text-5xl">
              {draft.title}
            </h1>
            {/* biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized server-side (sanitize-html allowlist) */}
            <div className="product-html text-ink-2" dangerouslySetInnerHTML={{ __html: draft.shortDescriptionHtml }} />
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 font-mono text-sm sm:grid-cols-3">
            {[
              ["Estoque", `${job.input.stockQuantity} un.`],
              ["SKU", skuShown],
              ["EAN", eanShown],
              ["Marca", draft.brand ?? "não encontrada"],
              [
                "Peso (envio)",
                draft.shipping.weightKg
                  ? `${draft.shipping.weightKg} kg${draft.shipping.estimated ? " (estimado)" : ""}`
                  : "-",
              ],
              [
                "Caixa (cm)",
                draft.shipping.lengthCm
                  ? `${draft.shipping.lengthCm} x ${draft.shipping.widthCm} x ${draft.shipping.heightCm}`
                  : "-",
              ],
            ].map(([k, v]) => (
              <div key={k} className="grid gap-0.5 border-rule border-t pt-2">
                <dt className="text-ink-3 text-xs uppercase tracking-widest">{k}</dt>
                <dd className="break-words font-medium text-ink">{v}</dd>
              </div>
            ))}
          </dl>

          {draft.marketPrices.length ? (
            <p className="font-mono text-ink-2 text-xs">
              Preços vistos na pesquisa (só referência, o preço é definido pelo administrador):{" "}
              {draft.marketPrices
                .map((p) => (p.currency === "BRL" ? formatBrl(p.amount) : `${p.amount} ${p.currency}`))
                .join(" · ")}
            </p>
          ) : (
            <p className="font-mono text-ink-3 text-xs">
              O preço de venda é definido pelo administrador no WooCommerce.
            </p>
          )}

          <Tabs.Root defaultValue="description" className="grid gap-5">
            <Tabs.List
              aria-label="Detalhes do cadastro"
              className="flex flex-wrap gap-x-6 gap-y-2 border-rule border-b"
            >
              <Tabs.Trigger value="description" className={tabTrigger}>
                Descrição
              </Tabs.Trigger>
              <Tabs.Trigger value="facts" className={tabTrigger}>
                Informações ({verified.length})
              </Tabs.Trigger>
              <Tabs.Trigger value="missing" className={tabTrigger}>
                Pendências ({draft.missing.length})
              </Tabs.Trigger>
              <Tabs.Trigger value="sources" className={tabTrigger}>
                Fontes ({job.sources.length})
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="description" className="outline-none">
              {/* biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized server-side (sanitize-html allowlist) */}
              <div className="product-html" dangerouslySetInnerHTML={{ __html: draft.descriptionHtml }} />
              {draft.titleAdjustments.length ? (
                <p className="mt-6 font-mono text-ink-3 text-xs">
                  Correções automáticas: {draft.titleAdjustments.join(" · ")}
                </p>
              ) : null}
            </Tabs.Content>

            <Tabs.Content value="facts" className="grid gap-6 outline-none">
              <table className="w-full border-collapse font-mono text-sm">
                <thead>
                  <tr className="border-ink border-b-[6px] text-left">
                    <th className="py-2 pr-3 font-semibold">Informação</th>
                    <th className="py-2 pr-3 font-semibold">Valor</th>
                    <th className="py-2 font-semibold">Fonte</th>
                  </tr>
                </thead>
                <tbody>
                  {verified.map((f) => (
                    <tr key={`${f.field}-${f.value}`} className="border-rule border-b align-top">
                      <th scope="row" className="py-2 pr-3 text-left font-medium">
                        {f.label}
                      </th>
                      <td className="py-2 pr-3">{f.value}</td>
                      <td className="py-2 text-ink-3">{f.sourceIds.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {discarded.length ? (
                <details className="font-mono text-ink-3 text-xs">
                  <summary className="cursor-pointer">
                    {discarded.length} informação(ões) descartada(s) por não estarem comprovadas nas fontes
                  </summary>
                  <ul className="mt-2 grid gap-1">
                    {discarded.map((f) => (
                      <li key={`${f.field}-${f.value}`}>
                        <XIcon size={12} weight="bold" aria-hidden className="inline" /> {f.label}: {f.value}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </Tabs.Content>

            <Tabs.Content value="missing" className="outline-none">
              {draft.missing.length ? (
                <ul className="grid gap-3">
                  {draft.missing.map((m) => (
                    <li key={m.field} className="grid grid-cols-[1.5rem_1fr] gap-3 border-rule border-b pb-3">
                      <span
                        className={`mt-1 size-4 border-2 border-ink ${m.severity === "blocker" ? "bg-ink" : ""}`}
                        aria-hidden
                      />
                      <div>
                        <p className="font-semibold">
                          {m.label}{" "}
                          <span className="font-mono text-ink-3 text-xs">
                            ({m.severity === "blocker" ? "obrigatório" : "recomendado"})
                          </span>
                        </p>
                        <p className="text-ink-2 text-sm">{m.why}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Nenhuma pendência.</p>
              )}
            </Tabs.Content>

            <Tabs.Content value="sources" className="outline-none">
              <ol className="grid gap-2 font-mono text-sm">
                {job.sources.map((s) => (
                  <li key={s.id} className="grid grid-cols-[2.5rem_1fr] gap-2 border-rule border-b pb-2">
                    <span className="font-semibold">{s.id}</span>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="group grid gap-0.5 break-words"
                    >
                      <span className="font-sans font-medium text-ink group-hover:underline">
                        {s.title} <ArrowSquareOutIcon size={12} weight="bold" aria-hidden className="inline" />
                      </span>
                      <span className="text-ink-3 text-xs">
                        {s.domain}
                        {s.origin === "reference" ? " · seu link de referência" : ""}
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-ink border-t-[3px] bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={onDiscard}
              loading={busy === "discard"}
              disabled={busy !== null}
              icon={<XIcon size={18} weight="bold" aria-hidden />}
            >
              Descartar
            </Button>
            <Button
              variant="secondary"
              onClick={onRetry}
              loading={busy === "retry"}
              disabled={busy !== null}
              icon={<ArrowClockwiseIcon size={18} weight="bold" aria-hidden />}
            >
              Gerar de novo
            </Button>
          </div>
          <div className="grid justify-items-end gap-1">
            <Button
              onClick={() => setOpen(true)}
              disabled={!plan?.ok || busy !== null}
              aria-describedby={plan?.ok ? undefined : "sync-blocked"}
              icon={<CloudArrowUpIcon size={22} weight="bold" aria-hidden />}
              className="min-w-64 text-lg"
            >
              Sincronizar com a loja
            </Button>
            {!plan?.ok ? (
              <p id="sync-blocked" className="max-w-sm text-right font-medium text-sm">
                {plan && !plan.ok ? plan.reason : "Escolha uma opção no quadro acima para liberar o botão."}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {decision && plan?.ok ? (
        <SyncDialog
          job={job}
          decision={decision}
          plan={plan}
          open={open}
          onOpenChange={setOpen}
          onSynced={onSynced}
          onFailed={onSyncFailed}
        />
      ) : null}
    </section>
  );
}
