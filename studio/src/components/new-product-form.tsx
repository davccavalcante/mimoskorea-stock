"use client";

import { ArrowRightIcon, LinkSimpleIcon, MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { type FormEvent, useId, useState } from "react";
import { createJob } from "@/lib/client/api";
import { JobInputSchema } from "@/lib/types";
import { Button } from "./ui/button";

// =============================================================================
// Step 1: the only three things the operator types
// =============================================================================

type Errors = Partial<Record<"productName" | "referenceUrl" | "stockQuantity" | "form", string>>;

const rise = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: 0.08 * i,
      duration: 0.45,
      ease: [0.2, 0.7, 0.2, 1] as const,
    },
  }),
};

function FieldBlock({
  index,
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  index: number;
  label: string;
  hint: string;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      custom={index}
      variants={rise}
      initial="hidden"
      animate="show"
      className="grid gap-3 border-ink border-t-2 pt-5 sm:grid-cols-[5.5rem_1fr]"
    >
      <span className="display text-4xl text-ink sm:text-5xl" aria-hidden>
        {String(index).padStart(2, "0")}
      </span>
      <div className="grid gap-2">
        <label htmlFor={htmlFor} className="font-semibold text-lg">
          {label}
        </label>
        {children}
        <p id={`${htmlFor}-hint`} className="font-mono text-ink-3 text-sm">
          {hint}
        </p>
        {error ? (
          <p role="alert" className="border-ink border-l-4 pl-3 font-medium text-ink">
            {error}
          </p>
        ) : null}
      </div>
    </motion.div>
  );
}

export function NewProductForm({ onCreated }: { onCreated: (jobId: string) => void }) {
  const ids = { name: useId(), url: useId(), qty: useId() };
  const [productName, setProductName] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [stock, setStock] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const bump = (delta: number) => {
    const current = Number.parseInt(stock || "0", 10) || 0;
    setStock(String(Math.max(0, current + delta)));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = JobInputSchema.safeParse({
      productName,
      referenceUrl,
      stockQuantity: stock === "" ? undefined : stock,
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof Errors;
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      onCreated(await createJob(parsed.data));
    } catch (e) {
      setErrors({
        form: e instanceof Error ? e.message : "Não foi possível começar. Tente de novo.",
      });
      setBusy(false);
    }
  }

  const input =
    "w-full border-0 border-ink border-b-2 bg-transparent px-0 py-2 text-2xl font-medium outline-none placeholder:text-ink-3/60 focus:border-b-4 sm:text-3xl";

  return (
    <form onSubmit={submit} noValidate className="grid gap-10" aria-describedby="form-intro">
      <motion.div variants={rise} custom={0} initial="hidden" animate="show" className="grid gap-4">
        <p className="font-mono text-ink-3 text-sm uppercase tracking-[0.2em]">Novo cadastro</p>
        <h1 className="display max-w-3xl text-5xl sm:text-7xl">Diga o produto. A IA faz o resto.</h1>
        <p id="form-intro" className="max-w-2xl text-ink-2 text-lg">
          Preencha os 3 campos abaixo. O sistema pesquisa o produto, escreve os textos, trata as fotos e confere se ele
          já existe na loja. Você só confere e aperta <strong>Sincronizar</strong>.
        </p>
      </motion.div>

      <FieldBlock
        index={1}
        label="Nome do produto"
        hint="Exemplo: Soju Chum-Churum Morango 360ml"
        error={errors.productName}
        htmlFor={ids.name}
      >
        <input
          id={ids.name}
          name="productName"
          autoComplete="off"
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          placeholder="Nome como está na embalagem"
          aria-describedby={`${ids.name}-hint`}
          aria-invalid={Boolean(errors.productName)}
          className={input}
          maxLength={200}
        />
      </FieldBlock>

      <FieldBlock
        index={2}
        label="Link de referência"
        hint="Cole o link do produto no Mercado Livre, Amazon, Shopee ou no site do fabricante."
        error={errors.referenceUrl}
        htmlFor={ids.url}
      >
        <div className="flex items-center gap-3">
          <LinkSimpleIcon size={28} weight="bold" aria-hidden className="shrink-0" />
          <input
            id={ids.url}
            name="referenceUrl"
            type="url"
            inputMode="url"
            autoComplete="off"
            value={referenceUrl}
            onChange={(e) => setReferenceUrl(e.target.value)}
            placeholder="https://"
            aria-describedby={`${ids.url}-hint`}
            aria-invalid={Boolean(errors.referenceUrl)}
            className={`${input} font-mono text-lg sm:text-xl`}
          />
        </div>
      </FieldBlock>

      <FieldBlock
        index={3}
        label="Quantidade em estoque"
        hint="Quantas unidades você tem agora na prateleira."
        error={errors.stockQuantity}
        htmlFor={ids.qty}
      >
        <div className="flex items-stretch gap-3">
          <button
            type="button"
            onClick={() => bump(-1)}
            aria-label="Diminuir 1"
            className="grid w-14 place-items-center border-2 border-ink hover:bg-ink hover:text-paper"
          >
            <MinusIcon size={22} weight="bold" aria-hidden />
          </button>
          <input
            id={ids.qty}
            name="stockQuantity"
            inputMode="numeric"
            pattern="[0-9]*"
            value={stock}
            onChange={(e) => setStock(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="0"
            aria-describedby={`${ids.qty}-hint`}
            aria-invalid={Boolean(errors.stockQuantity)}
            className={`${input} w-40 text-center font-mono tabular-nums`}
          />
          <button
            type="button"
            onClick={() => bump(1)}
            aria-label="Aumentar 1"
            className="grid w-14 place-items-center border-2 border-ink hover:bg-ink hover:text-paper"
          >
            <PlusIcon size={22} weight="bold" aria-hidden />
          </button>
          <span className="self-end pb-3 font-mono text-ink-3 text-sm">unidades</span>
        </div>
      </FieldBlock>

      <motion.div
        variants={rise}
        custom={4}
        initial="hidden"
        animate="show"
        className="grid gap-3 border-ink border-t-[6px] pt-6"
      >
        {errors.form ? (
          <p role="alert" className="border-ink border-l-4 pl-3 font-medium">
            {errors.form}
          </p>
        ) : null}
        <Button
          type="submit"
          loading={busy}
          icon={<ArrowRightIcon size={22} weight="bold" aria-hidden />}
          className="w-full py-5 text-xl sm:w-auto sm:px-10"
        >
          Gerar cadastro
        </Button>
        <p className="font-mono text-ink-3 text-xs">
          Leva de 1 a 3 minutos. Nada é enviado para a loja antes de você confirmar.
        </p>
      </motion.div>
    </form>
  );
}
