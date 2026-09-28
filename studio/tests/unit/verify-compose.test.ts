import { describe, expect, it } from "vitest";
import { ALCOHOL_NOTICES, findMissing, legalNotices } from "@/lib/pipeline/compliance";
import { buildAttributes, composeDescription, composeShortDescription } from "@/lib/pipeline/compose";
import { buildSku } from "@/lib/pipeline/sku";
import { quoteAppearsIn, verifyFacts, verifyNutrition } from "@/lib/pipeline/verify";
import type { Fact, Identity, Source, Synthesis } from "@/lib/types";

// =============================================================================
// Grounding verification, deterministic HTML and compliance
// =============================================================================

const src = (id: string, text: string): Source => ({
  id,
  url: `https://example.com/${id}`,
  title: `Fonte ${id}`,
  domain: "example.com",
  origin: "exa",
  text,
  images: [],
});

const S1 = src(
  "S1",
  "Soju Chum Churum Sabor Morango 360ml. Graduação Alcoólica: 12% Vol. Código de Barras: 8801030000396",
);
const S2 = src("S2", "Soju Chum Churum Original 360ml. Teor alcoólico: 16,5% vol.");
const S3 = src("S3", "Chum-Churum Strawberry Soju. Alcohol 12%. 처음처럼 딸기 소주 360ml");

const fact = (partial: Partial<Fact>): Fact => ({
  field: "alcohol_abv",
  label: "Teor alcoólico",
  value: "12% vol.",
  sourceIds: ["S1"],
  evidence: "Graduação Alcoólica: 12% Vol.",
  ...partial,
});

describe("quoteAppearsIn", () => {
  it("is tolerant to case, accents and punctuation but not to invented text", () => {
    expect(quoteAppearsIn("graduacao alcoolica 12% vol", S1.text)).toBe(true);
    expect(quoteAppearsIn("Graduação Alcoólica: 14% Vol.", S1.text)).toBe(false);
    expect(quoteAppearsIn("Contém glúten e lactose", S1.text)).toBe(false);
  });

  it("works with Korean text", () => {
    expect(quoteAppearsIn("처음처럼 딸기 소주", S3.text)).toBe(true);
  });
});

describe("verifyFacts", () => {
  it("accepts a fact whose evidence is in the cited source and numbers match", () => {
    const [f] = verifyFacts([fact({})], [S1, S2]);
    expect(f.verified).toBe(true);
  });

  it("rejects invented evidence, wrong citations and number mismatches", () => {
    const results = verifyFacts(
      [
        fact({ evidence: "Graduação Alcoólica: 12% Vol.", sourceIds: ["S2"] }), // cited the wrong page
        fact({ value: "13% vol." }), // value number not in evidence
        fact({ sourceIds: ["S9"] }), // non-existent source
        fact({ evidence: "" }),
      ],
      [S1, S2],
    );
    expect(results.map((r) => r.verified)).toEqual([false, false, false, false]);
  });

  it("rejects variant-sensitive facts from pages about another flavour", () => {
    const mentionsVariant = new Map<string, boolean | null>([
      ["S1", true],
      ["S2", false],
    ]);
    const [fromOriginal] = verifyFacts(
      [fact({ value: "16,5% vol.", sourceIds: ["S2"], evidence: "Teor alcoólico: 16,5% vol." })],
      [S1, S2],
      { mentionsVariant },
    );
    expect(fromOriginal.verified).toBe(false);
    const [brand] = verifyFacts(
      [
        fact({
          field: "brand",
          label: "Marca",
          value: "Chum Churum",
          sourceIds: ["S2"],
          evidence: "Soju Chum Churum Original",
        }),
      ],
      [S1, S2],
      { mentionsVariant },
    );
    expect(brand.verified).toBe(true); // line-wide data may come from any flavour page
  });

  it("rejects GTINs with a wrong check digit even when quoted", () => {
    const S = src("S1", "Código de Barras: 8801030000397");
    const [f] = verifyFacts(
      [fact({ field: "gtin", label: "EAN", value: "8801030000397", evidence: "Código de Barras: 8801030000397" })],
      [S],
    );
    expect(f.verified).toBe(false);
  });
});

