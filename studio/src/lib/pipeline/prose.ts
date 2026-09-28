import { numbersIn } from "@/lib/pipeline/verify";
import { collapseSpaces, fold, stripEmoji } from "@/lib/text/normalize";

// =============================================================================
// Guard rails for model-written prose (deterministic, no AI)
// =============================================================================
// Facts are verified one by one, but the model also writes free text (short
// description, intro, highlights, usage). That text must not smuggle in:
//   - numbers with units that no verified fact supports ("teor de 16,5%"),
//   - contact data, prices or promotions copied from a marketplace page.
// Offending sentences are removed, never rewritten.

/** Number followed by a unit: a factual claim that needs a source. */
const CLAIM_RE =
  /(\d+(?:[.,]\d+)*)\s?(%|ml\b|l\b|litros?\b|g\b|gramas?\b|kg\b|mg\b|cm\b|mm\b|m\b|kcal\b|cal\b|polegadas?\b|"|x\b|un\b|unidades?\b|pcs\b|pe[cç]as?\b|anos?\b|meses\b|w\b|mah\b|v\b)/giu;

const CONTACT_RE =
  /(https?:\/\/|www\.|[\w.+-]+@[\w-]+\.[a-z]{2,}|whats ?app|\bzap\b|\bpix\b|R\$\s?\d|\(\d{2}\)\s?\d{4,5}-?\d{4}|\+55|frete gr[aá]tis|cupom|desconto|promo[cç][aã]o|parcel[ae])/iu;

/** Numbers that verified data allows the prose to mention. */
export function allowedNumbers(texts: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const t of texts) if (t) for (const n of numbersIn(t)) out.add(n);
  return out;
}

/** "12%" / "360ml" tokens whose number is not backed by verified data. */
export function unbackedClaims(text: string, allowed: Set<string>): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CLAIM_RE)) {
    const numbers = numbersIn(m[1]);
    if (numbers.some((n) => !allowed.has(n))) out.push(m[0].trim());
  }
  return out;
}

export function hasContactOrPromo(text: string): boolean {
  return CONTACT_RE.test(text);
}

function sentences(text: string): string[] {
  return collapseSpaces(text)
    .split(/(?<=[.!?])\s+(?=[\p{Lu}\d"“])/u)
    .filter(Boolean);
}

export type ProseReport = { removed: string[] };

/** Remove sentences with contact data, promotions or unbacked numeric claims. */
export function cleanProse(text: string | null | undefined, allowed: Set<string>, report?: ProseReport): string {
  if (!text) return "";
  const kept: string[] = [];
  for (const sentence of sentences(stripEmoji(text))) {
    const bad = hasContactOrPromo(sentence) || unbackedClaims(sentence, allowed).length > 0;
    if (bad) report?.removed.push(sentence.slice(0, 160));
    else kept.push(sentence);
  }
  return kept.join(" ").trim();
}

/** Titles keep their words; only unbacked number+unit tokens are dropped. */
export function cleanTitle(title: string, allowed: Set<string>): { title: string; removed: string[] } {
  const removed = unbackedClaims(title, allowed);
  if (!removed.length) return { title, removed };
  let out = title;
  for (const token of removed) out = out.replace(token, " ");
  return { title: collapseSpaces(out.replace(/\s+([,.;:])/g, "$1")), removed };
}

/** Case- and accent-insensitive check that a phrase appears in any of the texts. */
export function appearsInAny(phrase: string, texts: string[]): boolean {
  const p = fold(phrase)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (p.length < 2) return false;
  return texts.some((t) => ` ${fold(t).replace(/[^\p{L}\p{N}]+/gu, " ")} `.includes(` ${p} `));
}
