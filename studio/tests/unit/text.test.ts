import { describe, expect, it } from "vitest";
import { escapeHtml, htmlToText, sanitizeProductHtml } from "@/lib/text/html";
import {
  countEmoji,
  enforceTitleRules,
  fold,
  isValidGtin,
  slugify,
  stripEmoji,
  titleCasePt,
} from "@/lib/text/normalize";

// =============================================================================
// Text rules (emoji, titles, slugs, barcodes, HTML)
// =============================================================================

describe("stripEmoji / countEmoji", () => {
  it("removes emoji, checkmarks, flags and joiners but keeps Portuguese accents", () => {
    const text = "🥔 Salgadinho Coreano ✅ Crocância 🇰🇷 família 👨‍👩‍👧 açúcar ❤️";
    expect(stripEmoji(text)).toBe("Salgadinho Coreano Crocância família açúcar");
    expect(countEmoji(text)).toBeGreaterThanOrEqual(6);
  });

  it("keeps numbers, units, currency and punctuation", () => {
    expect(stripEmoji("R$ 12,99 - 360ml (12% vol.)")).toBe("R$ 12,99 - 360ml (12% vol.)");
  });
});

describe("fold / slugify / titleCasePt", () => {
  it("folds accents and typographic quotes", () => {
    expect(fold("Pelúcia O’Star AÇÚCAR")).toBe("pelucia o'star acucar");
  });

  it("creates short ASCII slugs without breaking words", () => {
    expect(slugify("Soju Lotte Chum-Churum Sabor Morango 360ml")).toBe("soju-lotte-chum-churum-sabor-morango-360ml");
    const long = slugify(
      "Mochila Executiva Impermeável para Notebook 15,6 Polegadas 29L Preta com Porta USB e Cadeado",
      50,
    );
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long.endsWith("-")).toBe(false);
  });

  it("title-cases Portuguese while preserving units and brand casing", () => {
    expect(titleCasePt("soju lotte chum-churum sabor de morango 360ML")).toBe(
      "Soju Lotte Chum-Churum Sabor de Morango 360ml",
    );
    expect(titleCasePt("PELÚCIA capivara USB o’star")).toBe("Pelúcia Capivara USB O’Star");
    expect(titleCasePt("salgadinho O'Star ChocoPie 30G")).toBe("Salgadinho O'Star ChocoPie 30g");
  });
});

describe("enforceTitleRules (catalogue title policy)", () => {
  const rules = { storeName: "Mimos Korea Design", maxChars: 75 };

  it("removes pipes, store name, emoji and keyword lists seen in the audit", () => {
    const { title, adjustments } = enforceTitleRules(
      "Salgadinho Coreano O’Star Orion 30g | Batata Frita Crocante | Snack Sabor Queijo Duplo 🧀",
      rules,
    );
    expect(title).toBe("Salgadinho Coreano O’Star Orion 30g");
    expect(adjustments.length).toBeGreaterThan(0);

    expect(enforceTitleRules("Soju Coreano Lotte Chum Churum 360ml Sabor Blueberry , Koreia, Kpop", rules).title).toBe(
      "Soju Coreano Lotte Chum Churum 360ml Sabor Blueberry",
    );
    expect(enforceTitleRules("Kit 6 Soju Mimos Korea Design", rules).title).toBe("Kit 6 Soju");
  });

  it("shortens titles above the limit at a word boundary", () => {
    const { title } = enforceTitleRules(`Mochila ${"Muito ".repeat(30)}Grande`, rules);
    expect(title.length).toBeLessThanOrEqual(75);
    expect(title.endsWith(" ")).toBe(false);
  });
});

describe("isValidGtin", () => {
  it("accepts real check digits and rejects wrong ones", () => {
    expect(isValidGtin("8801030000396")).toBe(true); // Chum-Churum strawberry (retailer page)
    expect(isValidGtin("8801030000397")).toBe(false);
    expect(isValidGtin("96385074")).toBe(true); // EAN-8
    expect(isValidGtin("12345")).toBe(false);
    expect(isValidGtin("880103000039X")).toBe(false);
    expect(isValidGtin(null)).toBe(false);
  });
});

describe("HTML safety", () => {
  it("escapes model text", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">`)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("keeps only the product HTML allowlist", () => {
    const dirty = `<h2>Ok</h2><script>alert(1)</script><p onclick="x()">Texto <a href="https://evil">link</a></p><iframe src="x"></iframe><table><tr><th scope="row">A</th><td>B</td></tr></table>`;
    const clean = sanitizeProductHtml(dirty);
    expect(clean).not.toMatch(/script|onclick|<a|iframe|evil/);
    expect(clean).toContain("<h2>Ok</h2>");
    expect(clean).toContain('<th scope="row">A</th>');
    expect(htmlToText(clean)).toContain("Texto link");
  });
});
