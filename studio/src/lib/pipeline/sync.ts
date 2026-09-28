import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "@/lib/net/http";
import { planCreate, planUpdate, type SyncSettingsLike, updatableCandidates } from "@/lib/pipeline/plan";
import type { CatalogProvider, ProductAttribute, ProductDetail, ProductPayload } from "@/lib/providers/catalog";
import { friendlyStoreError } from "@/lib/providers/woocommerce";
import type { DuplicateCheck, Job, SyncResult } from "@/lib/types";

// =============================================================================
// Sync the reviewed draft to WooCommerce
// =============================================================================
// Rules (the owner's "iron fist"):
// - A confident duplicate can only be UPDATED, never created again.
// - The duplicate check is repeated against the live store right before sync.
// - New products have no price (the owner sets it): created as pending/draft.
// - A live product is never overwritten with an incomplete listing: stock only.
// - Owner data (categories, brands, custom attributes, weights) is merged, not replaced.
// - Stock is set to the exact quantity typed by the operator, and verified.
// - Uploaded media ids are remembered, so a retried sync does not re-upload.
// - A SKU conflict never produces a second product with an invented SKU.

export type SyncDecision = { mode: "create" } | { mode: "update"; productId: number };

export type SyncSettings = SyncSettingsLike & {
  seoPlugin: "none" | "yoast" | "rankmath";
  mediaDir: string;
};

export class SyncRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncRejectedError";
  }
}

// -----------------------------------------------------------------------------
// Decision rules
// -----------------------------------------------------------------------------

export function resolveDecision(job: Pick<Job, "duplicates">, requested: SyncDecision): SyncDecision {
  const dup = job.duplicates;
  if (!dup) throw new SyncRejectedError("A verificação de duplicatas não foi concluída. Gere o cadastro de novo.");
  const allowed = updatableCandidates(dup);
  if (requested.mode === "create") {
    if (dup.verdict === "match") {
      throw new SyncRejectedError(
        `Este produto já existe na loja (ID ${allowed.map((c) => c.id).join(" ou ")}). Ele só pode ser atualizado.`,
      );
    }
    return requested;
  }
  if (!allowed.some((c) => c.id === requested.productId)) {
    throw new SyncRejectedError(
      dup.verdict === "match"
        ? `O produto correspondente é o ID ${allowed.map((c) => c.id).join(" ou ")}.`
        : "Só é possível atualizar um produto sugerido pela verificação de duplicatas.",
    );
  }
  return requested;
}

/** Returns a reason when the live store no longer matches what the operator reviewed. */
export function storeChanged(stored: DuplicateCheck, fresh: DuplicateCheck, decision: SyncDecision): string | null {
  const known = new Set(stored.candidates.map((c) => c.id));
  if (decision.mode === "create") {
    if (fresh.verdict === "match") return "Um produto igual apareceu na loja desde a revisão.";
    if (fresh.candidates.some((c) => !known.has(c.id))) return "Surgiram produtos parecidos na loja desde a revisão.";
    return null;
  }
  const target = fresh.candidates.find((c) => c.id === decision.productId);
  if (!target) return `O produto ID ${decision.productId} mudou ou não está mais na loja.`;
  return null;
}

// -----------------------------------------------------------------------------
// Payload helpers
// -----------------------------------------------------------------------------

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

const num = (n: number | null) => (n && n > 0 ? String(Math.round(n * 1000) / 1000) : "");

/** Keep the owner's attributes (global taxonomies and custom ones); ours override same-name custom attributes. */
export function mergeAttributes(existing: ProductAttribute[], ours: ProductAttribute[]): ProductAttribute[] {
  const key = (a: ProductAttribute) => a.name.trim().toLowerCase();
  const oursByName = new Map(ours.map((a) => [key(a), a]));
  const merged = existing.map((a) =>
    !a.id && oursByName.has(key(a)) ? (oursByName.get(key(a)) as ProductAttribute) : a,
  );
  for (const a of ours) if (!existing.some((e) => key(e) === key(a))) merged.push(a);
  return merged;
}

function studioMeta(job: Job, extra: Array<{ key: string; value: string }> = []) {
  return [
    { key: "_mimos_studio_job", value: job.id },
    { key: "_mimos_studio_synced_at", value: new Date().toISOString() },
    { key: "_mimos_studio_sources", value: JSON.stringify(job.sources.map((s) => ({ id: s.id, url: s.url }))) },
    ...extra,
  ];
}

