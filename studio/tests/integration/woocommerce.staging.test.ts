import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { checkDuplicates } from "@/lib/pipeline/duplicates";
import { processProductImage } from "@/lib/pipeline/images";
import { friendlyStoreError, WooCommerceProvider } from "@/lib/providers/woocommerce";
import type { Identity } from "@/lib/types";

// =============================================================================
// Real WooCommerce REST API (local staging from ../staging)
// =============================================================================
// Runs only when the staging credentials are exported, e.g.:
//   STAGING_WC_URL=http://localhost:8080 STAGING_WP_USER=admin \
//   STAGING_WP_APP_PASSWORD=xxxx npx vitest run tests/integration
// The staging store is seeded with a mirror of the production catalogue
// (staging/seed_from_snapshot.py), so duplicate detection runs on real names.

const url = process.env.STAGING_WC_URL;
const user = process.env.STAGING_WP_USER;
const password = process.env.STAGING_WP_APP_PASSWORD;
const enabled = Boolean(url && user && password);

const created: number[] = [];

/** A valid EAN-13 that does not exist in the mirror (prefix 200 = in-store use). */
function testEan(): string {
  const body = `200${String(Date.now()).slice(-9)}`;
  const sum = body
    .split("")
    .map(Number)
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

describe.skipIf(!enabled)("WooCommerce staging", () => {
  const wc = new WooCommerceProvider(url ?? "", user ?? "", password ?? "");
  const auth = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

  afterAll(async () => {
    for (const id of created) {
      await fetch(`${url}/wp-json/wc/v3/products/${id}?force=true`, {
        method: "DELETE",
        headers: { Authorization: auth },
      });
    }
  });

  it("lists the mirrored categories", async () => {
    const categories = await wc.listCategories();
    expect(categories.map((c) => c.slug)).toEqual(expect.arrayContaining(["soju", "salgadinhos", "pelucias"]));
  });

  it("finds the production triplicate of O'Star Queijo Duplo as a duplicate", async () => {
    const identity = {
      kind: "food",
      brand: "Orion",
      line: "O'Star",
      productType: "Salgadinho",
      variant: "Queijo Duplo",
      netContent: "30g",
      gtin: null,
    } as unknown as Identity;
    const result = await checkDuplicates({
      catalog: wc,
      identity,
      draft: {
        title: "Salgadinho Orion O'Star Sabor Queijo Duplo 30g",
        sku: "SAL-ORI-OST-QUDU-30G",
        gtin: null,
        brand: "Orion",
      },
    });
    expect(result.verdict).toBe("match");
    expect(result.candidates.length).toBeGreaterThanOrEqual(2); // the mirror has the 3 copies
    for (const c of result.candidates) expect(c.name.toLowerCase()).toContain("queijo duplo");
  });

  it("uploads a WebP, creates a pending product with stock, brand and attributes, then updates stock", async () => {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="900" height="900" fill="#fff"/><rect x="300" y="100" width="300" height="700" fill="#1f6f43"/></svg>`,
    );
    const { data } = await processProductImage(await sharp(svg).png().toBuffer(), { size: 1200, quality: 82 });
    const media = await wc.uploadImage({
      data,
      fileName: "teste-studio-soju-lotte-chum-churum-sabor-morango-360ml.webp",
      mimeType: "image/webp",
    });
    expect(media.id).toBeGreaterThan(0);
    expect(media.url).toMatch(/\.webp$/);
    await wc.updateMedia(media.id, { alt: "Garrafa de soju sabor morango", title: "Teste Studio Soju" });
    expect(await wc.mediaExists(media.id)).toBe(true);
    expect(await wc.mediaExists(99_999_999)).toBe(false);

    const brandId = await wc.findBrand("Lotte", true);
    expect(brandId).toBeGreaterThan(0);
    expect(await wc.findBrand("LOTTE", false)).toBe(brandId); // no duplicated brand terms
    expect(await wc.findBrand("Marca Que Nao Existe 7Q", false)).toBeNull(); // never created without evidence

    const sku = `TESTE-STUDIO-${Date.now()}`;
    const gtin = testEan();
    const product = await wc.createProduct({
      name: "Teste Studio Soju Lotte Chum-Churum Sabor Morango 360ml",
      slug: `teste-studio-${Date.now()}`,
      status: "pending",
      description:
        '<p>Descrição de teste.</p><h2>Especificações</h2><table><tbody><tr><th scope="row">Teor alcoólico</th><td>12% vol.</td></tr></tbody></table>',
      short_description: "<p>Teste.</p>",
      sku,
      global_unique_id: gtin,
      manage_stock: true,
      stock_quantity: 24,
      weight: "0.6",
      dimensions: { length: "8", width: "8", height: "24" },
      brands: [{ id: brandId as number }],
      attributes: [{ name: "Teor alcoólico", options: ["12% vol."], visible: true, variation: false }],
      images: [{ id: media.id, alt: "Garrafa de soju sabor morango" }],
      meta_data: [{ key: "_mimos_studio_job", value: "vitest" }],
    });
    created.push(product.id);
    expect(product.status).toBe("pending");
    expect(product.stockQuantity).toBe(24);
    expect(product.brands).toContain("Lotte");
    expect(product.hasPrice).toBe(false);
    expect(product.type).toBe("simple");
    expect(product.studioJob).toBe("vitest"); // lets a retried sync recognise its own product

    await wc.updateMedia(media.id, { parent: product.id });
    expect((await wc.findBySku(sku))?.id).toBe(product.id);
    expect((await wc.findByGtin(gtin))?.id).toBe(product.id);

    const detail = await wc.getProduct(product.id);
    expect(detail?.attributes.map((a) => a.name)).toContain("Teor alcoólico");
    expect(detail?.weight).toBe("0.6");

    const updated = await wc.updateProduct(product.id, { stock_quantity: 60 });
    expect(updated.stockQuantity).toBe(60);
    expect((await wc.getProduct(product.id))?.stockQuantity).toBe(60);
    expect(await wc.getProduct(99_999_999)).toBeNull();
  });

  it("rejects a duplicated SKU with a readable error", async () => {
    const attempt = wc.createProduct({
      name: "Duplicado",
      description: "",
      short_description: "",
      sku: "SNK-BAT-OST-ORI-30G", // exists in the mirror
      manage_stock: true,
      stock_quantity: 1,
      status: "draft",
    });
    const error = await attempt.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(friendlyStoreError(error)).toMatch(/Já existe na loja um produto com este SKU/);
  });
});
