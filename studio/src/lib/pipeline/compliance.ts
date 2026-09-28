import { numbersIn } from "@/lib/pipeline/verify";
import { fold } from "@/lib/text/normalize";
import type { FieldKey, Identity, MissingField, ProductKind, Severity, VerifiedFact } from "@/lib/types";

// =============================================================================
// Compliance profiles per product kind
// =============================================================================
// What a Brazilian buyer (and CDC art. 31 / Decreto 7.962/2013) expects to see
// on the listing. "blocker" fields send the product to WooCommerce as
// "pending" (awaiting the owner's approval) instead of publishing it.
// "warning" fields are shown to the operator but do not change the status.
// Legal boilerplate is deterministic text owned by the system, never by the AI.

export const FIELD_LABELS: Record<FieldKey, string> = {
  brand: "Marca",
  net_content: "Conteúdo líquido",
  country_of_origin: "País de origem",
  manufacturer: "Fabricante / importador",
  gtin: "Código de barras (EAN)",
  ingredients: "Ingredientes",
  allergens: "Alergênicos",
  gluten: "Contém / não contém glúten",
  lactose: "Lactose",
  nutrition: "Tabela nutricional",
  storage: "Conservação",
  shelf_life: "Validade",
  preparation: "Modo de preparo",
  alcohol_abv: "Teor alcoólico",
  caffeine: "Cafeína",
  material: "Material / composição",
  dimensions: "Dimensões",
  capacity: "Capacidade",
  item_weight: "Peso do item",
  age_grading: "Faixa etária",
  inmetro: "Certificação INMETRO",
  care: "Cuidados / limpeza",
  color: "Cor",
  size: "Tamanho",
  warranty: "Garantia",
  usage: "Modo de uso",
  package_contents: "Conteúdo da embalagem",
  compatibility: "Compatibilidade",
  anvisa: "Registro / notificação ANVISA",
  anatel: "Homologação ANATEL",
};

type Rule = { field: FieldKey; severity: Severity; why: string };

const FOOD_RULES: Rule[] = [
  {
    field: "net_content",
    severity: "blocker",
    why: "Quantidade é informação essencial (CDC art. 31).",
  },
  {
    field: "ingredients",
    severity: "blocker",
    why: "Composição do alimento (CDC art. 31; rotulagem ANVISA).",
  },
  {
    field: "allergens",
    severity: "blocker",
    why: "Alergênicos devem ser informados (rotulagem ANVISA).",
  },
  {
    field: "gluten",
    severity: "blocker",
    why: '"Contém / não contém glúten" é obrigatório (Lei 10.674/2003).',
  },
  {
    field: "nutrition",
    severity: "blocker",
    why: "Tabela nutricional (RDC 429/2020 e IN 75/2020).",
  },
  {
    field: "country_of_origin",
    severity: "warning",
    why: "Origem do produto importado (CDC art. 31).",
  },
  {
    field: "storage",
    severity: "warning",
    why: "Instruções de conservação ajudam o cliente e evitam reclamações.",
  },
  {
    field: "manufacturer",
    severity: "warning",
    why: "Identificação do fabricante ou importador.",
  },
  {
    field: "gtin",
    severity: "warning",
    why: "EAN melhora Google Shopping e evita duplicatas.",
  },
];

const PROFILES: Record<ProductKind, Rule[]> = {
  food: FOOD_RULES,
  beverage: [
    ...FOOD_RULES,
    {
      field: "caffeine",
      severity: "warning",
      why: "Informe se contém cafeína (bebidas de café, chá, energéticos).",
    },
  ],
  alcoholic_beverage: [
    {
      field: "alcohol_abv",
      severity: "blocker",
      why: "Teor alcoólico é característica essencial (CDC art. 31).",
    },
    {
      field: "net_content",
      severity: "blocker",
      why: "Quantidade é informação essencial (CDC art. 31).",
    },
    { field: "ingredients", severity: "warning", why: "Composição da bebida." },
    {
      field: "country_of_origin",
      severity: "warning",
      why: "Origem do produto importado.",
    },
    {
      field: "allergens",
      severity: "warning",
      why: "Alergênicos, quando houver.",
    },
    {
      field: "gtin",
      severity: "warning",
      why: "EAN melhora Google Shopping e evita duplicatas.",
    },
  ],
  plush_toy: [
    {
      field: "material",
      severity: "blocker",
      why: "Composição do tecido e enchimento.",
    },
    {
      field: "age_grading",
      severity: "blocker",
      why: "Faixa etária indicada é exigida para brinquedos.",
    },
    {
      field: "dimensions",
      severity: "warning",
      why: "Tamanho real evita devoluções.",
    },
    {
      field: "inmetro",
      severity: "warning",
      why: "Brinquedos exigem selo INMETRO: confirme na embalagem.",
    },
    { field: "care", severity: "warning", why: "Como lavar / limpar." },
  ],
  toy: [
    {
      field: "age_grading",
      severity: "blocker",
      why: "Faixa etária indicada é exigida para brinquedos.",
    },
    { field: "material", severity: "warning", why: "Material do brinquedo." },
    {
      field: "inmetro",
      severity: "warning",
      why: "Brinquedos exigem selo INMETRO: confirme na embalagem.",
    },
    {
      field: "package_contents",
      severity: "warning",
      why: "O que vem na caixa.",
    },
  ],
  backpack_bag: [
    {
      field: "material",
      severity: "blocker",
      why: "Material externo e forro.",
    },
    {
      field: "dimensions",
      severity: "blocker",
      why: "Medidas (altura x largura x profundidade).",
    },
    { field: "capacity", severity: "warning", why: "Capacidade em litros." },
    {
      field: "compatibility",
      severity: "warning",
      why: "Tamanho de notebook compatível.",
    },
    { field: "care", severity: "warning", why: "Como limpar." },
    { field: "warranty", severity: "warning", why: "Garantia do produto." },
  ],
  apparel_footwear: [
    { field: "material", severity: "blocker", why: "Composição têxtil." },
    { field: "size", severity: "blocker", why: "Tamanho / numeração." },
    { field: "care", severity: "warning", why: "Instruções de lavagem." },
  ],
  cosmetics: [
    { field: "ingredients", severity: "blocker", why: "Composição (INCI)." },
    { field: "net_content", severity: "blocker", why: "Quantidade." },
    { field: "usage", severity: "warning", why: "Modo de uso." },
    {
      field: "anvisa",
      severity: "warning",
      why: "Cosméticos importados precisam de regularização na ANVISA.",
    },
  ],
  stationery: [
    { field: "material", severity: "warning", why: "Material." },
    { field: "dimensions", severity: "warning", why: "Medidas." },
    {
      field: "package_contents",
      severity: "warning",
      why: "Quantidade de itens.",
    },
  ],
  home_kitchen: [
    {
      field: "material",
      severity: "warning",
      why: "Material (contato com alimentos?).",
    },
    { field: "dimensions", severity: "warning", why: "Medidas / capacidade." },
    { field: "care", severity: "warning", why: "Limpeza e uso." },
  ],
  electronics: [
    { field: "dimensions", severity: "warning", why: "Medidas." },
    { field: "warranty", severity: "warning", why: "Garantia." },
    {
      field: "anatel",
      severity: "warning",
      why: "Produtos com rádio (Bluetooth/Wi-Fi) exigem homologação ANATEL.",
    },
    {
      field: "inmetro",
      severity: "warning",
      why: "Alguns eletrônicos exigem certificação INMETRO.",
    },
  ],
  other: [
    { field: "material", severity: "warning", why: "Material." },
    { field: "dimensions", severity: "warning", why: "Medidas." },
  ],
};

