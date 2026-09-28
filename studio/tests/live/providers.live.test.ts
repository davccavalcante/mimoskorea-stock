import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDENTIFY_SYSTEM, identifyPrompt } from "@/lib/pipeline/prompts";
import { selectImages } from "@/lib/pipeline/select-images";
import { writeListing } from "@/lib/pipeline/write";
import { GeminiProvider } from "@/lib/providers/gemini";
import { MOCK_PAGES } from "@/lib/providers/mock-data";
import { ExaProvider, TavilyProvider } from "@/lib/providers/search";
import { IdentitySchema, type Source } from "@/lib/types";

// =============================================================================
// Live provider checks (real Gemini, Tavily and Exa; costs a few cents)
// =============================================================================
// Run on the machine that will use the studio:
//   npm run test:live
// Keys are read from .env.local. Each provider is skipped when its key is
// missing. Nothing is written to any store.

const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const live = process.env.STUDIO_LIVE_TEST === "1";
const gemini = process.env.GEMINI_API_KEY;
const tavily = process.env.TAVILY_API_KEY;
const exa = process.env.EXA_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

const page = MOCK_PAGES[0]; // realistic Mercado Livre text (soju Chum-Churum Morango)
const source = (id: string, p: (typeof MOCK_PAGES)[number], origin: Source["origin"]): Source => ({
  id,
  url: p.url,
  title: p.title,
  domain: new URL(p.url).hostname,
  origin,
  text: p.text,
  images: [],
});

describe.skipIf(!live || !gemini)("Gemini (live)", { timeout: 600_000 }, () => {
  const fallbacks = (
    process.env.GEMINI_FALLBACK_MODELS || "gemini-3.6-flash,gemini-3.7-flash,gemini-3.5-flash,gemini-3.1-flash-lite"
  ).split(",");
  const llm = new GeminiProvider(gemini ?? "", model, 300_000, fallbacks, (m) => console.log("fallback:", m));
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "studio-live-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("identifies the exact product from the reference page", async () => {
    const { data, usage } = await llm.generateJson({
      operation: "identify",
      system: IDENTIFY_SYSTEM,
      prompt: identifyPrompt(
        { productName: "soju chum churum morango", referenceUrl: page.url, stockQuantity: 1 },
        source("S1", page, "reference"),
      ),
      schema: IdentitySchema,
      thinking: "low",
    });
    console.log("identify:", JSON.stringify(data), usage);
    expect(data.kind).toBe("alcoholic_beverage");
    expect(data.variant?.toLowerCase()).toContain("morango");
    expect(data.searchQueries.length).toBeGreaterThanOrEqual(2);
  });

  it("writes a verified listing (no variant mix-up, legal notices)", async () => {
    const identity = {
      kind: "alcoholic_beverage" as const,
      brand: "Lotte",
      manufacturer: "Lotte Chilsung Beverage",
      line: "Chum-Churum",
      productType: "Soju",
      variant: "Morango",
      variantAliases: ["Strawberry", "딸기"],
      netContent: "360ml",
      packCount: null,
      gtin: null,
      originCountry: "Coreia do Sul",
      searchQueries: ["soju chum churum morango 360ml", "chum churum strawberry soju"],
      nativeName: "처음처럼 딸기",
      confidence: "high" as const,
      notes: "",
    };
    const sources = [
      source("S1", MOCK_PAGES[0], "reference"),
      source("S2", MOCK_PAGES[1], "exa"),
      source("S3", MOCK_PAGES[2], "tavily"),
    ];
    const { draft, usage, notes } = await writeListing({
      input: { productName: "soju chum churum morango 360ml", referenceUrl: page.url, stockQuantity: 1 },
      identity,
      sources,
      categories: [
        { id: 261, name: "Soju", slug: "soju", parent: 0, count: 1 },
        { id: 16, name: "Bebidas", slug: "bebidas", parent: 0, count: 1 },
      ],
      llm,
      options: { storeName: "Mimos Korea Design", titleMaxChars: 75 },
    });
    console.log("write:", draft.title, "|", usage, "|", notes.join("; "));
    console.log(
      "facts:",
      draft.facts.map((f) => `${f.verified ? "OK " : "XX "}${f.field}=${f.value}`),
    );
    expect(draft.title.length).toBeGreaterThan(10);
    expect(draft.facts.find((f) => f.field === "alcohol_abv" && f.verified)?.value).toMatch(/12/);
    expect(draft.descriptionHtml).not.toContain("16,5");
    expect(draft.descriptionHtml).toContain("Venda e consumo proibidos para menores de 18 anos.");
  });

  it("reviews candidate photos with vision", async () => {
    const photo = (color: string) =>
      sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#fff"/><rect x="300" y="80" width="200" height="640" rx="40" fill="${color}"/></svg>`,
        ),
      )
        .png()
        .toBuffer();
    const images = {
      "https://img.test/a.png": await photo("#1f6f43"),
      "https://img.test/b.png": await photo("#aa2244"),
    };
    const result = await selectImages({
      identity: IdentitySchema.parse({
        kind: "alcoholic_beverage",
        brand: "Lotte",
        manufacturer: null,
        line: "Chum-Churum",
        productType: "Soju",
        variant: "Morango",
        variantAliases: [],
        netContent: "360ml",
        packCount: null,
        gtin: null,
        originCountry: null,
        searchQueries: ["a", "b"],
        nativeName: null,
        confidence: "high",
        notes: "",
      }),
      sources: [{ ...source("S1", page, "reference"), images: Object.keys(images) }],
      llm,
      visionModel: model,
      fetchImage: async (url) => images[url as keyof typeof images],
      options: {
        size: 800,
        quality: 80,
        maxCount: 2,
        maxBytes: 5_000_000,
        minSide: 500,
        outputDir: dir,
        slug: "teste",
        title: "Teste",
      },
      log: (d) => console.log("images:", d),
    });
    // Plain drawings are not a photo of the exact product: the reviewer should reject them.
    expect(Array.isArray(result.images)).toBe(true);
    expect(result.usage).not.toBeNull();
  });
});

describe.skipIf(!live || !tavily)("Tavily (live)", () => {
  const provider = new TavilyProvider(tavily ?? "");
  it("searches and extracts", async () => {
    const hits = await provider.search("soju chum churum morango 360ml teor alcoólico", {
      maxResults: 3,
      locale: "pt-BR",
    });
    console.log(
      "tavily search:",
      hits.map((h) => h.url),
    );
    expect(hits.length).toBeGreaterThan(0);
    const pages = await provider.extract([hits[0].url]);
    expect(pages[0]?.text.length ?? 0).toBeGreaterThan(100);
  });
});

describe.skipIf(!live || !exa)("Exa (live)", () => {
  const provider = new ExaProvider(exa ?? "");
  it("searches and reads contents", async () => {
    const hits = await provider.search("Chum Churum strawberry soju 360ml alcohol", {
      maxResults: 3,
      locale: "global",
    });
    console.log(
      "exa search:",
      hits.map((h) => h.url),
    );
    expect(hits.length).toBeGreaterThan(0);
    const pages = await provider.extract([hits[0].url]);
    expect(pages[0]?.text.length ?? 0).toBeGreaterThan(100);
  });
});
