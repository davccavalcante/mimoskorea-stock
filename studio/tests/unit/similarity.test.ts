import { describe, expect, it } from "vitest";
import { compareProducts, MATCH_THRESHOLD, measures, POSSIBLE_THRESHOLD } from "@/lib/text/similarity";

// =============================================================================
// Duplicate guard, calibrated on real cases found in the audit
// =============================================================================

const existing = (name: string, extra: Partial<{ sku: string; gtin: string; brands: string[] }> = {}) => ({
  name,
  sku: extra.sku ?? "",
  gtin: extra.gtin ?? "",
  brands: extra.brands ?? [],
});

describe("measures", () => {
  it("normalises units", () => {
    expect(measures("Soju 360 ml e 1,5L e 30g e 1kg")).toEqual([
      { value: 360, unit: "ml" },
      { value: 1500, unit: "ml" },
      { value: 30, unit: "g" },
      { value: 1000, unit: "g" },
    ]);
  });
});

describe("compareProducts", () => {
  it("matches the O'Star Queijo Duplo triplicate (ids 235, 954, 1021 in production)", () => {
    const item = {
      title: "Salgadinho Orion O'Star Sabor Queijo Duplo 30g",
      brand: "Orion",
      variant: "Queijo Duplo",
      netContent: "30g",
    };
    for (const name of [
      "Snack Batata Frita Coreano O’star Orion 30g Sabor Queijo Duplo",
      "Salgadinho Coreano O’Star Orion 30g Sabor Queijo Duplo | Batata Frita Crocante | Importado",
      "Salgadinho Coreano O’Star Orion 30g | Batata Frita Crocante | Snack Sabor Queijo Duplo",
    ]) {
      expect(compareProducts(item, existing(name, { brands: ["O'star", "Orion"] })).score).toBeGreaterThanOrEqual(
        MATCH_THRESHOLD,
      );
    }
  });

  it("does not treat another flavour of the same line as a duplicate", () => {
    const item = {
      title: "Salgadinho Orion O'Star Sabor Queijo Duplo 30g",
      brand: "Orion",
      variant: "Queijo Duplo",
      netContent: "30g",
    };
    const r = compareProducts(item, existing("Snack Batata Frita Coreano O’star Orion 30g Sabor Kimchi"));
    expect(r.score).toBeLessThan(POSSIBLE_THRESHOLD);
    expect(r.reasons).toContain("Sabor/cor/variação diferente");
  });

  it("treats 238ml vs 240ml of the same juice as the same item (production ids 242 and 253)", () => {
    const item = {
      title: "Refresco Lotte Sac Sac Sabor Uva Verde 240ml",
      brand: "Lotte",
      variant: "Uva Verde",
      netContent: "240ml",
    };
    expect(
      compareProducts(item, existing("Refresco Coreano Sac Sac Lotte 238ml Sabor Uva Verde")).score,
    ).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it("does not match a different size", () => {
    const item = {
      title: "Soju Lotte Chum-Churum Sabor Morango 360ml",
      brand: "Lotte",
      variant: "Morango",
      netContent: "360ml",
    };
    const r = compareProducts(item, existing("Soju Lotte Chum-Churum Sabor Morango 640ml"));
    expect(r.score).toBeLessThan(POSSIBLE_THRESHOLD);
  });

  it("GTIN and SKU equality are decisive", () => {
    const item = { title: "Qualquer nome", gtin: "8801030000396", sku: "SOJ-LOT-CHU-MOR-360ML" };
    expect(compareProducts(item, existing("Outro nome", { gtin: "8801030000396" })).score).toBe(1);
    expect(compareProducts(item, existing("Outro nome", { sku: "soj-lot-chu-mor-360ml" })).score).toBe(0.98);
  });
});