function isConflict(error: unknown): boolean {
  if (!(error instanceof HttpError)) return false;
  const code = (error.body as { code?: string } | null)?.code ?? "";
  return error.status === 0 || /sku|global_unique_id|not_created/.test(code);
}

// -----------------------------------------------------------------------------
// Sync
// -----------------------------------------------------------------------------

export async function syncToCatalog(args: {
  job: Job;
  decision: SyncDecision;
  catalog: CatalogProvider;
  settings: SyncSettings;
  rememberMedia: (fileName: string, mediaId: number) => Promise<void>;
}): Promise<SyncResult> {
  const { job, decision, catalog, settings, rememberMedia } = args;
  const draft = job.draft;
  if (!draft) throw new SyncRejectedError("O cadastro não tem conteúdo gerado.");
  if (job.sync) return job.sync; // idempotent
  const stock = job.input.stockQuantity;
  const notes: string[] = [];

  // 0. Decide what will happen (same rules the confirmation dialog showed).
  let existing: ProductDetail | null = null;
  if (decision.mode === "update") {
    existing = await catalog.getProduct(decision.productId);
    if (!existing) throw new SyncRejectedError(`O produto ID ${decision.productId} não foi encontrado na loja.`);
    if (existing.type !== "simple") {
      throw new SyncRejectedError(
        `O produto ID ${existing.id} é do tipo "${existing.type}". Atualize produtos variáveis pelo WordPress.`,
      );
    }
  }
  const plan = existing ? planUpdate(draft, existing, stock, settings) : planCreate(draft, stock, settings);
  if (!plan.ok) throw new SyncRejectedError(plan.reason);

  // 1. Images (only when the content is going to be written).
  const uploaded: Record<string, number> = {};
  if (plan.contentUpdated) {
    for (const img of draft.images) {
      const remembered = job.syncMedia?.[img.fileName];
      if (remembered && (await catalog.mediaExists(remembered))) {
        uploaded[img.fileName] = remembered;
        continue;
      }
      const data = await readFile(path.join(settings.mediaDir, img.fileName));
      const { id } = await catalog.uploadImage({ data, fileName: img.fileName, mimeType: "image/webp" });
      uploaded[img.fileName] = id;
      await rememberMedia(img.fileName, id); // before anything else can fail
      await catalog.updateMedia(id, { alt: img.alt, title: draft.title }).catch(() => {
        notes.push(`Não foi possível gravar o texto alternativo da imagem ${img.fileName}.`);
      });
    }
  }
  const imagePayload = draft.images
    .filter((img) => uploaded[img.fileName])
    .map((img) => ({ id: uploaded[img.fileName], alt: img.alt }));

  // 2. Brand: reuse an existing term; create a new one only when the sources name it.
  const brandId = draft.brand ? await catalog.findBrand(draft.brand, draft.brandVerified) : null;
  if (draft.brand && !brandId) notes.push(`A marca "${draft.brand}" não foi criada porque não aparece nas fontes.`);

  const ourAttributes = draft.attributes.map((a) => ({
    name: a.name,
    options: [a.value],
    visible: true,
    variation: false,
  }));
  let saved: ProductDetail;

  if (plan.mode === "create") {
    // Last guard against a race: the deterministic SKU or the barcode already exists.
    const bySku = await catalog.findBySku(draft.sku);
    const byGtin = draft.gtin ? await catalog.findByGtin(draft.gtin) : null;
    const clash = bySku ?? byGtin;
    if (clash) {
      const detail = await catalog.getProduct(clash.id);
      if (detail?.studioJob !== job.id) {
        throw new SyncRejectedError(
          `Já existe na loja um produto com este ${bySku ? "SKU" : "código de barras"} (ID ${clash.id}). Nada foi criado. Gere de novo para atualizar esse produto.`,
        );
      }
      saved = detail; // created by this same job in an earlier attempt whose answer was lost
      notes.push("O produto já tinha sido criado numa tentativa anterior; ela foi recuperada.");
    } else {
      const payload: ProductPayload = {
        name: draft.title,
        slug: draft.slug,
        status: plan.status,
        description: draft.descriptionHtml,
        short_description: draft.shortDescriptionHtml,
        sku: draft.sku,
        ...(draft.gtin ? { global_unique_id: draft.gtin } : {}),
        manage_stock: true,
        stock_quantity: stock,
        weight: num(draft.shipping.weightKg),
        dimensions: {
          length: num(draft.shipping.lengthCm),
          width: num(draft.shipping.widthCm),
          height: num(draft.shipping.heightCm),
        },
        ...(draft.category ? { categories: [{ id: draft.category.id }] } : {}),
        ...(brandId ? { brands: [{ id: brandId }] } : {}),
        attributes: ourAttributes,
        ...(imagePayload.length ? { images: imagePayload } : {}),
        meta_data: studioMeta(job, seoMeta(job, settings.seoPlugin)),
      };
      try {
        saved = await catalog.createProduct(payload);
      } catch (error) {
        if (!isConflict(error)) throw new SyncRejectedError(friendlyStoreError(error));
        const found = await catalog.findBySku(draft.sku);
        const detail = found ? await catalog.getProduct(found.id) : null;
        if (detail?.studioJob === job.id) saved = detail;
        else
          throw new SyncRejectedError(
            `${friendlyStoreError(error)} Nada foi criado. Gere de novo para atualizar esse produto.`,
          );
      }
    }
  } else {
    const current = existing as ProductDetail;
    let payload: Partial<ProductPayload>;
    if (!plan.contentUpdated) {
      payload = {
        manage_stock: true,
        stock_quantity: stock,
        ...(!current.sku ? { sku: draft.sku } : {}),
        ...(!current.gtin && draft.gtin ? { global_unique_id: draft.gtin } : {}),
        meta_data: studioMeta(job, [{ key: "_mimos_studio_pending_content", value: "1" }]),
      };
      notes.push(
        "Faltam informações obrigatórias: só o estoque foi atualizado. O texto novo ficou no histórico para o administrador.",
      );
    } else {
      const categoryIds = new Set(current.categoryIds);
      if (draft.category) categoryIds.add(draft.category.id);
      const brandIds = new Set(current.brandIds);
      if (brandId) brandIds.add(brandId);
      const hasWeight = Boolean(current.weight);
      const hasDims = Boolean(current.dimensions.length || current.dimensions.width || current.dimensions.height);
      payload = {
        name: draft.title,
        status: plan.status,
        description: draft.descriptionHtml,
        short_description: draft.shortDescriptionHtml,
        manage_stock: true,
        stock_quantity: stock,
        ...(!current.sku ? { sku: draft.sku } : {}),
        ...(!current.gtin && draft.gtin ? { global_unique_id: draft.gtin } : {}),
        ...(!hasWeight && num(draft.shipping.weightKg) ? { weight: num(draft.shipping.weightKg) } : {}),
        ...(!hasDims && num(draft.shipping.lengthCm)
          ? {
              dimensions: {
                length: num(draft.shipping.lengthCm),
                width: num(draft.shipping.widthCm),
                height: num(draft.shipping.heightCm),
              },
            }
          : {}),
        ...(categoryIds.size ? { categories: [...categoryIds].map((id) => ({ id })) } : {}),
        ...(brandIds.size ? { brands: [...brandIds].map((id) => ({ id })) } : {}),
        attributes: mergeAttributes(current.attributes, ourAttributes),
        ...(imagePayload.length ? { images: imagePayload } : {}),
        meta_data: studioMeta(job, seoMeta(job, settings.seoPlugin)),
      };
    }
    try {
      saved = await catalog.updateProduct(current.id, payload);
    } catch (error) {
      if (payload.sku && isConflict(error)) {
        delete payload.sku;
        saved = await catalog.updateProduct(current.id, payload);
        notes.push("O SKU novo já existia em outro produto e não foi aplicado.");
      } else throw new SyncRejectedError(friendlyStoreError(error));
    }
  }

  // 3. Attach images to the product (keeps the media library tidy; best effort).
  for (const id of Object.values(uploaded)) {
    await catalog.updateMedia(id, { parent: saved.id }).catch(() => undefined);
  }

  // 4. Verify that the store really applied the stock.
  if (saved.stockQuantity !== stock) {
    notes.push(
      `ATENÇÃO: a loja registrou estoque ${saved.stockQuantity ?? "não controlado"} em vez de ${stock}. Ative "Gerenciar estoque" em WooCommerce > Configurações > Produtos > Inventário.`,
    );
  }

  const base = catalog.baseUrl.replace(/\/$/, "");
  return {
    mode: plan.mode,
    productId: saved.id,
    status: saved.status,
    permalink: saved.permalink,
    adminUrl: `${base}/wp-admin/post.php?post=${saved.id}&action=edit`,
    mediaIds: Object.values(uploaded),
    stockQuantity: saved.stockQuantity ?? stock,
    contentUpdated: plan.contentUpdated,
    notes,
    at: new Date().toISOString(),
  };
}
