import { fold, isValidGtin } from "@/lib/text/normalize";
import type { Fact, FieldKey, Nutrition, Source, VerifiedFact } from "@/lib/types";

// =============================================================================
// Grounding verification (deterministic, no AI)
// =============================================================================
// Every fact the model returns must cite source ids AND quote a verbatim
// excerpt. A fact is accepted only when:
//   1. at least one cited id exists and the quote is short enough,
//   2. the quote really appears in a cited source (the matched WINDOW of the
//      source text is recovered; the model's own quote is never trusted),
//   3. every number of the quote and of the value appears in that window,
//   4. yes/no statements (gluten, lactose) have the same polarity as the source,
//   5. variant-specific data comes from a window that names the same variant.
// Anything else is kept for transparency but marked unverified, and unverified
// facts never reach the product page.

const CJK = "\\u1100-\\u11ff\\u3131-\\ud79d\\u3040-\\u30ff\\u4e00-\\u9fff";

/** Brazilian numbers: "1.000" -> 1000, "12,5" -> 12.5, "1.250,75" -> 1250.75 */
function normaliseNumbers(text: string): string {
  return text
    .replace(
      /(\d{1,3}(?:\.\d{3})+)(,\d+)?(?!\d)/g,
      (_, int: string, dec?: string) => `${int.replace(/\./g, "")}${dec ? `.${dec.slice(1)}` : ""}`,
    )
    .replace(/(\d),(\d)/g, "$1.$2");
}

