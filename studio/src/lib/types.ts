import { z } from "zod";

// =============================================================================
// Input
// =============================================================================

export const JobInputSchema = z.object({
  productName: z
    .string()
    .trim()
    .min(3, "Digite o nome do produto (mínimo 3 letras).")
    .max(200, "Nome muito longo (máximo 200 caracteres)."),
  referenceUrl: z
    .string()
    .trim()
    .url("Cole um link completo, começando com https://")
    .refine((u) => /^https?:\/\//i.test(u), "O link precisa começar com http:// ou https://"),
  stockQuantity: z.coerce
    .number({ message: "Digite a quantidade em estoque." })
    .int("A quantidade precisa ser um número inteiro.")
    .min(0, "A quantidade não pode ser negativa.")
    .max(100_000, "Quantidade muito alta. Confira o número."),
});
export type JobInput = z.infer<typeof JobInputSchema>;

// =============================================================================
// Product kinds and compliance vocabulary
// =============================================================================

export const PRODUCT_KINDS = [
  "food",
  "beverage",
  "alcoholic_beverage",
  "plush_toy",
  "toy",
  "backpack_bag",
  "apparel_footwear",
  "cosmetics",
  "stationery",
  "home_kitchen",
  "electronics",
  "other",
] as const;
export const ProductKindSchema = z.enum(PRODUCT_KINDS);
export type ProductKind = z.infer<typeof ProductKindSchema>;

export const FIELD_KEYS = [
  "brand",
  "net_content",
  "country_of_origin",
  "manufacturer",
  "gtin",
  "ingredients",
  "allergens",
  "gluten",
  "lactose",
  "nutrition",
  "storage",
  "shelf_life",
  "preparation",
  "alcohol_abv",
  "caffeine",
  "material",
  "dimensions",
  "capacity",
  "item_weight",
  "age_grading",
  "inmetro",
  "care",
  "color",
  "size",
  "warranty",
  "usage",
  "package_contents",
  "compatibility",
  "anvisa",
  "anatel",
] as const;
export const FieldKeySchema = z.enum(FIELD_KEYS);
export type FieldKey = z.infer<typeof FieldKeySchema>;

/** Fields a single fact may carry (the nutrition table has its own structured field). */
export const FACT_FIELD_KEYS = FIELD_KEYS.filter((k) => k !== "nutrition");
export const FactFieldSchema = z.enum(FACT_FIELD_KEYS as unknown as [FieldKey, ...FieldKey[]]);

// =============================================================================
// Research
// =============================================================================

export const SourceSchema = z.object({
  id: z.string(), // "S1", "S2", ...
  url: z.string(),
  title: z.string(),
  domain: z.string(),
  origin: z.enum(["reference", "tavily", "exa"]),
  text: z.string(),
  images: z.array(z.string()),
});
export type Source = z.infer<typeof SourceSchema>;

export const IdentitySchema = z.object({
  kind: ProductKindSchema,
  brand: z.string().nullable(),
  manufacturer: z.string().nullable(),
  line: z.string().nullable().describe("Product line or model, e.g. 'Chum-Churum', 'O'Star'"),
  productType: z.string().describe("Generic type in Portuguese, e.g. 'Soju', 'Salgadinho', 'Pelúcia', 'Mochila'"),
  variant: z.string().nullable().describe("Flavour, colour or model variant in Portuguese"),
  variantAliases: z
    .array(z.string())
    .describe(
      "The same variant in English and in the native language, e.g. ['Strawberry', '딸기']; empty if no variant",
    ),
  netContent: z.string().nullable().describe("e.g. '360ml', '30g', '40cm'"),
  packCount: z.number().int().nullable(),
  gtin: z.string().nullable(),
  originCountry: z.string().nullable(),
  searchQueries: z
    .array(z.string())
    .min(2)
    .max(6)
    .describe("Queries in pt-BR, English and the product's native language (Korean/Japanese/Chinese) when known"),
  nativeName: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  notes: z.string(),
});
export type Identity = z.infer<typeof IdentitySchema>;

// =============================================================================
// Synthesis (what the model returns) and the final draft (after validation)
// =============================================================================

export const FactSchema = z.object({
  field: FactFieldSchema,
  label: z.string().describe("Portuguese label shown to buyers, e.g. 'Teor alcoólico'"),
  value: z.string().describe("Value in Brazilian Portuguese, ready for the listing"),
  sourceIds: z.array(z.string()).min(1),
  evidence: z
    .string()
    .describe(
      "Verbatim excerpt (max 220 chars; up to 900 for ingredients) copied from ONE cited source that supports the value, in the source's original language",
    ),
});
export type Fact = z.infer<typeof FactSchema>;

export const NutritionRowSchema = z.object({
  nutrient: z.string(),
  perServing: z.string(),
  dailyValue: z.string().nullable(),
});

export const NutritionSchema = z.object({
  servingSize: z.string(),
  servingsPerPackage: z.string().nullable(),
  rows: z.array(NutritionRowSchema).min(1),
  sourceIds: z.array(z.string()).min(1),
});
export type Nutrition = z.infer<typeof NutritionSchema>;

// What the model is asked to return. Deliberately lenient: one malformed fact
// or a zero weight must not fail the whole (paid) synthesis. toSynthesis()
// normalises it into the strict SynthesisSchema below.
export const SynthesisWireSchema = z.object({
  title: z.string(),
  shortDescription: z.string(),
  introParagraphs: z.array(z.string()),
  highlights: z.array(z.string()).describe("Non-numeric qualities only; numbers and specs belong in facts"),
  usage: z.string().nullable(),
  facts: z.array(
    z.object({
      field: z.string().describe(`One of: ${FIELD_KEYS.filter((k) => k !== "nutrition").join(", ")}`),
      label: z.string(),
      value: z.string(),
      sourceIds: z.array(z.string()),
      evidence: z.string(),
    }),
  ),
  nutrition: z
    .object({
      servingSize: z.string(),
      servingsPerPackage: z.string().nullable(),
      rows: z.array(z.object({ nutrient: z.string(), perServing: z.string(), dailyValue: z.string().nullable() })),
      sourceIds: z.array(z.string()),
    })
    .nullable(),
  sourcedWarnings: z.array(z.object({ text: z.string(), sourceIds: z.array(z.string()), evidence: z.string() })),
  categoryId: z.number().int().nullable(),
  seo: z.object({ metaTitle: z.string(), metaDescription: z.string(), focusKeyword: z.string() }),
  shipping: z.object({
    weightKg: z.number().nullable(),
    lengthCm: z.number().nullable(),
    widthCm: z.number().nullable(),
    heightCm: z.number().nullable(),
  }),
  marketPrices: z.array(z.object({ amount: z.number(), currency: z.string(), sourceId: z.string() })),
});
export type SynthesisWire = z.infer<typeof SynthesisWireSchema>;

export const SynthesisSchema = z.object({
  title: z.string(),
  shortDescription: z.string(),
  introParagraphs: z.array(z.string()).min(1).max(3),
  highlights: z.array(z.string()).max(6),
  usage: z.string().nullable(),
  facts: z.array(FactSchema),
  nutrition: NutritionSchema.nullable(),
  sourcedWarnings: z
    .array(
      z.object({
        text: z.string(),
        sourceIds: z.array(z.string()).min(1),
        evidence: z.string(),
      }),
    )
    .describe(
      "Warnings stated by the sources (e.g. choking hazard, allergy). Legal boilerplate is added by the system.",
    ),
  categoryId: z.number().int().nullable(),
  seo: z.object({
    metaTitle: z.string(),
    metaDescription: z.string(),
    focusKeyword: z.string(),
  }),
  shipping: z.object({
    weightKg: z.number().positive().nullable(),
    lengthCm: z.number().positive().nullable(),
    widthCm: z.number().positive().nullable(),
    heightCm: z.number().positive().nullable(),
  }),
  marketPrices: z.array(
    z.object({
      amount: z.number(),
      currency: z.string(),
      sourceId: z.string(),
    }),
  ),
});
export type Synthesis = z.infer<typeof SynthesisSchema>;

const positiveOrNull = (n: number | null) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null);

