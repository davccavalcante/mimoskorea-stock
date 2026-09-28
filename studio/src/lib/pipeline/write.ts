import "server-only";
import { findMissing, legalNotices } from "@/lib/pipeline/compliance";
import { buildAttributes, composeDescription, composeShortDescription } from "@/lib/pipeline/compose";
import { synthesizePrompt, synthesizeSystem } from "@/lib/pipeline/prompts";
import { mentionsVariant } from "@/lib/pipeline/research";
import { buildSku } from "@/lib/pipeline/sku";
import { quoteAppearsIn, verifyFacts, verifyNutrition } from "@/lib/pipeline/verify";
import type { CatalogCategory } from "@/lib/providers/catalog";
import type { LlmProvider } from "@/lib/providers/llm";
import { collapseSpaces, enforceTitleRules, isValidGtin, slugify, stripEmoji, titleCasePt } from "@/lib/text/normalize";
import { type Identity, type JobInput, type ProductDraft, type Source, SynthesisSchema } from "@/lib/types";

// =============================================================================
// Write the listing: model synthesis + deterministic verification/assembly
// =============================================================================

export type WriteOptions = { storeName: string; titleMaxChars: number };

function fallbackTitle(identity: Identity): string {
  return titleCasePt(
    collapseSpaces(
      [
        identity.productType,
        identity.brand,
        identity.line,
        identity.variant ? `Sabor ${identity.variant}` : null,
        identity.netContent,
      ]
        .filter(Boolean)
        .join(" "),
    ),
  );
}

export async function writeListing(args: {
  input: JobInput;
  identity: Identity;
  sources: Source[];
  categories: CatalogCategory[];
  llm: LlmProvider;
  options: WriteOptions;
}): Promise<{ draft: Omit<ProductDraft, "images">; usage: string }> {
  const { input, identity, sources, categories, llm, options } = args;

  const variantMap = new Map(sources.map((s) => [s.id, mentionsVariant(identity, `${s.title} ${s.text}`)]));
  const annotated = sources.map((s) => ({
    ...s,
    mentionsVariant: variantMap.get(s.id) ?? null,
  }));

  const { data: synthesis, usage } = await llm.generateJson({
    operation: "write",
    system: synthesizeSystem(options.storeName, options.titleMaxChars),
    prompt: synthesizePrompt({
      input,
      identity,
      sources: annotated,
      categories,
    }),
    schema: SynthesisSchema,
    thinking: "high",
  });

  // --- Verify every fact against its cited source ---------------------------
  const facts = verifyFacts(synthesis.facts, sources, {
    mentionsVariant: variantMap,
  });
  const nutrition = verifyNutrition(synthesis.nutrition, sources, {
    mentionsVariant: variantMap,
  });

  // --- Title, slug, SKU, GTIN, brand, category -------------------------------
  const rules = {
    storeName: options.storeName,
    maxChars: options.titleMaxChars,
  };
  let { title, adjustments } = enforceTitleRules(synthesis.title, rules);
  if (title.length < 10) {
    ({ title, adjustments } = enforceTitleRules(fallbackTitle(identity), rules));
    adjustments.push("Título montado a partir da identificação do produto");
  }
  const gtinFact = facts.find((f) => f.field === "gtin" && f.verified);
  const gtinCandidate = (gtinFact?.value ?? identity.gtin ?? "").replace(/\D/g, "");
  const gtin = isValidGtin(gtinCandidate) ? gtinCandidate : null;
  const brandFact = facts.find((f) => f.field === "brand" && f.verified);
  const brand = stripEmoji(brandFact?.value ?? identity.brand ?? "") || null;
  const category = categories.find((c) => c.id === synthesis.categoryId) ?? null;

  // --- Warnings: deterministic legal text + verified source warnings ---------
  const byId = new Map(sources.map((s) => [s.id, s]));
  const sourced = synthesis.sourcedWarnings
    .filter((w) => w.sourceIds.some((id) => byId.get(id) && quoteAppearsIn(w.evidence, byId.get(id)?.text ?? "")))
    .map((w) => stripEmoji(w.text));
  const notices = [...legalNotices(identity.kind), ...sourced];

  // --- HTML ------------------------------------------------------------------
  const attributes = buildAttributes(facts, identity);
  if (brand && !attributes.some((a) => a.name === "Marca")) attributes.unshift({ name: "Marca", value: brand });

  const descriptionHtml = composeDescription({
    synthesis,
    facts,
    nutrition,
    attributes,
    notices,
  });
  const shortDescriptionHtml = composeShortDescription(
    synthesis,
    identity.kind === "alcoholic_beverage" ? notices : [],
  );

  const missing = findMissing(identity.kind, facts, {
    hasNutrition: Boolean(nutrition),
    brand,
  });
  const shipping = {
    weightKg: synthesis.shipping.weightKg,
    lengthCm: synthesis.shipping.lengthCm,
    widthCm: synthesis.shipping.widthCm,
    heightCm: synthesis.shipping.heightCm,
    estimated: !facts.some((f) => f.field === "item_weight" && f.verified),
  };

  const draft: Omit<ProductDraft, "images"> = {
    kind: identity.kind,
    title,
    slug: slugify(title),
    sku: buildSku(identity),
    gtin,
    brand,
    category: category ? { id: category.id, name: category.name } : null,
    shortDescriptionHtml,
    descriptionHtml,
    attributes,
    facts,
    nutrition,
    warnings: notices,
    seo: {
      metaTitle: stripEmoji(synthesis.seo.metaTitle).slice(0, 60),
      metaDescription: stripEmoji(synthesis.seo.metaDescription).slice(0, 160),
      focusKeyword: stripEmoji(synthesis.seo.focusKeyword),
    },
    shipping,
    marketPrices: synthesis.marketPrices.filter((p) => byId.has(p.sourceId)),
    missing,
    titleAdjustments: adjustments,
    complete: !missing.some((m) => m.severity === "blocker"),
  };
  return { draft, usage };
}
