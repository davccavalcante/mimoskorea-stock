import { escapeHtml, safeText, sanitizeProductHtml } from "@/lib/text/html";
import { stripEmoji } from "@/lib/text/normalize";
import type { Attribute, FieldKey, Identity, Nutrition, Synthesis, VerifiedFact } from "@/lib/types";

// =============================================================================
// Deterministic product HTML
// =============================================================================
// The model writes short pieces of copy; the system decides the structure.
// This keeps every listing consistent (same sections, same order, real HTML
// tables) and makes it impossible for the model to inject markup or emoji.

/** Facts shown in the "Especificações" table and as WooCommerce attributes, in this order. */
const SPEC_ORDER: FieldKey[] = [
  "brand",
  "manufacturer",
  "country_of_origin",
  "net_content",
  "alcohol_abv",
  "caffeine",
  "material",
  "dimensions",
  "capacity",
  "item_weight",
  "color",
  "size",
  "age_grading",
  "compatibility",
  "package_contents",
  "gtin",
  "inmetro",
  "anvisa",
  "anatel",
  "warranty",
];

/** Facts rendered as their own section instead of a table row. */
const SECTION_FIELDS: Array<{ field: FieldKey; heading: string }> = [
  { field: "ingredients", heading: "Ingredientes" },
  { field: "allergens", heading: "Alergênicos" },
  { field: "gluten", heading: "Glúten" },
  { field: "lactose", heading: "Lactose" },
  { field: "preparation", heading: "Modo de preparo" },
  { field: "usage", heading: "Modo de uso" },
  { field: "storage", heading: "Conservação" },
  { field: "shelf_life", heading: "Validade" },
  { field: "care", heading: "Cuidados" },
];

/** "manter em local fresco" -> "Manter em local fresco" */
function sentenceStart(text: string): string {
  const t = text.trim();
  return t.charAt(0).toLocaleUpperCase("pt-BR") + t.slice(1);
}

function firstVerified(facts: VerifiedFact[], field: FieldKey): VerifiedFact | undefined {
  return facts.find((f) => f.field === field && f.verified);
}

export function buildAttributes(facts: VerifiedFact[], identity: Identity): Attribute[] {
  const attrs: Attribute[] = [];
  const seen = new Set<string>();
  const push = (name: string, value: string | null | undefined) => {
    const clean = value ? stripEmoji(value).trim() : "";
    if (!clean || seen.has(name)) return;
    seen.add(name);
    attrs.push({ name, value: clean });
  };
  for (const field of SPEC_ORDER) {
    const fact = firstVerified(facts, field);
    if (fact) push(fact.label, fact.value);
  }
  if (identity.variant)
    push(
      identity.kind === "backpack_bag" || identity.kind === "apparel_footwear" ? "Cor / modelo" : "Sabor / variação",
      identity.variant,
    );
  return attrs;
}

function nutritionTable(n: Nutrition): string {
  const rows = n.rows
    .map(
      (r) =>
        `<tr><th scope="row">${safeText(r.nutrient)}</th><td>${safeText(r.perServing)}</td><td>${r.dailyValue ? safeText(r.dailyValue) : "-"}</td></tr>`,
    )
    .join("");
  const servings = n.servingsPerPackage
    ? `<p><small>Porções por embalagem: ${safeText(n.servingsPerPackage)}</small></p>`
    : "";
  return (
    `<h2>Informação nutricional</h2>` +
    `<table><thead><tr><th scope="col">Porção de ${safeText(n.servingSize)}</th><th scope="col">Quantidade</th><th scope="col">%VD*</th></tr></thead><tbody>${rows}</tbody></table>` +
    servings +
    `<p><small>* Percentual de valores diários fornecidos pela porção, conforme informado pelo fabricante.</small></p>`
  );
}

export type ComposeInput = {
  synthesis: Synthesis;
  facts: VerifiedFact[];
  nutrition: Nutrition | null;
  attributes: Attribute[];
  notices: string[];
};

export function composeDescription({ synthesis, facts, nutrition, attributes, notices }: ComposeInput): string {
  const parts: string[] = [];

  for (const p of synthesis.introParagraphs) {
    const text = safeText(p);
    if (text) parts.push(`<p>${text}</p>`);
  }

  const highlights = synthesis.highlights.map((h) => safeText(h)).filter(Boolean);
  if (highlights.length) {
    parts.push(`<h2>Destaques</h2><ul>${highlights.map((h) => `<li>${h}</li>`).join("")}</ul>`);
  }

  if (attributes.length) {
    const rows = attributes
      .map((a) => `<tr><th scope="row">${escapeHtml(a.name)}</th><td>${escapeHtml(a.value)}</td></tr>`)
      .join("");
    parts.push(`<h2>Especificações</h2><table><tbody>${rows}</tbody></table>`);
  }

  for (const { field, heading } of SECTION_FIELDS) {
    const fact = firstVerified(facts, field);
    if (fact) parts.push(`<h2>${heading}</h2><p>${safeText(sentenceStart(fact.value))}</p>`);
  }

  if (synthesis.usage && !firstVerified(facts, "usage") && !firstVerified(facts, "preparation")) {
    parts.push(`<h2>Como aproveitar</h2><p>${safeText(synthesis.usage)}</p>`);
  }

  if (nutrition) parts.push(nutritionTable(nutrition));

  const warnings = [...new Set(notices.map((n) => stripEmoji(n)).filter(Boolean))];
  if (warnings.length) {
    parts.push(
      `<h2>Avisos importantes</h2><ul>${warnings.map((w) => `<li><strong>${escapeHtml(w)}</strong></li>`).join("")}</ul>`,
    );
  }

  return sanitizeProductHtml(parts.join("\n"));
}

export function composeShortDescription(synthesis: Synthesis, notices: string[]): string {
  const text = safeText(synthesis.shortDescription);
  const legal = notices.length ? `<p><small>${escapeHtml(notices[0])}</small></p>` : "";
  return sanitizeProductHtml(`<p>${text}</p>${legal}`);
}