describe("verifyNutrition", () => {
  const source = src(
    "S1",
    "Porção de 30g: Valor energético 160 kcal 8%; Carboidratos 16g 5%; Proteínas 2g 4%; Sódio 150mg 8%",
  );
  const table = {
    servingSize: "30g",
    servingsPerPackage: null,
    sourceIds: ["S1"],
    rows: [
      { nutrient: "Valor energético", perServing: "160 kcal", dailyValue: "8%" },
      { nutrient: "Carboidratos", perServing: "16 g", dailyValue: "5%" },
      { nutrient: "Proteínas", perServing: "2 g", dailyValue: "4%" },
      { nutrient: "Sódio", perServing: "150 mg", dailyValue: "8%" },
    ],
  };
  it("keeps a table whose numbers are in the source", () => {
    expect(verifyNutrition(table, [source])).not.toBeNull();
  });
  it("drops an invented table", () => {
    const invented = { ...table, rows: table.rows.map((r) => ({ ...r, perServing: "999 g" })) };
    expect(verifyNutrition(invented, [source])).toBeNull();
  });
});

describe("composeDescription", () => {
  const synthesis: Synthesis = {
    title: "Soju",
    shortDescription: "Soju de morango 🍓 <b>forte</b>",
    introParagraphs: ["Bebida destilada coreana <script>alert(1)</script> 🥂"],
    highlights: ["Garrafa de 360ml ✅"],
    usage: "Sirva gelado.",
    facts: [],
    nutrition: null,
    sourcedWarnings: [],
    categoryId: null,
    seo: { metaTitle: "", metaDescription: "", focusKeyword: "" },
    shipping: { weightKg: 0.6, lengthCm: 8, widthCm: 8, heightCm: 24 },
    marketPrices: [],
  };
  const facts = verifyFacts([fact({})], [S1]);
  const identity = { kind: "alcoholic_beverage", variant: "Morango" } as Identity;

  it("builds sections, escapes model text, strips emoji and appends legal notices", () => {
    const attributes = buildAttributes(facts, identity);
    const html = composeDescription({
      synthesis,
      facts,
      nutrition: null,
      attributes,
      notices: legalNotices("alcoholic_beverage"),
    });
    expect(html).toContain("<h2>Especificações</h2>");
    expect(html).toContain("Teor alcoólico");
    expect(html).toContain(ALCOHOL_NOTICES[0]);
    expect(html).not.toMatch(/<script|🍓|🥂|✅/);
    expect(html).toContain("&lt;script&gt;");
    const short = composeShortDescription(synthesis, legalNotices("alcoholic_beverage"));
    expect(short).toContain("&lt;b&gt;forte&lt;/b&gt;");
    expect(short).toContain("menores de 18 anos");
  });
});

describe("compliance", () => {
  it("flags alcohol without ABV as a blocker", () => {
    const missing = findMissing("alcoholic_beverage", [], { hasNutrition: false, brand: "Lotte" });
    expect(missing.find((m) => m.field === "alcohol_abv")?.severity).toBe("blocker");
    expect(missing.find((m) => m.field === "brand")).toBeUndefined();
  });

  it("food requires nutrition, ingredients, allergens and gluten statement", () => {
    const blockers = findMissing("food", [], { hasNutrition: false, brand: null })
      .filter((m) => m.severity === "blocker")
      .map((m) => m.field);
    expect(blockers).toEqual(
      expect.arrayContaining(["nutrition", "ingredients", "allergens", "gluten", "net_content"]),
    );
  });
});

describe("buildSku", () => {
  it("is deterministic and readable", () => {
    const identity = {
      productType: "Soju",
      brand: "Lotte",
      line: "Chum-Churum",
      variant: "Morango",
      netContent: "360ml",
      packCount: null,
    } as unknown as Identity;
    expect(buildSku(identity)).toBe("SOJ-LOT-CHCH-MOR-360ML");
    expect(buildSku(identity)).toBe(buildSku({ ...identity }));
  });
});
