import { fold } from "./normalize";

// =============================================================================
// Product similarity (duplicate guard)
// =============================================================================
// The audit found the same item listed up to three times because the catalogue
// was "restocked" by creating new listings. This module decides whether a new
// product is the same sellable item as an existing one. A different flavour,
// colour or size is NOT a duplicate.

const GENERIC = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "com",
  "sem",
  "para",
  "em",
  "a",
  "o",
  "no",
  "na",
  "c",
  "coreano",
  "coreana",
  "coreanos",
  "coreanas",
  "korea",
  "koreia",
  "coreia",
  "kpop",
  "importado",
  "importada",
  "original",
  "snack",
  "salgadinho",
  "salgadinhos",
  "bebida",
  "sabor",
  "sabores",
  "cor",
  "unidade",
  "unidades",
  "un",
  "kit",
  "caixa",
  "pacote",
  "mimos",
  "design",
  "mkd",
  "premium",
  "produto",
  "novo",
  "crocante",
]);

const UNIT_RE = /(\d+(?:[.,]\d+)?)\s?(ml|l|g|kg|cm|mm|un|unid|unidades)\b/gi;

export type Measure = { value: number; unit: "ml" | "g" | "cm" | "un" };

export function measures(text: string): Measure[] {
  const out: Measure[] = [];
  for (const m of fold(text).matchAll(UNIT_RE)) {
    let value = Number(m[1].replace(",", "."));
    let unit = m[2].toLowerCase();
    if (unit === "l") {
      value *= 1000;
      unit = "ml";
    }
    if (unit === "kg") {
      value *= 1000;
      unit = "g";
    }
    if (unit === "mm") {
      value /= 10;
      unit = "cm";
    }
    if (unit.startsWith("un")) unit = "un";
    out.push({ value, unit: unit as Measure["unit"] });
  }
  return out;
}

export function tokens(text: string): Set<string> {
  const cleaned = fold(text)
    .replace(UNIT_RE, " ")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, " ");
  return new Set(cleaned.split(" ").filter((t) => t.length > 1 && !GENERIC.has(t)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function sameMeasure(a: Measure[], b: Measure[]): "same" | "different" | "unknown" {
  for (const ma of a) {
    for (const mb of b) {
      if (ma.unit !== mb.unit) continue;
      const diff = Math.abs(ma.value - mb.value) / Math.max(ma.value, mb.value);
      return diff <= 0.03 ? "same" : "different";
    }
  }
  return "unknown";
}

export type Comparable = {
  title: string;
  brand?: string | null;
  variant?: string | null;
  netContent?: string | null;
  gtin?: string | null;
  sku?: string | null;
};

export type CandidateLike = {
  name: string;
  sku: string;
  gtin: string;
  brands: string[];
};

export function compareProducts(item: Comparable, candidate: CandidateLike): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  if (item.gtin && candidate.gtin && item.gtin.replace(/\D/g, "") === candidate.gtin.replace(/\D/g, "")) {
    return { score: 1, reasons: ["Mesmo código de barras (EAN)"] };
  }
  if (item.sku && candidate.sku && item.sku.toUpperCase() === candidate.sku.toUpperCase()) {
    return { score: 0.98, reasons: ["Mesmo SKU"] };
  }

  const itemTokens = tokens([item.title, item.brand, item.variant].filter(Boolean).join(" "));
  const candTokens = tokens([candidate.name, ...candidate.brands].join(" "));
  let score = jaccard(itemTokens, candTokens);
  reasons.push(`Nomes ${Math.round(score * 100)}% parecidos`);

  const brandTokens = item.brand ? tokens(item.brand) : new Set<string>();
  if (brandTokens.size && [...brandTokens].every((t) => candTokens.has(t))) {
    score += 0.1;
    reasons.push("Mesma marca");
  }

  const variantTokens = item.variant ? tokens(item.variant) : new Set<string>();
  if (variantTokens.size) {
    const hits = [...variantTokens].filter((t) => candTokens.has(t)).length;
    if (hits === variantTokens.size) {
      score += 0.15;
      reasons.push("Mesmo sabor/cor/variação");
    } else if (hits === 0) {
      score = Math.min(score, 0.45);
      reasons.push("Sabor/cor/variação diferente");
    }
  }

  const size = sameMeasure(measures([item.netContent, item.title].filter(Boolean).join(" ")), measures(candidate.name));
  if (size === "same") {
    score += 0.1;
    reasons.push("Mesmo tamanho/conteúdo");
  } else if (size === "different") {
    score = Math.min(score, 0.45);
    reasons.push("Tamanho/conteúdo diferente");
  }

  return { score: Math.max(0, Math.min(1, Number(score.toFixed(3)))), reasons };
}

export const MATCH_THRESHOLD = 0.8;
export const POSSIBLE_THRESHOLD = 0.55;
