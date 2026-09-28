import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { discardJob, JobConflictError, retryJob, runPipeline, runSync } from "@/lib/jobs/runner";
import { createJob, getJob, mediaDir, updateJob } from "@/lib/jobs/store";
import { ALCOHOL_NOTICES } from "@/lib/pipeline/compliance";
import { SyncRejectedError } from "@/lib/pipeline/sync";
import type { Providers } from "@/lib/providers";
import { MemoryCatalog, MockLlm, MockSearchProvider, mockImage } from "@/lib/providers/mock";

// =============================================================================
// End-to-end pipeline with offline providers and an in-memory store
// =============================================================================

let dir: string;
let catalog: MemoryCatalog;
let providers: Providers;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "studio-test-"));
  process.env.STUDIO_DATA_DIR = dir;
  process.env.STUDIO_PROVIDERS = "mock";
  process.env.STUDIO_CATALOG = "memory";
  resetEnvCache();
  catalog = new MemoryCatalog(
    [
      {
        id: 235,
        name: "Snack Batata Frita Coreano O’star Orion 30g Sabor Queijo Duplo",
        slug: "snack-batata-frita-coreano-ostar-orion-30g-sabor-queijo-duplo",
        sku: "SNK-BAT-OST-ORI-30G",
        gtin: "",
        status: "publish",
        stockQuantity: 0,
        permalink: "http://memory.local/snack",
        brands: ["O'star", "Orion"],
        hasPrice: true,
      },
    ],
    [
      { id: 261, name: "Soju", slug: "soju", parent: 0, count: 12 },
      { id: 112, name: "Salgadinhos", slug: "salgadinhos", parent: 0, count: 10 },
      { id: 231, name: "Pelúcias", slug: "pelucias", parent: 0, count: 7 },
      { id: 16, name: "Bebidas", slug: "bebidas", parent: 0, count: 21 },
    ],
  );
  providers = {
    llm: new MockLlm(),
    research: [new MockSearchProvider()],
    catalog,
    fetchImage: mockImage,
    visionModel: "mock",
  };
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function generate(productName: string, referenceUrl: string, stockQuantity: number) {
  const job = await createJob({ productName, referenceUrl, stockQuantity });
  await runPipeline(job.id, providers);
  const done = await getJob(job.id);
  if (!done) throw new Error("job vanished");
  return done;
}

describe("soju (alcoholic beverage) - new product", () => {
  it("researches, writes, verifies, processes images and creates a pending product", async () => {
    const job = await generate(
      "soju chum churum morango 360ml 🍓",
      "https://www.mercadolivre.com.br/soju-chum-churum-lotte-morango-360ml/p/MLB000001",
      24,
    );
    expect(job.status, job.error ?? "").toBe("ready");
    expect(job.steps.filter((s) => s.key !== "sync").every((s) => s.status === "done")).toBe(true);

    const draft = job.draft;
    if (!draft) throw new Error("no draft");
    // Title rules: no emoji, no store name, no pipes
    expect(draft.title).toBe("Soju Lotte Chum-Churum Sabor Morango 360ml");
    expect(draft.titleAdjustments.length).toBeGreaterThan(0);

    // Variant safety: 12% from the strawberry pages, never 16.5% from the "original" page
    const abv = draft.facts.find((f) => f.field === "alcohol_abv" && f.verified);
    expect(abv?.value).toBe("12% vol.");
    // The mock model also writes "Todas as versões têm teor alcoólico de 16,5%" in the intro: removed.
    expect(draft.descriptionHtml).not.toContain("16,5");
    expect(draft.gtin).toBe("8801030000396");
    // ...and a WhatsApp number in the short description: removed.
    expect(draft.shortDescriptionHtml).not.toMatch(/whatsapp|99999/i);
    expect(draft.brandVerified).toBe(true);

    // Legal notices are deterministic
    for (const notice of ALCOHOL_NOTICES) expect(draft.descriptionHtml).toContain(notice);
    expect(draft.descriptionHtml).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2705}]/u);

    expect(draft.category?.name).toBe("Soju");
    expect(draft.sku).toMatch(/^SOJ-LOT-CHCH-MOR-360ML-[0-9A-Z]{4}$/);
    expect(draft.images.length).toBeGreaterThan(0);
    for (const img of draft.images) {
      expect(img.fileName).toMatch(/^soju-lotte-chum-churum-sabor-morango-360ml(-\d)?\.webp$/);
      expect(existsSync(path.join(mediaDir(job.id), img.fileName))).toBe(true);
    }
    expect(job.duplicates?.verdict).toBe("none");
    expect(draft.complete).toBe(true);

    const synced = await runSync(job.id, { mode: "create" }, providers);
    expect(synced.status).toBe("synced");
    expect(synced.sync?.status).toBe("pending"); // no price yet: awaits the owner's approval
    const product = await catalog.getProduct(synced.sync?.productId ?? -1);
    expect(product?.stockQuantity).toBe(24);
    expect(product?.sku).toBe(draft.sku);
    expect(product?.studioJob).toBe(job.id);
    expect(catalog.media.every((m) => m.parent === product?.id)).toBe(true);

    // Idempotent: a second click does not create anything new
    const before = catalog.products.length;
    const again = await runSync(job.id, { mode: "create" }, providers);
    expect(again.sync?.productId).toBe(synced.sync?.productId);
    expect(catalog.products.length).toBe(before);
  });
});

