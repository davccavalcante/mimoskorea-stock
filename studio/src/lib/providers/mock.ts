import "server-only";
import sharp from "sharp";
import { fold } from "@/lib/text/normalize";
import type { CatalogProduct, Identity, ProductKind } from "@/lib/types";
import type { CatalogCategory, CatalogProvider, ProductPayload, SavedProduct } from "./catalog";
import type { LlmProvider, LlmRequest, LlmResult } from "./llm";
import { MOCK_PAGES } from "./mock-data";
import type { ResearchProvider, SearchHit } from "./search";

// =============================================================================
// Mock providers (STUDIO_PROVIDERS=mock)
// =============================================================================
// Deterministic stand-ins for Gemini, Tavily/Exa and image hosting. The mock
// LLM parses the REAL prompts built by the pipeline (sources, identity,
// categories), so tests exercise the same code paths as production.

// -----------------------------------------------------------------------------
// Search
// -----------------------------------------------------------------------------

function score(page: (typeof MOCK_PAGES)[number], text: string): number {
  const folded = fold(text);
  return page.keywords.filter((k) => folded.includes(k)).length;
}

export class MockSearchProvider implements ResearchProvider {
  readonly name = "mock" as const;

  async search(query: string, options: { maxResults: number }): Promise<SearchHit[]> {
    return MOCK_PAGES.map((p) => ({ p, s: score(p, query) }))
      .filter((x) => x.s >= 2)
      .sort((a, b) => b.s - a.s)
      .slice(0, options.maxResults)
      .map(({ p }) => ({
        url: p.url,
        title: p.title,
        text: p.text,
        images: p.images,
        origin: "exa" as const,
      }));
  }

  async extract(urls: string[]): Promise<SearchHit[]> {
    return urls.map((url) => {
      const exact = MOCK_PAGES.find((p) => p.url === url);
      const best =
        exact ??
        MOCK_PAGES.map((p) => ({
          p,
          s: score(p, url.replace(/[-_/]/g, " ")),
        })).sort((a, b) => b.s - a.s)[0];
      const page = exact ?? (best && "s" in best && best.s >= 2 ? best.p : null);
      if (!page) {
        const slug = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "produto").replace(
          /[-_]+/g,
          " ",
        );
        return {
          url,
          title: slug,
          text: `${slug}. Produto importado.`,
          images: [],
          origin: "reference" as const,
        };
      }
      return {
        url,
        title: page.title,
        text: page.text,
        images: page.images,
        origin: "reference" as const,
      };
    });
  }
}

// -----------------------------------------------------------------------------
// Images: generate a synthetic product photo for mock.studio.local URLs
// -----------------------------------------------------------------------------