const COMMON_RULES: Rule[] = [
  {
    field: "brand",
    severity: "warning",
    why: "Marca ajuda na busca e no Google Shopping.",
  },
];

export function requiredFields(kind: ProductKind): Rule[] {
  return [...PROFILES[kind], ...COMMON_RULES];
}

/** Fields required by the profile that are not backed by a verified fact (nutrition only via the verified table). */
export function findMissing(
  kind: ProductKind,
  facts: VerifiedFact[],
  extra: { hasNutrition: boolean; brand: string | null },
): MissingField[] {
  const present = new Set(facts.filter((f) => f.verified && f.field !== "nutrition").map((f) => f.field));
  if (extra.hasNutrition) present.add("nutrition");
  if (extra.brand) present.add("brand");
  return requiredFields(kind)
    .filter((rule) => !present.has(rule.field))
    .map((rule) => ({
      field: rule.field,
      label: FIELD_LABELS[rule.field],
      severity: rule.severity,
      why: rule.why,
    }));
}

// =============================================================================
// Deterministic legal notices
// =============================================================================

export const ALCOHOL_NOTICES = [
  "Venda e consumo proibidos para menores de 18 anos.",
  "Beba com moderação. Se beber, não dirija.",
];

export const TOY_NOTICES = ["Verifique o selo de conformidade INMETRO e a faixa etária indicada na embalagem."];

export function legalNotices(kind: ProductKind): string[] {
  if (kind === "alcoholic_beverage") return ALCOHOL_NOTICES;
  if (kind === "plush_toy" || kind === "toy") return TOY_NOTICES;
  return [];
}

// =============================================================================
// Deterministic product kind for legal purposes
// =============================================================================
// The 18+ notice must never depend on the model's classification alone: words
// that name an alcoholic drink, or a verified alcohol content, force the kind.

const ALCOHOL_RE =
  /\b(soju|cervejas?|beer|vinhos?|wine|sake|saque|makgeolli|licor|liqueur|whisky|whiskey|vodka|gin|rum|cachaca|baijiu|shochu|umeshu|chuhai|highball|bebida alcoolica|destilado|espumante|champagne|sidra|cider|hard seltzer)\b|소주|막걸리|맥주|와인|청주|과실주|焼酎|梅酒|清酒|白酒|啤酒|日本酒/;

/** Things that merely taste like or relate to a drink (a soju-flavoured candy, a wine glass). */
const NOT_A_DRINK_RE =
  /\b(balas?|doces?|chocolates?|salgadinhos?|biscoitos?|bolachas?|snacks?|candy|gelatinas?|pirulitos?|sorvetes?|gomas?|chicletes?|copos?|tacas?|canecas?|abridor|livros?|chaveiros?|pelucias?|adesivos?|meias?|camisetas?)\b/;

export function enforceKind(identity: Identity, operatorName: string): Identity {
  if (identity.kind === "alcoholic_beverage") return identity;
  if (NOT_A_DRINK_RE.test(fold(identity.productType))) return identity;
  const hay = fold([identity.productType, identity.line, identity.nativeName, operatorName].filter(Boolean).join(" "));
  if (!ALCOHOL_RE.test(hay)) return identity;
  return {
    ...identity,
    kind: "alcoholic_beverage",
    notes: `${identity.notes} (tipo definido como bebida alcoólica por regra fixa)`.trim(),
  };
}

/** Alcohol content of a verified fact, when above 0.5% (the Brazilian threshold for alcoholic drinks). */
export function verifiedAbv(facts: VerifiedFact[]): number | null {
  const fact = facts.find((f) => f.field === "alcohol_abv" && f.verified);
  const value = fact ? Number(numbersIn(fact.value)[0]) : Number.NaN;
  return Number.isFinite(value) && value > 0.5 ? value : null;
}