describe("O'Star Queijo Duplo - already in the store", () => {
  it("detects the duplicate and only allows updating the existing product", async () => {
    const job = await generate(
      "Salgadinho O'Star Queijo Duplo 30g",
      "https://www.konbini.com.br/salgadinho-orion-o-star-queijo-duplo-30g",
      50,
    );
    expect(job.status, job.error ?? "").toBe("ready");
    expect(job.duplicates?.verdict).toBe("match");
    expect(job.duplicates?.candidates[0].id).toBe(235);

    // Food facts verified from the Brazilian page
    const draft = job.draft;
    if (!draft) throw new Error("no draft");
    expect(draft.nutrition?.rows.length).toBeGreaterThanOrEqual(5);
    expect(draft.facts.find((f) => f.field === "gluten")?.verified).toBe(true);
    expect(draft.facts.find((f) => f.field === "allergens")?.verified).toBe(true);

    await expect(runSync(job.id, { mode: "create" }, providers)).rejects.toBeInstanceOf(SyncRejectedError);
    const synced = await runSync(job.id, { mode: "update", productId: 235 }, providers);
    expect(synced.sync?.mode).toBe("update");
    const product = await catalog.getProduct(235);
    expect(product?.stockQuantity).toBe(50);
    expect(product?.status).toBe("publish"); // a live product stays live
    expect(product?.sku).toBe("SNK-BAT-OST-ORI-30G"); // existing SKU is kept
    expect(catalog.products.filter((p) => /queijo duplo/i.test(p.name)).length).toBe(1);
  });
});

describe("plush toy", () => {
  it("extracts material and age grading and adds the INMETRO reminder", async () => {
    const job = await generate(
      "Pelúcia Capivara Gotinha 45cm",
      "https://shopee.com.br/pelucia-capivara-gotinha-45cm-i.000.001",
      7,
    );
    expect(job.status, job.error ?? "").toBe("ready");
    const draft = job.draft;
    if (!draft) throw new Error("no draft");
    expect(draft.kind).toBe("plush_toy");
    expect(draft.facts.find((f) => f.field === "material")?.verified).toBe(true);
    expect(draft.facts.find((f) => f.field === "age_grading")?.verified).toBe(true);
    expect(draft.descriptionHtml).toContain("INMETRO");
  });
});

describe("unknown product with an unreadable link", () => {
  it("still finishes, but flags missing information and sends the product for approval", async () => {
    const job = await generate(
      "Produto Misterioso XPTO",
      "https://loja-desconhecida.example/produto-misterioso-xpto",
      3,
    );
    expect(job.status, job.error ?? "").toBe("ready");
    expect(job.draft?.complete).toBe(false);
    expect(job.draft?.missing.some((m) => m.field === "photos" && m.severity === "blocker")).toBe(true);
  });
});

