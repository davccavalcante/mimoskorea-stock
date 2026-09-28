import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogProvider, ProductPayload } from "@/lib/providers/catalog";
import type { Job, SyncResult } from "@/lib/types";

// =============================================================================
// Sync the reviewed draft to WooCommerce
// =============================================================================
// Rules (the owner's "iron fist"):
// - A confident duplicate can only be UPDATED, never created again.
// - New products have no price (the owner sets it), so they are created as
//   "pending" (awaiting review) unless configured otherwise.
// - Incomplete drafts (blocker fields missing) never publish on their own.
// - Stock is set to the exact quantity typed by the operator.
// - Uploaded media ids are remembered, so a retried sync does not re-upload.

export type SyncDecision = { mode: "create" } | { mode: "update"; productId: number };

export type SyncSettings = {
  statusWhenComplete: "publish" | "pending" | "draft";
  statusWhenIncomplete: "pending" | "draft";
  seoPlugin: "none" | "yoast" | "rankmath";
  mediaDir: string;
};

export class SyncRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncRejectedError";
  }
}

function seoMeta(job: Job, plugin: SyncSettings["seoPlugin"]): Array<{ key: string; value: string }> {
  const seo = job.draft?.seo;
  if (!seo || plugin === "none") return [];
  if (plugin === "yoast") {
    return [
      { key: "_yoast_wpseo_title", value: seo.metaTitle },
      { key: "_yoast_wpseo_metadesc", value: seo.metaDescription },
      { key: "_yoast_wpseo_focuskw", value: seo.focusKeyword },
    ];
  }
  return [
    { key: "rank_math_title", value: seo.metaTitle },
    { key: "rank_math_description", value: seo.metaDescription },
    { key: "rank_math_focus_keyword", value: seo.focusKeyword },
  ];
}

/** Decide create vs update, enforcing the duplicate guard. */
export function resolveDecision(job: Job, requested: SyncDecision): SyncDecision {
  const dup = job.duplicates;
  if (dup?.verdict === "match") {
    const top = dup.candidates[0];
    if (requested.mode === "create") {
      throw new SyncRejectedError(`Este produto já existe na loja (ID ${top.id}). Ele só pode ser atualizado.`);
    }
    if (requested.productId !== top.id) {
      throw new SyncRejectedError(`O produto correspondente é o ID ${top.id}.`);
    }
  }
  if (requested.mode === "update" && !dup?.candidates.some((c) => c.id === requested.productId)) {
    throw new SyncRejectedError("Só é possível atualizar um produto sugerido pela verificação de duplicatas.");
  }
  return requested;
}

export async function syncToCatalog(args: {
  job: Job;
  decision: SyncDecision;
  catalog: CatalogProvider;
  settings: SyncSettings;
  rememberMedia: (fileName: string, mediaId: number) => Promise<void>;
}): Promise<SyncResult> {
  const { job, catalog, settings, rememberMedia } = args;
  const draft = job.draft;
  if (!draft) throw new SyncRejectedError("O cadastro ainda não está pronto.");
  if (job.sync) return job.sync; // idempotent
  const decision = resolveDecision(job, args.decision);

  // 1. Upload images (skip the ones already uploaded by a previous attempt).
  const uploaded = { ...(job.syncMedia ?? {}) };
  for (const img of draft.images) {
    if (uploaded[img.fileName]) continue;
    const data = await readFile(path.join(settings.mediaDir, img.fileName));
    const { id } = await catalog.uploadImage({
      data,
      fileName: img.fileName,
      mimeType: "image/webp",
      alt: img.alt,
      title: draft.title,
    });
    uploaded[img.fileName] = id;
    await rememberMedia(img.fileName, id);
  }
  const imagePayload = draft.images.map((img) => ({
    id: uploaded[img.fileName],
    alt: img.alt,
  }));

  // 2. Brand and base payload.
  const brandId = draft.brand ? await catalog.ensureBrand(draft.brand) : null;
  const num = (n: number | null) => (n && n > 0 ? String(Math.round(n * 1000) / 1000) : "");
  const payload: ProductPayload = {
    name: draft.title,
    description: draft.descriptionHtml,
    short_description: draft.shortDescriptionHtml,
    manage_stock: true,
    stock_quantity: job.input.stockQuantity,
    weight: num(draft.shipping.weightKg),
    dimensions: {
      length: num(draft.shipping.lengthCm),
      width: num(draft.shipping.widthCm),
      height: num(draft.shipping.heightCm),
    },
    ...(draft.category ? { categories: [{ id: draft.category.id }] } : {}),
    ...(brandId ? { brands: [{ id: brandId }] } : {}),
    attributes: draft.attributes.map((a) => ({
      name: a.name,
      options: [a.value],
      visible: true,
      variation: false,
    })),
    ...(imagePayload.length ? { images: imagePayload } : {}),
    meta_data: [
      { key: "_mimos_studio_job", value: job.id },
      { key: "_mimos_studio_synced_at", value: new Date().toISOString() },
      {
        key: "_mimos_studio_sources",
        value: JSON.stringify(job.sources.map((s) => ({ id: s.id, url: s.url }))),
      },
      ...seoMeta(job, settings.seoPlugin),
    ],
  };

  let saved: Awaited<ReturnType<CatalogProvider["createProduct"]>>;
  if (decision.mode === "update") {
    const existing = await catalog.getProduct(decision.productId);
    if (!existing) throw new SyncRejectedError(`Produto ${decision.productId} não encontrado na loja.`);
    const status =
      existing.status === "publish"
        ? "publish"
        : draft.complete && existing.hasPrice
          ? settings.statusWhenComplete
          : settings.statusWhenIncomplete;
    const update: Partial<ProductPayload> = {
      ...payload,
      status,
      ...(!existing.sku ? { sku: draft.sku } : {}),
      ...(!existing.gtin && draft.gtin ? { global_unique_id: draft.gtin } : {}),
    };
    try {
      saved = await catalog.updateProduct(existing.id, update);
    } catch (error) {
      if (update.sku && /sku/i.test(String(error))) {
        delete update.sku;
        saved = await catalog.updateProduct(existing.id, update);
      } else throw error;
    }
  } else {
    const create: ProductPayload = {
      ...payload,
      slug: draft.slug,
      status: settings.statusWhenIncomplete, // no price yet: the owner prices and publishes
      sku: draft.sku,
      ...(draft.gtin ? { global_unique_id: draft.gtin } : {}),
    };
    try {
      saved = await catalog.createProduct(create);
    } catch (error) {
      if (/sku/i.test(String(error))) {
        create.sku = `${draft.sku}-${job.id.slice(0, 4).toUpperCase()}`;
        saved = await catalog.createProduct(create);
      } else throw error;
    }
  }

  // 3. Attach uploaded images to the product (keeps the media library tidy).
  for (const id of Object.values(uploaded)) {
    await catalog.attachMedia(id, saved.id).catch(() => undefined);
  }

  const base = catalog.baseUrl.replace(/\/$/, "");
  return {
    mode: decision.mode,
    productId: saved.id,
    status: saved.status,
    permalink: saved.permalink,
    adminUrl: `${base}/wp-admin/post.php?post=${saved.id}&action=edit`,
    mediaIds: Object.values(uploaded),
    stockQuantity: job.input.stockQuantity,
    at: new Date().toISOString(),
  };
}