/** Normalise the lenient model output: drop invalid facts, clamp numbers, bound arrays. */
export function toSynthesis(wire: SynthesisWire): { synthesis: Synthesis; dropped: string[] } {
  const dropped: string[] = [];
  const facts = wire.facts.flatMap((f) => {
    const parsed = FactSchema.safeParse(f);
    if (parsed.success) return [parsed.data];
    dropped.push(`${f.label || f.field}: ${f.value}`.slice(0, 120));
    return [];
  });
  const nutrition = wire.nutrition ? NutritionSchema.safeParse(wire.nutrition) : null;
  const synthesis: Synthesis = {
    title: wire.title,
    shortDescription: wire.shortDescription,
    introParagraphs: (wire.introParagraphs.length ? wire.introParagraphs : [wire.shortDescription]).slice(0, 3),
    highlights: wire.highlights.slice(0, 6),
    usage: wire.usage,
    facts,
    nutrition: nutrition?.success ? nutrition.data : null,
    sourcedWarnings: wire.sourcedWarnings.filter((w) => w.sourceIds.length && w.evidence.trim()),
    categoryId: wire.categoryId,
    seo: wire.seo,
    shipping: {
      weightKg: positiveOrNull(wire.shipping.weightKg),
      lengthCm: positiveOrNull(wire.shipping.lengthCm),
      widthCm: positiveOrNull(wire.shipping.widthCm),
      heightCm: positiveOrNull(wire.shipping.heightCm),
    },
    marketPrices: wire.marketPrices.filter((p) => Number.isFinite(p.amount) && p.amount > 0),
  };
  return { synthesis: SynthesisSchema.parse(synthesis), dropped };
}

