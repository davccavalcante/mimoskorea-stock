import { fold, isValidGtin } from "@/lib/text/normalize";
import type { Fact, Nutrition, Source, VerifiedFact } from "@/lib/types";

// =============================================================================
// Grounding verification (deterministic, no AI)
// =============================================================================
// Every fact the model returns must cite source ids AND quote a verbatim
// excerpt. A fact is accepted only when:
//   1. at least one cited id exists,
//   2. the quoted evidence really appears in one of the cited sources, and
//   3. every number in the value also appears in that evidence.
// Anything else is kept for transparency but marked unverified, and unverified
// facts never reach the product page.

function normalise(text: string): string {
  return fold(text)
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^a-z0-9.%\u1100-\u11ff\u3131-\ud79d\u3040-\u30ff\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numbersIn(text: string): string[] {
  return (normalise(text).match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));
}

function tokensOf(text: string): string[] {
  return normalise(text)
    .split(" ")
    .filter((t) => t.length >= 3 || /\d/.test(t) || /[\u1100-\u11ff\u3131-\ud79d\u3040-\u30ff\u4e00-\u9fff]/.test(t));
}

/** True when `quote` appears in `haystack`, tolerant to case, accents, punctuation and small gaps. */
export function quoteAppearsIn(quote: string, haystack: string): boolean {
  const q = normalise(quote);
  if (q.length < 3) return false;
  const h = normalise(haystack);
  if (h.includes(q)) return true;
  const qt = tokensOf(quote);
  if (qt.length < 2) return false;
  const ht = new Set(tokensOf(haystack));
  const hits = qt.filter((t) => ht.has(t)).length;
  if (hits / qt.length < 0.85) return false;
  // Require the quote's tokens to be near each other (not scattered across the page).
  const words = h.split(" ");
  const want = new Set(qt);
  const windowSize = qt.length * 3;
  for (let i = 0; i < words.length; i++) {
    const window = new Set(words.slice(i, i + windowSize));
    let found = 0;
    for (const t of want) if (window.has(t)) found++;
    if (found / want.size >= 0.8) return true;
  }
  return false;
}

function numbersSupported(value: string, evidence: string): boolean {
  const evidenceNumbers = new Set(numbersIn(evidence));
  return numbersIn(value).every((n) => evidenceNumbers.has(n));
}

/** Fields whose value changes between flavours/sizes of the same line. */
export const VARIANT_SENSITIVE = new Set<Fact["field"]>([
  "alcohol_abv",
  "ingredients",
  "allergens",
  "gluten",
  "lactose",
  "gtin",
  "caffeine",
  "nutrition",
  "color",
]);

export type VerifyOptions = {
  /** Per source id: does the source mention the exact variant? (null = identity has no variant) */
  mentionsVariant?: Map<string, boolean | null>;
};

export function verifyFact(fact: Fact, sources: Map<string, Source>, options: VerifyOptions = {}): VerifiedFact {
  const cited = fact.sourceIds.map((id) => sources.get(id)).filter((s): s is Source => Boolean(s));
  if (!cited.length || !fact.evidence?.trim()) return { ...fact, verified: false };
  const supporting = cited.filter((s) => quoteAppearsIn(fact.evidence, `${s.title}\n${s.text}`));
  if (!supporting.length) return { ...fact, verified: false };
  if (VARIANT_SENSITIVE.has(fact.field) && options.mentionsVariant) {
    const ok = supporting.some((s) => options.mentionsVariant?.get(s.id) !== false);
    if (!ok) return { ...fact, verified: false };
  }
  if (!numbersSupported(fact.value, fact.evidence)) return { ...fact, verified: false };
  if (fact.field === "gtin" && !isValidGtin(fact.value.replace(/\s/g, ""))) return { ...fact, verified: false };
  return { ...fact, verified: true };
}

export function verifyFacts(facts: Fact[], sources: Source[], options: VerifyOptions = {}): VerifiedFact[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  return facts.map((f) => verifyFact(f, byId, options));
}

/** Nutrition tables are accepted when most of their numbers appear in the cited sources. */
export function verifyNutrition(
  nutrition: Nutrition | null,
  sources: Source[],
  options: VerifyOptions = {},
): Nutrition | null {
  if (!nutrition) return null;
  const text = sources
    .filter((s) => nutrition.sourceIds.includes(s.id) && options.mentionsVariant?.get(s.id) !== false)
    .map((s) => s.text)
    .join("\n");
  if (!text) return null;
  const available = new Set(numbersIn(text));
  const wanted = nutrition.rows.flatMap((r) => numbersIn(`${r.perServing} ${r.dailyValue ?? ""}`));
  if (wanted.length < 3) return null;
  const hits = wanted.filter((n) => available.has(n)).length;
  return hits / wanted.length >= 0.8 ? nutrition : null;
}