function normalise(text: string): string {
  return fold(normaliseNumbers(text))
    .replace(new RegExp(`[^a-z0-9.%${CJK}]+`, "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function numbersIn(text: string): string[] {
  return (normalise(text).match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));
}

function tokensOf(text: string): string[] {
  return normalise(text)
    .split(" ")
    .filter((t) => t.length >= 3 || /\d/.test(t) || new RegExp(`[${CJK}]`).test(t));
}

/**
 * Find the quote inside the source. Returns the matching window of the
 * (normalised) source text, or null. Tolerant to case, accents, punctuation
 * and one or two missing words, but numbers must match exactly.
 */
export function findQuote(quote: string, haystack: string): string | null {
  const q = normalise(quote);
  if (q.length < 3) return null;
  const h = normalise(haystack);
  const at = h.indexOf(q);
  if (at >= 0) return h.slice(Math.max(0, at - 300), at + q.length + 300);

  const qt = tokensOf(quote);
  if (qt.length < 2) return null;
  const words = h.split(" ");
  const want = new Set(qt);
  const quoteNumbers = numbersIn(quote);
  const windowSize = qt.length * 3;
  for (let i = 0; i < words.length; i++) {
    const windowWords = words.slice(i, i + windowSize);
    const set = new Set(windowWords);
    let found = 0;
    for (const t of want) if (set.has(t)) found++;
    if (found / want.size < 0.85) continue;
    const windowNumbers = new Set(numbersIn(windowWords.join(" ")));
    if (quoteNumbers.every((n) => windowNumbers.has(n))) {
      return words.slice(Math.max(0, i - 40), i + windowSize + 40).join(" ");
    }
  }
  return null;
}

/** Boolean helper. */
export function quoteAppearsIn(quote: string, haystack: string): boolean {
  return findQuote(quote, haystack) !== null;
}

// -----------------------------------------------------------------------------
// Polarity (yes/no claims)
// -----------------------------------------------------------------------------

const NEGATION = /\b(nao|sem|isento|livre|free|zero|does not|not contain|no contiene)\b|없음|무첨가|不含|無|无|-free/;
const SUBJECTS: Partial<Record<FieldKey, RegExp>> = {
  gluten: /gluten|trigo|wheat|cevada|centeio|barley|rye|글루텐|밀|グルテン|小麦|麸质|麩質/,
  lactose: /lactose|lactosa|leite|milk|dairy|유당|우유|乳糖|牛乳/,
  allergens:
    /alergic|alergen|allergen|contem|contains|pode conter|may contain|알레르기|アレルギ|过敏|trigo|leite|soja|ovo|amendoim|wheat|milk|soy|egg|peanut/,
};

function polarityOk(field: FieldKey, value: string, window: string): boolean {
  const subject = SUBJECTS[field];
  if (!subject) return true;
  if (!subject.test(window)) return false;
  if (field === "allergens") return true; // lists mix "contém" and "não contém" for different items
  const valueNegative = NEGATION.test(fold(value));
  const sourceNegative = NEGATION.test(window);
  return valueNegative === sourceNegative;
}

// -----------------------------------------------------------------------------
// Variant proximity
// -----------------------------------------------------------------------------

function wordRegex(term: string): RegExp {
  const t = normalise(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Unicode-aware boundaries: "uva" must not match inside "chuva".
  return new RegExp(`(^|[^a-z0-9${CJK}])${t}([^a-z0-9${CJK}]|$)`);
}

export function mentionsAny(text: string, aliases: string[]): boolean {
  const n = ` ${normalise(text)} `;
  return aliases.filter((a) => normalise(a).length >= 2).some((a) => wordRegex(a).test(n));
}

/** Fields whose value changes between flavours/sizes of the same line. */
export const VARIANT_SENSITIVE = new Set<FieldKey>([
  "alcohol_abv",
  "ingredients",
  "allergens",
  "gluten",
  "lactose",
  "gtin",
  "caffeine",
  "color",
]);

export type VerifyOptions = {
  /** Per source id: does the source mention the exact variant? (null = identity has no variant) */
  mentionsVariant?: Map<string, boolean | null>;
  /** Variant name and its aliases (e.g. ["Morango", "Strawberry", "딸기"]). */
  variantAliases?: string[];
};

const MAX_EVIDENCE: Partial<Record<FieldKey, number>> = { ingredients: 900, allergens: 400 };

function numbersSupported(value: string, window: string): boolean {
  const available = new Set(numbersIn(window));
  return numbersIn(value).every((n) => available.has(n));
}

export function verifyFact(fact: Fact, sources: Map<string, Source>, options: VerifyOptions = {}): VerifiedFact {
  const reject = { ...fact, verified: false };
  const cited = fact.sourceIds.map((id) => sources.get(id)).filter((s): s is Source => Boolean(s));
  const evidence = fact.evidence?.trim() ?? "";
  if (!cited.length || !evidence) return reject;
  if (evidence.length > (MAX_EVIDENCE[fact.field] ?? 300)) return reject;
  if (fact.field === "gtin" && !isValidGtin(fact.value.replace(/\s/g, ""))) return reject;

  for (const source of cited) {
    const window = findQuote(evidence, `${source.title}\n${source.text}`);
    if (!window) continue;
    if (!numbersSupported(fact.value, window)) continue;
    if (!polarityOk(fact.field, fact.value, window)) continue;
    if (VARIANT_SENSITIVE.has(fact.field)) {
      const mention = options.mentionsVariant?.get(source.id);
      if (mention === false) continue;
      const aliases = options.variantAliases ?? [];
      // The page names the variant somewhere, but not near this quote (multi-flavour pages).
      if (aliases.length && mention && !mentionsAny(window, aliases)) continue;
    }
    return { ...fact, verified: true };
  }
  return reject;
}

export function verifyFacts(facts: Fact[], sources: Source[], options: VerifyOptions = {}): VerifiedFact[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  return facts.map((f) => verifyFact(f, byId, options));
}

// -----------------------------------------------------------------------------
// Nutrition table
// -----------------------------------------------------------------------------

const NUTRIENT_ALIASES: RegExp[] = [
  /valor energetico|energia|calorias|kcal|energy|calories|열량|エネルギー|能量/,
  /carboidrato|carbohydrate|탄수화물|炭水化物|碳水化合物/,
  /acucares adicionados|added sugar/,
  /acucar|sugar|당류|糖/,
  /proteina|protein|단백질|たんぱく|蛋白质/,
  /gorduras totais|gordura total|total fat|지방|脂質|脂肪/,
  /saturad|saturated|포화지방|飽和/,
  /trans/,
  /fibra|fiber|fibre|식이섬유|食物繊維|膳食纤维/,
  /sodio|sodium|나트륨|ナトリウム|钠/,
];

/**
 * A nutrition table is accepted only when, in ONE cited source about the same
 * variant, every row's number appears within ~120 characters after the
 * nutrient's name (pt, en, ko, ja or zh) and the serving size appears too.
 */
export function verifyNutrition(
  nutrition: Nutrition | null,
  sources: Source[],
  options: VerifyOptions = {},
): Nutrition | null {
  if (!nutrition || nutrition.rows.length < 3) return null;
  const cited = sources.filter(
    (s) => nutrition.sourceIds.includes(s.id) && options.mentionsVariant?.get(s.id) !== false,
  );
  for (const source of cited) {
    const text = normalise(source.text);
    const textNumbers = numbersIn(text);
    const serving = numbersIn(nutrition.servingSize);
    if (serving.length && !serving.every((n) => textNumbers.includes(n))) continue;
    const allRows = nutrition.rows.every((row) => {
      const wanted = numbersIn(row.perServing);
      if (!wanted.length) return false;
      const alias = NUTRIENT_ALIASES.find((re) => re.test(fold(row.nutrient)));
      if (!alias) return wanted.every((n) => textNumbers.includes(n));
      for (const m of text.matchAll(new RegExp(alias.source, "g"))) {
        const start = m.index ?? 0;
        const windowNumbers = numbersIn(text.slice(start, start + 120));
        if (wanted.every((n) => windowNumbers.includes(n))) return true;
      }
      return false;
    });
    if (allRows) return nutrition;
  }
  return null;
}