export type Severity = "blocker" | "warning";

export type MissingField = {
  field: FieldKey | "photos";
  label: string;
  severity: Severity;
  why: string;
};

export type VerifiedFact = Fact & { verified: boolean };

export type ProcessedImage = {
  id: string;
  fileName: string;
  alt: string;
  width: number;
  height: number;
  bytes: number;
  sourceUrl: string;
  role: "main" | "gallery";
  reason: string;
};

export type Attribute = { name: string; value: string };

export type ProductDraft = {
  kind: ProductKind;
  title: string;
  slug: string;
  sku: string;
  gtin: string | null;
  brand: string | null;
  /** True when the brand name appears in at least one source (only then may a new brand term be created). */
  brandVerified: boolean;
  category: { id: number; name: string } | null;
  shortDescriptionHtml: string;
  descriptionHtml: string;
  attributes: Attribute[];
  facts: VerifiedFact[];
  nutrition: Nutrition | null;
  warnings: string[];
  seo: Synthesis["seo"];
  shipping: {
    weightKg: number | null;
    lengthCm: number | null;
    widthCm: number | null;
    heightCm: number | null;
    estimated: boolean;
  };
  marketPrices: Synthesis["marketPrices"];
  missing: MissingField[];
  images: ProcessedImage[];
  titleAdjustments: string[];
  complete: boolean;
};

// =============================================================================
// Catalog (WooCommerce) and duplicate detection
// =============================================================================

export type CatalogProduct = {
  id: number;
  name: string;
  slug: string;
  sku: string;
  gtin: string;
  status: string;
  stockQuantity: number | null;
  permalink: string;
  brands: string[];
  hasPrice: boolean;
};

export type DuplicateCandidate = CatalogProduct & {
  score: number;
  reasons: string[];
  /** How the candidate was found: exact barcode, exact SKU, or name similarity. */
  tier: "gtin" | "sku" | "name";
};

export type DuplicateCheck = {
  verdict: "none" | "possible" | "match";
  candidates: DuplicateCandidate[];
};

export type SyncResult = {
  mode: "create" | "update";
  productId: number;
  status: string;
  permalink: string;
  adminUrl: string;
  mediaIds: number[];
  stockQuantity: number;
  /** False when only the stock was updated (incomplete draft on a live product). */
  contentUpdated: boolean;
  notes: string[];
  at: string;
};

// =============================================================================
// Job
// =============================================================================

export const STEP_KEYS = ["reference", "identify", "research", "write", "images", "duplicates", "sync"] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export type StepState = {
  key: StepKey;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  detail: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type JobStatus = "running" | "ready" | "syncing" | "synced" | "failed" | "superseded" | "discarded";

/** Machine-readable failure class, used to show the right advice to the operator. */
export type ErrorCode = "config" | "network" | "credentials" | "quota" | "store" | "ai" | "interrupted" | "unknown";

export type Job = {
  id: string;
  createdAt: string;
  updatedAt: string;
  input: JobInput;
  status: JobStatus;
  steps: StepState[];
  error: string | null;
  errorCode: ErrorCode | null;
  /** Technical detail of the last error (shown collapsed). */
  errorDetail: string | null;
  /** Server process that last ran this job (detects restarts). */
  bootId: string | null;
  /** Set when "Gerar de novo" replaced this job. */
  supersededBy: string | null;
  identity: Identity | null;
  sources: Source[];
  draft: ProductDraft | null;
  duplicates: DuplicateCheck | null;
  sync: SyncResult | null;
  /** Media already uploaded by a sync attempt (file name -> WordPress media id). */
  syncMedia: Record<string, number>;
  usage: { provider: string; operation: string; detail: string }[];
};