function hashColor(text: string): string {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360}, 45%, 45%)`;
}

export async function mockImage(url: string): Promise<Buffer> {
  const u = new URL(url);
  const name = decodeURIComponent(u.pathname.split("/").pop() ?? "produto").replace(/\.\w+$/, "");
  const variant = u.searchParams.get("variant") ?? name;
  const color = hashColor(variant);
  const label = name.replace(/-/g, " ").slice(0, 28);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1100" viewBox="0 0 1000 1100">
  <rect width="1000" height="1100" fill="#f4f4f4"/>
  <rect x="330" y="120" width="340" height="860" rx="60" fill="${color}"/>
  <rect x="400" y="60" width="200" height="90" rx="20" fill="#222"/>
  <rect x="360" y="420" width="280" height="260" rx="16" fill="#ffffff" opacity="0.92"/>
  <text x="500" y="540" font-family="sans-serif" font-size="34" text-anchor="middle" fill="#111">${label.replace(/[<>&"]/g, "")}</text>
  <text x="500" y="600" font-family="sans-serif" font-size="26" text-anchor="middle" fill="#444">${variant.replace(/[<>&"]/g, "").slice(0, 20)}</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// -----------------------------------------------------------------------------
// LLM
// -----------------------------------------------------------------------------

const BRANDS = [
  "Lotte",
  "Orion",
  "Nongshim",
  "Samyang",
  "Paldo",
  "Ottogi",
  "Haitai",
  "Crown",
  "Binggrae",
  "Youngpoong",
  "Sakuragi",
  "Chuyin",
  "Yantai",
];
const LINES = [
  "Buldak",
  "Chum-Churum",
  "O'Star",
  "Choco Pie",
  "Pepero",
  "Milkis",
  "Sac Sac",
  "Tok",
  "Koony",
  "Marine Boy",
  "Yopokki",
  "Capivara Gotinha",
];

function detectKind(text: string): ProductKind {
  const t = fold(text);
  if (/\b(soju|cerveja|vinho|sake|saque|makgeolli)\b/.test(t)) return "alcoholic_beverage";
  if (/pelucia/.test(t)) return "plush_toy";
  if (/mochila|bolsa|necessaire/.test(t)) return "backpack_bag";
  if (/pantufa|meia|camiseta|chinelo/.test(t)) return "apparel_footwear";
  if (/\b(suco|refrigerante|bebida|cafe|cha|milkis|refresco)\b/.test(t)) return "beverage";
  if (/brinquedo|boneco/.test(t)) return "toy";
  if (/salgadinho|snack|biscoito|bolinho|bala|chocolate|lamen|ramyeon|topokki|doce|chiclete|wafer/.test(t))
    return "food";
  return "other";
}

function titleCase(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function between(text: string, start: string, end: string): string {
  const i = text.indexOf(start);
  if (i < 0) return "";
  const j = text.indexOf(end, i + start.length);
  return text.slice(i + start.length, j < 0 ? undefined : j);
}

function mockIdentify(prompt: string): Identity {
  const name = /Operator typed product name: "([^"]*)"/.exec(prompt)?.[1] ?? "Produto";
  const reference = between(prompt, "<reference", "</reference>");
  const all = `${name}\n${reference}`;
  const brand =
    BRANDS.find((b) => fold(all).includes(fold(b))) ?? /Marca:\s*([^\n]+)/i.exec(reference)?.[1]?.trim() ?? null;
  const line =
    LINES.find((l) =>
      fold(all)
        .replace(/[^a-z0-9]/g, "")
        .includes(fold(l).replace(/[^a-z0-9]/g, "")),
    ) ??
    /Linha:\s*([^\n]+)/i.exec(reference)?.[1]?.trim() ??
    null;
  const kind = detectKind(all);
  const variantMatch =
    /Sabor[:\s]+([A-Za-zÀ-ÿ ]+?)(?=\s*(?:\d|\||,|\.|\n|$|de\s+\d))/i.exec(name) ?? /Sabor:\s*([^\n]+)/i.exec(reference);
  // Without "Sabor ...", the variant is what remains of the typed name after type, brand, line and size.
  const leftover = name
    .replace(/(\d+(?:[.,]\d+)?)\s?(ml|g|kg|l|cm)\b/gi, " ")
    .split(/\s+/)
    .slice(1)
    .filter(
      (w) =>
        w &&
        ![brand, ...(line ? line.split(/[\s-]+/) : [])].some(
          (x) => x && fold(x).replace(/[^a-z0-9]/g, "") === fold(w).replace(/[^a-z0-9]/g, ""),
        ),
    )
    .filter((w) => !/^(coreano|coreana|importado|de|com|o'?star)$/i.test(fold(w)))
    .join(" ")
    .trim();
  const rawVariant = variantMatch?.[1] ?? (line && leftover && leftover.split(" ").length <= 3 ? leftover : null);
  const variant = rawVariant ? rawVariant.trim().split(" ").map(titleCase).join(" ") : null;
  const size =
    /(\d+(?:[.,]\d+)?)\s?(ml|g|kg|l|cm)\b/i.exec(name) ?? /(\d+(?:[.,]\d+)?)\s?(ml|g|kg|l|cm)\b/i.exec(reference);
  const netContent = size ? `${size[1]}${size[2].toLowerCase()}` : null;
  const gtin = /C[óo]digo de Barras:\s*(\d{8,14})/i.exec(reference)?.[1] ?? null;
  const productType = titleCase(name.trim().split(/\s+/)[0] ?? "Produto");
  const base = [productType, brand, line, variant, netContent].filter(Boolean).join(" ");
  return {
    kind,
    brand,
    manufacturer: null,
    line,
    productType,
    variant,
    netContent,
    packCount: null,
    gtin,
    originCountry: /Coreia do Sul/i.test(all) ? "Coreia do Sul" : null,
    searchQueries: [base, `${brand ?? ""} ${line ?? ""} ${variant ?? ""} ${netContent ?? ""} ingredients`.trim(), name]
      .filter((q, i, a) => q && a.indexOf(q) === i)
      .slice(0, 6)
      .concat(base === name ? [`${name} especificações`] : [])
      .slice(0, 6),
    nativeName: null,
    confidence: brand && line ? "high" : "medium",
    notes: "mock",
  };
}

type ParsedSource = { id: string; url: string; mentions: string; body: string };

function parseSources(prompt: string): ParsedSource[] {
  const re = /<source id="(S\d+)" origin="\w+" url="([^"]+)" mentions_variant="([^"]+)">\n([\s\S]*?)\n<\/source>/g;
  return [...prompt.matchAll(re)].map((m) => ({
    id: m[1],
    url: m[2],
    mentions: m[3],
    body: m[4],
  }));
}

const FACT_PATTERNS: Array<{
  field: string;
  label: string;
  re: RegExp;
  value: (m: RegExpExecArray) => string;
  variantSensitive?: boolean;
}> = [
  {
    field: "alcohol_abv",
    label: "Teor alcoólico",
    re: /(?:Graduação Alcoólica|Teor alcoólico)[:\s]+(\d+(?:[.,]\d+)?)\s?%\s?vol\.?/i,
    value: (m) => `${m[1].replace(".", ",")}% vol.`,
    variantSensitive: true,
  },
  {
    field: "gtin",
    label: "Código de barras (EAN)",
    re: /Código de Barras:\s*(\d{8,14})/i,
    value: (m) => m[1],
    variantSensitive: true,
  },
  {
    field: "net_content",
    label: "Conteúdo líquido",
    re: /(?:Conteúdo|Volume):\s*(\d+\s?(?:ml|g|kg|l))/i,
    value: (m) => m[1].replace(/\s/g, ""),
  },
  {
    field: "country_of_origin",
    label: "País de origem",
    re: /(?:País de origem|Origem):\s*([^\n.]+)/i,
    value: (m) => m[1].trim(),
  },
  {
    field: "manufacturer",
    label: "Fabricante",
    re: /Fabricante:\s*([^\n]+?)\.?$/im,
    value: (m) => m[1].trim(),
  },
  {
    field: "ingredients",
    label: "Ingredientes",
    re: /(?:Composição|Ingredientes):\s*([^\n]+?)\.?$/im,
    value: (m) => `${m[1].trim()}.`,
    variantSensitive: true,
  },
  {
    field: "allergens",
    label: "Alergênicos",
    re: /AL[ÉE]RGICOS:\s*(CONT[ÉE]M [^.\n]+)/i,
    value: (m) => `${titleCase(m[1].trim())}.`,
    variantSensitive: true,
  },
  {
    field: "gluten",
    label: "Glúten",
    re: /(N[ÃA]O CONT[ÉE]M GL[ÚU]TEN|CONT[ÉE]M GL[ÚU]TEN)/i,
    value: (m) => `${titleCase(m[1])}.`,
    variantSensitive: true,
  },
  {
    field: "lactose",
    label: "Lactose",
    re: /(N[ÃA]O CONT[ÉE]M LACTOSE|CONT[ÉE]M LACTOSE)/i,
    value: (m) => `${titleCase(m[1])}.`,
    variantSensitive: true,
  },
  {
    field: "preparation",
    label: "Modo de preparo",
    re: /Modo de preparo:\s*([^\n]+?)\.?$/im,
    value: (m) => `${m[1].trim()}.`,
  },
  {
    field: "storage",
    label: "Conservação",
    re: /Conservação:\s*([^\n]+)/i,
    value: (m) => m[1].trim(),
  },
  {
    field: "material",
    label: "Material",
    re: /Material:\s*([^\n]+?)\.?$/im,
    value: (m) => m[1].trim(),
  },
  {
    field: "dimensions",
    label: "Dimensões",
    re: /Tamanho:\s*([^\n]+?)\.?$/im,
    value: (m) => m[1].trim(),
  },
  {
    field: "age_grading",
    label: "Faixa etária",
    re: /Idade recomendada:\s*([^\n]+?)\.?$/im,
    value: (m) => m[1].trim(),
  },
  {
    field: "care",
    label: "Cuidados",
    re: /Lavagem:\s*([^\n]+?)\.?$/im,
    value: (m) => m[1].trim(),
  },
  {
    field: "inmetro",
    label: "Certificação INMETRO",
    re: /(Certificado INMETRO)/i,
    value: () => "Possui certificação INMETRO (confirme o selo na embalagem)",
  },
];

function mockWrite(prompt: string) {
  const identity = JSON.parse(/Identity: (\{.*\})/.exec(prompt)?.[1] ?? "{}") as Identity;
  const sources = parseSources(prompt);
  const facts: Array<{
    field: string;
    label: string;
    value: string;
    sourceIds: string[];
    evidence: string;
  }> = [];
  for (const pattern of FACT_PATTERNS) {
    for (const s of sources) {
      if (pattern.variantSensitive && s.mentions === "no") continue;
      const m = pattern.re.exec(s.body);
      if (m) {
        facts.push({
          field: pattern.field,
          label: pattern.label,
          value: pattern.value(m),
          sourceIds: [s.id],
          evidence: m[0].slice(0, 220),
        });
        break;
      }
    }
  }
  if (identity.brand)
    facts.push({
      field: "brand",
      label: "Marca",
      value: identity.brand,
      sourceIds: [sources[0]?.id ?? "S1"],
      evidence: identity.brand,
    });

  // Nutrition table in the Brazilian format "Porção de 30g: Valor energético 160 kcal 8%; ..."
  let nutrition = null;
  for (const s of sources) {
    if (s.mentions === "no") continue;
    const block = /Porção de ([^:]+):\s*([^\n]+)/i.exec(s.body);
    if (!block) continue;
    const rows = block[2]
      .split(";")
      .map((part) => /([A-Za-zÀ-ÿ ]+?)\s+(\d+(?:[.,]\d+)?\s?(?:kcal|g|mg))(?:\s+(\d+%))?/.exec(part.trim()))
      .filter((m): m is RegExpExecArray => Boolean(m))
      .map((m) => ({
        nutrient: m[1].trim(),
        perServing: m[2].replace(/\s/g, " "),
        dailyValue: m[3] ?? null,
      }));
    if (rows.length >= 3) {
      nutrition = {
        servingSize: block[1].trim(),
        servingsPerPackage: null,
        rows,
        sourceIds: [s.id],
      };
      break;
    }
  }

  const catBlock = between(prompt, "AVAILABLE CATEGORIES (id: name)\n", "\n\nSOURCES");
  const categories = catBlock
    .split("\n")
    .map((l) => /^(\d+): ([^(]+)/.exec(l))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => ({ id: Number(m[1]), name: fold(m[2].trim()) }));
  const wanted = fold(`${identity.productType} ${identity.kind}`).replace(/\b(lamen|miojo|noodles?)\b/g, "ramyeon");
  const category =
    categories.find((c) => wanted.includes(c.name.replace(/s$/, ""))) ??
    categories.find(
      (c) =>
        (identity.kind === "beverage" && c.name === "bebidas") ||
        (identity.kind === "plush_toy" && c.name === "pelucias"),
    ) ??
    null;

  const name = [
    identity.productType,
    identity.brand,
    identity.line,
    identity.variant ? `Sabor ${identity.variant}` : null,
    identity.netContent,
  ]
    .filter(Boolean)
    .join(" ");
  const shipping =
    identity.kind === "alcoholic_beverage"
      ? { weightKg: 0.6, lengthCm: 8, widthCm: 8, heightCm: 24 }
      : identity.kind === "plush_toy"
        ? { weightKg: 0.5, lengthCm: 45, widthCm: 30, heightCm: 20 }
        : { weightKg: 0.08, lengthCm: 20, widthCm: 15, heightCm: 5 };

  return {
    // The mock adds the store name and an emoji on purpose: the system must strip them.
    title: `${name} | Mimos Korea 🍓`,
    shortDescription: `${name}, produto importado ${identity.originCountry ? `da ${identity.originCountry}` : ""} com informações verificadas nas fontes. ✅`,
    introParagraphs: [
      `${name} é um produto ${identity.originCountry ? `importado da ${identity.originCountry}` : "importado"} da marca ${identity.brand ?? "indicada na embalagem"}. As especificações abaixo foram conferidas em fontes públicas e no rótulo informado pelos vendedores.`,
    ],
    highlights: facts
      .filter((f) => ["net_content", "alcohol_abv", "material", "dimensions", "country_of_origin"].includes(f.field))
      .map((f) => `${f.label}: ${f.value}`),
    usage: identity.kind === "alcoholic_beverage" ? "Sirva gelado, puro ou com gelo." : null,
    facts,
    nutrition,
    sourcedWarnings: [],
    categoryId: category?.id ?? null,
    seo: {
      metaTitle: name.slice(0, 60),
      metaDescription: `${name}. Confira ingredientes, especificações e informações importantes antes de comprar na loja online.`,
      focusKeyword: [identity.productType, identity.line ?? identity.brand].filter(Boolean).join(" "),
    },
    shipping,
    marketPrices: [],
  };
}

function mockImages(prompt: string) {
  const count = Number(/There are (\d+) candidate images/.exec(prompt)?.[1] ?? "0");
  const identity = JSON.parse(/Product identity: (\{.*\})/.exec(prompt)?.[1] ?? "{}") as {
    type?: string;
    variant?: string;
  };
  return {
    images: Array.from({ length: count }, (_, index) => ({
      index,
      verdict: index === 0 ? ("main" as const) : ("gallery" as const),
      matchesExactVariant: true,
      hasOverlayTextOrWatermark: false,
      reason: "Foto do produto (simulação)",
      altText: `${identity.type ?? "Produto"} ${identity.variant ?? ""} - foto ${index + 1}`
        .replace(/\s+/g, " ")
        .trim(),
    })),
  };
}

export class MockLlm implements LlmProvider {
  readonly name = "mock-llm";

  async generateJson<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
    const raw =
      request.operation === "identify"
        ? mockIdentify(request.prompt)
        : request.operation === "write"
          ? mockWrite(request.prompt)
          : request.operation === "images"
            ? mockImages(request.prompt)
            : {};
    const parsed = request.schema.parse(raw);
    return { data: parsed, model: "mock", usage: "0 tokens (simulação)" };
  }
}

// -----------------------------------------------------------------------------
// In-memory catalog (unit tests)
// -----------------------------------------------------------------------------

export class MemoryCatalog implements CatalogProvider {
  readonly name = "memory";
  readonly baseUrl = "http://memory.local";
  products: Array<SavedProduct & { payload: Partial<ProductPayload> }> = [];
  media: Array<{ id: number; fileName: string; parent: number | null }> = [];
  brands: Array<{ id: number; name: string }> = [];
  private seq = 1000;

  constructor(
    seed: CatalogProduct[] = [],
    private readonly categories: CatalogCategory[] = [],
  ) {
    for (const p of seed) this.products.push({ ...p, hasPrice: true, payload: {} });
  }

  async listCategories() {
    return this.categories;
  }
  async searchProducts(query: string) {
    const words = fold(query)
      .split(/\s+/)
      .filter((w) => w.length > 2);
    return this.products.filter((p) => words.every((w) => fold(p.name).includes(w)));
  }
  async findBySku(sku: string) {
    return this.products.find((p) => p.sku.toUpperCase() === sku.toUpperCase()) ?? null;
  }
  async getProduct(id: number) {
    return this.products.find((p) => p.id === id) ?? null;
  }
  async ensureBrand(name: string) {
    const found = this.brands.find((b) => fold(b.name) === fold(name));
    if (found) return found.id;
    const id = ++this.seq;
    this.brands.push({ id, name });
    return id;
  }
  async uploadImage(file: { fileName: string }) {
    const id = ++this.seq;
    this.media.push({ id, fileName: file.fileName, parent: null });
    return { id, url: `${this.baseUrl}/${file.fileName}` };
  }
  async attachMedia(mediaId: number, productId: number) {
    const m = this.media.find((x) => x.id === mediaId);
    if (m) m.parent = productId;
  }
  async createProduct(payload: ProductPayload) {
    if (payload.sku && this.products.some((p) => p.sku === payload.sku))
      throw new Error("product_invalid_sku: SKU duplicado");
    const id = ++this.seq;
    const product = {
      id,
      name: payload.name,
      slug: payload.slug ?? String(id),
      sku: payload.sku ?? "",
      gtin: payload.global_unique_id ?? "",
      status: payload.status ?? "draft",
      stockQuantity: payload.stock_quantity,
      permalink: `${this.baseUrl}/${payload.slug}`,
      brands: [],
      hasPrice: false,
      payload,
    };
    this.products.push(product);
    return product;
  }
  async updateProduct(id: number, payload: Partial<ProductPayload>) {
    const p = this.products.find((x) => x.id === id);
    if (!p) throw new Error("not found");
    Object.assign(p, {
      name: payload.name ?? p.name,
      sku: payload.sku ?? p.sku,
      status: payload.status ?? p.status,
      stockQuantity: payload.stock_quantity ?? p.stockQuantity,
      payload: { ...p.payload, ...payload },
    });
    return p;
  }
}