describe("store safety around sync", () => {
  it("refuses to create when an equal product appeared after the review", async () => {
    const job = await generate(
      "Lamen Samyang Buldak Carbonara 130g",
      "https://www.amazon.com.br/Samyang-Buldak-Carbonara-130g/dp/B000000001",
      10,
    );
    expect(job.status, job.error ?? "").toBe("ready");
    expect(job.duplicates?.verdict).toBe("none");
    // Someone registers the same item directly in WordPress meanwhile.
    const intruder = await catalog.createProduct({
      name: job.draft?.title ?? "",
      description: "",
      short_description: "",
      manage_stock: true,
      stock_quantity: 1,
      status: "publish",
    });
    await expect(runSync(job.id, { mode: "create" }, providers)).rejects.toThrow(/apareceu na loja/);
    const after = await getJob(job.id);
    expect(after?.status).toBe("ready");
    expect(after?.duplicates?.candidates.some((c) => c.id === intruder.id)).toBe(true);
    expect(catalog.products.filter((p) => p.name === job.draft?.title)).toHaveLength(1);
  });

  it("updates only the stock of a live product when the new listing is incomplete", async () => {
    const live = await catalog.createProduct({
      name: "Produto Misterioso XPTO",
      description: "<p>Texto do dono</p>",
      short_description: "",
      manage_stock: true,
      stock_quantity: 1,
      status: "publish",
    });
    const job = await generate(
      "Produto Misterioso XPTO",
      "https://loja-desconhecida.example/produto-misterioso-xpto",
      8,
    );
    expect(job.draft?.complete).toBe(false);
    const target = job.duplicates?.candidates.find((c) => c.id === live.id);
    expect(target).toBeTruthy();
    const synced = await runSync(job.id, { mode: "update", productId: live.id }, providers);
    expect(synced.sync?.contentUpdated).toBe(false);
    const product = catalog.products.find((p) => p.id === live.id);
    expect(product?.stockQuantity).toBe(8);
    expect(product?.name).toBe("Produto Misterioso XPTO");
    expect(product?.payload.description).toBe("<p>Texto do dono</p>");
    expect(product?.meta._mimos_studio_pending_content).toBe("1");
  });

  it("never sends mock content to a real store", async () => {
    const job = await generate(
      "Pelúcia Capivara Gotinha 45cm",
      "https://shopee.com.br/pelucia-capivara-gotinha-45cm-i.000.001",
      2,
    );
    const realStore = Object.assign(Object.create(Object.getPrototypeOf(catalog)), catalog, {
      name: "woocommerce",
      baseUrl: "https://mimoskorea.com.br",
    });
    const decision = job.duplicates?.verdict === "none" ? ({ mode: "create" } as const) : null;
    expect(decision).not.toBeNull();
    await expect(runSync(job.id, { mode: "create" }, { ...providers, catalog: realStore })).rejects.toThrow(
      /modo de demonstração/,
    );
    expect((await getJob(job.id))?.status).toBe("ready");
  });
});

describe("two operators, same new product, same moment", () => {
  it("creates it once: the second sync sees the first product and is refused", async () => {
    const url = "https://www.amazon.com.br/Samyang-Buldak-Carbonara-130g/dp/B000000001";
    // Clean slate for this product in the memory store.
    catalog.products = catalog.products.filter((p) => !/buldak/i.test(p.name));
    const [a, b] = await Promise.all([
      generate("Lamen Samyang Buldak Carbonara 130g", url, 10),
      generate("Lamen Buldak Carbonara Samyang 130g", url, 12),
    ]);
    expect(a.duplicates?.verdict).toBe("none");
    expect(b.duplicates?.verdict).toBe("none");
    const results = await Promise.allSettled([
      runSync(a.id, { mode: "create" }, providers),
      runSync(b.id, { mode: "create" }, providers),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(catalog.products.filter((p) => /buldak/i.test(p.name))).toHaveLength(1);
  });
});

describe("retry and discard", () => {
  it("'Gerar de novo' replaces the job once, even on a double click", async () => {
    const job = await generate(
      "Pelúcia Capivara Gotinha 45cm",
      "https://shopee.com.br/pelucia-capivara-gotinha-45cm-i.000.001",
      4,
    );
    const [a, b] = await Promise.all([retryJob(job.id), retryJob(job.id)]);
    expect(a?.id).toBe(b?.id);
    const old = await getJob(job.id);
    expect(old?.status).toBe("superseded");
    expect(old?.supersededBy).toBe(a?.id);
    await expect(runSync(job.id, { mode: "create" }, providers)).rejects.toThrow(/substituído/);
    expect((await retryJob(job.id))?.id).toBe(a?.id);
    if (a) await runPipeline(a.id, providers);
  });

  it("a discarded job can no longer be synced, and a synced one cannot be discarded", async () => {
    const job = await generate(
      "Pelúcia Capivara Gotinha 45cm",
      "https://shopee.com.br/pelucia-capivara-gotinha-45cm-i.000.001",
      5,
    );
    await discardJob(job.id);
    expect((await getJob(job.id))?.status).toBe("discarded");
    await expect(runSync(job.id, { mode: "create" }, providers)).rejects.toThrow(/descartado/);

    const synced = await createJob({ productName: "x x x", referenceUrl: "https://example.com/x", stockQuantity: 1 });
    await updateJob(synced.id, (j) => {
      j.status = "synced";
    });
    await expect(discardJob(synced.id)).rejects.toBeInstanceOf(JobConflictError);
  });

  it("a job discarded while running stops and is not marked ready", async () => {
    const job = await createJob({
      productName: "Pelúcia Capivara Gotinha 45cm",
      referenceUrl: "https://shopee.com.br/pelucia-capivara-gotinha-45cm-i.000.001",
      stockQuantity: 1,
    });
    await discardJob(job.id);
    await runPipeline(job.id, providers);
    const after = await getJob(job.id);
    expect(after?.status).toBe("discarded");
    expect(after?.draft).toBeNull();
  });
});
