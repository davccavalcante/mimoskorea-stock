import "server-only";
import { findMissing, legalNotices, verifiedAbv } from "@/lib/pipeline/compliance";
import { buildAttributes, composeDescription, composeShortDescription } from "@/lib/pipeline/compose";
import { synthesizePrompt, synthesizeSystem } from "@/lib/pipeline/prompts";
import {
  allowedNumbers,
  appearsInAny,
  cleanProse,
  cleanTitle,
  hasContactOrPromo,
  type ProseReport,
} from "@/lib/pipeline/prose";
import { mentionsVariant, variantAliases } from "@/lib/pipeline/research";
import { buildSku } from "@/lib/pipeline/sku";
import { quoteAppearsIn, verifyFacts, verifyNutrition } from "@/lib/pipeline/verify";
import type { CatalogCategory } from "@/lib/providers/catalog";
import type { LlmProvider } from "@/lib/providers/llm";
import { collapseSpaces, enforceTitleRules, isValidGtin, slugify, stripEmoji, titleCasePt } from "@/lib/text/normalize";
import {
  type Identity,
  type JobInput,
  type ProductDraft,
  type ProductKind,
  type Source,
  SynthesisWireSchema,
  toSynthesis,
  type VerifiedFact,
} from "@/lib/types";

// =============================================================================
// Write the listing: model synthesis + deterministic verification/assembly
// =============================================================================
// The model proposes; deterministic code decides. Facts are checked against
// the cited sources, free text is stripped of unbacked numbers and contact
// data, the barcode and brand come only from verified data, and the legal
// product kind (18+ notice) cannot be lowered by the model.

export type WriteOptions = { storeName: string; titleMaxChars: number };

function fallbackTitle(identity: Identity, netContent: string | null): string {
  return titleCasePt(
    collapseSpaces(
      [
        identity.productType,
        identity.brand,
        identity.line,
        identity.variant ? `Sabor ${identity.variant}` : null,
        netContent,
      ]
        .filter(Boolean)
        .join(" "),
    ),
  );
}

/** Verified facts rendered as short highlight bullets (used when the model's bullets were removed). */
function factHighlights(facts: VerifiedFact[]): string[] {
  const order = ["net_content", "alcohol_abv", "country_of_origin", "material", "capacity", "age_grading"];
  return order
    .map((field) => facts.find((f) => f.field === field && f.verified))
    .filter((f): f is VerifiedFact => Boolean(f))
    .map((f) => `${f.label}: ${stripEmoji(f.value)}`);
}

export async function writeListing(args: {
  input: JobInput;
  identity: Identity;
  sources: Source[];
  categories: CatalogCategory[];
  llm: LlmProvider;
  options: WriteOptions;
}): Promise<{ draft: Omit<ProductDraft, "images">; usage: string; notes: string[] }> {
  const { input, identity, sources, categories, llm, options } = args;
  const notes: string[] = [];

  const variantMap = new Map(sources.map((s) => [s.id, mentionsVariant(identity, `${s.title} ${s.text}`)]));
  const annotated = sources.map((s) => ({ ...s, mentionsVariant: variantMap.get(s.id) ?? null }));

  const { data: wire, usage } = await llm.generateJson({
    operation: "write",
    system: synthesizeSystem(options.storeName, options.titleMaxChars),
    prompt: synthesizePrompt({ input, identity, sources: annotated, categories }),
    schema: SynthesisWireSchema,
    thinking: "high",
  });
  const { synthesis, dropped } = toSynthesis(wire);
  if (dropped.length) notes.push(`${dropped.length} informação(ões) em formato inválido descartada(s)`);

  // --- Verify every fact against its cited source ---------------------------
  const verifyOptions = { mentionsVariant: variantMap, variantAliases: variantAliases(identity) };
  const facts = verifyFacts(synthesis.facts, sources, verifyOptions);
  const nutrition = verifyNutrition(synthesis.nutrition, sources, verifyOptions);

  // --- Legal kind: a verified alcohol content always means 18+ --------------
  let kind: ProductKind = identity.kind;
  if (kind !== "alcoholic_beverage" && verifiedAbv(facts) !== null) {
    kind = "alcoholic_beverage";
    notes.push("Teor alcoólico confirmado: tratado como bebida alcoólica (aviso de 18 anos incluído)");
  }

  // --- Numbers the free text may mention -------------------------------------
  const verifiedNet = facts.find((f) => f.field === "net_content" && f.verified)?.value ?? null;
  const allowed = allowedNumbers([
    ...facts.filter((f) => f.verified).map((f) => f.value),
    ...(nutrition ? nutrition.rows.map((r) => r.perServing) : []),
    nutrition?.servingSize,
    identity.netContent,
    identity.packCount ? String(identity.packCount) : null,
    input.productName,
  ]);
  const prose: ProseReport = { removed: [] };

  // --- Title, slug, SKU, GTIN, brand, category -------------------------------
  const rules = { storeName: options.storeName, maxChars: options.titleMaxChars };
  const cleanedTitle = cleanTitle(synthesis.title, allowed);
  let { title, adjustments } = enforceTitleRules(cleanedTitle.title, rules);
  if (cleanedTitle.removed.length)
    adjustments.push(`Número sem fonte removido do título: ${cleanedTitle.removed.join(", ")}`);
  if (title.length < 10) {
    ({ title, adjustments } = enforceTitleRules(fallbackTitle(identity, verifiedNet ?? identity.netContent), rules));
    adjustments.push("Título montado a partir da identificação do produto");
  }

  // Barcode only from a verified fact: a wrong EAN attaches the listing to another product on Google Shopping.
  const gtinFact = facts.find((f) => f.field === "gtin" && f.verified);
  const gtinCandidate = (gtinFact?.value ?? "").replace(/\D/g, "");
  const gtin = isValidGtin(gtinCandidate) ? gtinCandidate : null;

  const brandFact = facts.find((f) => f.field === "brand" && f.verified);
  const brand = stripEmoji(brandFact?.value ?? identity.brand ?? "") || null;
  const sourceTexts = sources.map((s) => `${s.title}\n${s.text}`);
  const brandVerified = Boolean(brand && (brandFact || appearsInAny(brand, sourceTexts)));
  const category = categories.find((c) => c.id === synthesis.categoryId) ?? null;

  // --- Free text: remove unbacked numbers, contact data and promotions -------
  const intro = synthesis.introParagraphs.map((p) => cleanProse(p, allowed, prose)).filter(Boolean);
  const shortDescription =
    cleanProse(synthesis.shortDescription, allowed, prose) || intro[0]?.split(/(?<=[.!?])\s/)[0] || title;
  let highlights = synthesis.highlights.map((h) => cleanProse(h, allowed, prose)).filter((h) => h && !/\d/.test(h));
  if (highlights.length < 2) highlights = [...highlights, ...factHighlights(facts)].slice(0, 5);
  const usageText = cleanProse(synthesis.usage, allowed, prose) || null;
  if (prose.removed.length)
    notes.push(`${prose.removed.length} frase(s) sem fonte ou com contato/promoção removida(s)`);
  const cleaned = {
    ...synthesis,
    shortDescription,
    introParagraphs: intro.length ? intro : [shortDescription],
    highlights,
    usage: usageText,
  };

  // --- Warnings: deterministic legal text + verified source warnings ---------
  const byId = new Map(sources.map((s) => [s.id, s]));
  const sourced = synthesis.sourcedWarnings
    .filter((w) => w.sourceIds.some((id) => byId.get(id) && quoteAppearsIn(w.evidence, byId.get(id)?.text ?? "")))
    .map((w) => stripEmoji(w.text))
    .filter((w) => w && !hasContactOrPromo(w));
  const notices = [...legalNotices(kind), ...sourced];

  // --- HTML ------------------------------------------------------------------
  const attributes = buildAttributes(facts, { ...identity, kind });
  if (brand && !attributes.some((a) => a.name === "Marca")) attributes.unshift({ name: "Marca", value: brand });

  const descriptionHtml = composeDescription({ synthesis: cleaned, facts, nutrition, attributes, notices });
  const shortDescriptionHtml = composeShortDescription(cleaned, kind === "alcoholic_beverage" ? notices : []);

  const missing = findMissing(kind, facts, { hasNutrition: Boolean(nutrition), brand });
  const shipping = {
    weightKg: synthesis.shipping.weightKg,
    lengthCm: synthesis.shipping.lengthCm,
    widthCm: synthesis.shipping.widthCm,
    heightCm: synthesis.shipping.heightCm,
    estimated: !facts.some((f) => f.field === "item_weight" && f.verified),
  };

  const seoText = (text: string, max: number) => {
    const clean = cleanProse(text, allowed);
    return (clean || title).slice(0, max);
  };

  const draft: Omit<ProductDraft, "images"> = {
    kind,
    title,
    slug: slugify(title),
    sku: buildSku(identity),
    gtin,
    brand,
    brandVerified,
    category: category ? { id: category.id, name: category.name } : null,
    shortDescriptionHtml,
    descriptionHtml,
    attributes,
    facts,
    nutrition,
    warnings: notices,
    seo: {
      metaTitle: seoText(synthesis.seo.metaTitle, 60),
      metaDescription: seoText(synthesis.seo.metaDescription, 160),
      focusKeyword: stripEmoji(synthesis.seo.focusKeyword).slice(0, 60),
    },
    shipping,
    marketPrices: synthesis.marketPrices.filter((p) => byId.has(p.sourceId)),
    missing,
    titleAdjustments: adjustments,
    complete: !missing.some((m) => m.severity === "blocker"),
  };
  return { draft, usage, notes };
}
