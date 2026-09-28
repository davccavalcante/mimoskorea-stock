import "server-only";
import { HttpError, requestJson } from "@/lib/net/http";
import { fold } from "@/lib/text/normalize";
import type { CatalogProduct } from "@/lib/types";
import type { CatalogCategory, CatalogProvider, ProductAttribute, ProductDetail, ProductPayload } from "./catalog";

// =============================================================================
// WooCommerce REST v3 + WordPress REST (Application Password auth)
// =============================================================================
// One WordPress Application Password authenticates both /wc/v3 (products,
// categories, brands) and /wp/v2/media (image upload). Create it in
// wp-admin > Users > Profile > Application Passwords.

type WcProduct = {
  id: number;
  name: string;
  slug: string;
  type?: string;
  sku: string;
  global_unique_id?: string;
  status: string;
  manage_stock?: boolean;
  stock_quantity: number | null;
  permalink: string;
  price: string;
  regular_price: string;
  weight?: string;
  dimensions?: { length: string; width: string; height: string };
  categories?: Array<{ id: number }>;
  brands?: Array<{ id: number; name: string }>;
  attributes?: Array<{ id: number; name: string; options: string[]; visible: boolean; variation: boolean }>;
  meta_data?: Array<{ key: string; value: unknown }>;
};

type WcTerm = { id: number; name: string; slug: string; parent?: number; count?: number };

/** Translate WooCommerce errors into short Portuguese messages for the operator. */
export function friendlyStoreError(error: unknown): string {
  if (!(error instanceof HttpError)) return error instanceof Error ? error.message : String(error);
  const body = error.body as { code?: string; message?: string; data?: { resource_id?: number } } | null;
  const code = body?.code ?? "";
  const id = body?.data?.resource_id ? ` (ID ${body.data.resource_id})` : "";
  if (error.status === 0)
    return "Não foi possível falar com a loja (rede ou servidor fora do ar). Tente de novo em alguns minutos.";
  if (error.status === 401 || error.status === 403)
    return "A loja recusou o acesso. Confira WP_USERNAME e WP_APPLICATION_PASSWORD (a senha de aplicação pode ter sido revogada).";
  if (code === "product_invalid_sku" || code === "woocommerce_rest_product_not_created")
    return `Já existe na loja um produto com este SKU${id}.`;
  if (code === "product_invalid_global_unique_id") return `Este código de barras já pertence a outro produto${id}.`;
  if (error.status >= 500) return "A loja apresentou um erro interno. Tente de novo em alguns minutos.";
  return error.message;
}

const wcError = (body: unknown) => {
  const b = body as { code?: string; message?: string } | null;
  return b?.message ? `${b.message}${b.code ? ` (${b.code})` : ""}` : undefined;
};

const priced = (p: WcProduct) => Boolean(p.regular_price || p.price);

function toCatalog(p: WcProduct): CatalogProduct {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    sku: p.sku ?? "",
    gtin: p.global_unique_id ?? "",
    status: p.status,
    stockQuantity: p.stock_quantity,
    permalink: p.permalink,
    brands: (p.brands ?? []).map((b) => b.name),
    hasPrice: priced(p),
  };
}

function toDetail(p: WcProduct): ProductDetail {
  const job = p.meta_data?.find((m) => m.key === "_mimos_studio_job")?.value;
  return {
    ...toCatalog(p),
    type: p.type ?? "simple",
    manageStock: Boolean(p.manage_stock),
    weight: p.weight ?? "",
    dimensions: p.dimensions ?? { length: "", width: "", height: "" },
    categoryIds: (p.categories ?? []).map((c) => c.id),
    brandIds: (p.brands ?? []).map((b) => b.id),
    attributes: (p.attributes ?? []).map(
      (a): ProductAttribute => ({
        ...(a.id ? { id: a.id } : {}),
        name: a.name,
        options: a.options,
        visible: a.visible,
        variation: a.variation,
      }),
    ),
    studioJob: typeof job === "string" ? job : null,
  };
}

const LIST_FIELDS = "id,name,slug,sku,global_unique_id,status,stock_quantity,permalink,price,regular_price,brands";
const DETAIL_FIELDS = `${LIST_FIELDS},type,manage_stock,weight,dimensions,categories,attributes,meta_data`;

export class WooCommerceProvider implements CatalogProvider {
  readonly name = "woocommerce";
  private readonly auth: string;

  constructor(
    readonly baseUrl: string,
    username: string,
    applicationPassword: string,
  ) {
    this.auth = `Basic ${Buffer.from(`${username}:${applicationPassword.replace(/\s+/g, "")}`).toString("base64")}`;
  }

  private url(path: string, params?: Record<string, string | number>) {
    const u = new URL(`${this.baseUrl.replace(/\/$/, "")}/wp-json${path}`);
    for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, String(v));
    return u.toString();
  }

  private call<T>(
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: unknown,
    params?: Record<string, string | number>,
  ) {
    return requestJson<T>(this.url(path, params), {
      method,
      headers: { Authorization: this.auth },
      body,
      timeoutMs: 60_000,
      retries: method === "GET" ? 2 : 0,
      errorMessage: wcError,
    });
  }

  private async listAll<T>(path: string, params: Record<string, string | number> = {}): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= 50; page++) {
      const { data, headers } = await this.call<T[]>("GET", path, undefined, { per_page: 100, page, ...params });
      out.push(...data);
      const totalPages = Number(headers.get("x-wp-totalpages") ?? "1");
      if (page >= totalPages || data.length < 100) break;
    }
    return out;
  }

  async listCategories(): Promise<CatalogCategory[]> {
    const terms = await this.listAll<WcTerm>("/wc/v3/products/categories", { hide_empty: "false" });
    return terms.map((t) => ({ id: t.id, name: t.name, slug: t.slug, parent: t.parent ?? 0, count: t.count ?? 0 }));
  }

  async searchProducts(query: string): Promise<CatalogProduct[]> {
    const { data } = await this.call<WcProduct[]>("GET", "/wc/v3/products", undefined, {
      search: query,
      status: "any",
      per_page: 50,
      _fields: LIST_FIELDS,
    });
    return data.map(toCatalog);
  }

  async findBySku(sku: string): Promise<CatalogProduct | null> {
    const { data } = await this.call<WcProduct[]>("GET", "/wc/v3/products", undefined, {
      sku,
      status: "any",
      _fields: LIST_FIELDS,
    });
    const exact = data.find((p) => p.sku?.toUpperCase() === sku.toUpperCase());
    return exact ? toCatalog(exact) : null;
  }

  async findByGtin(gtin: string): Promise<CatalogProduct | null> {
    const digits = gtin.replace(/\D/g, "");
    const { data } = await this.call<WcProduct[]>("GET", "/wc/v3/products", undefined, {
      global_unique_id: digits,
      status: "any",
      _fields: LIST_FIELDS,
    });
    const exact = data.find((p) => (p.global_unique_id ?? "").replace(/\D/g, "") === digits);
    return exact ? toCatalog(exact) : null;
  }

  async getProduct(id: number): Promise<ProductDetail | null> {
    try {
      const { data } = await this.call<WcProduct>("GET", `/wc/v3/products/${id}`, undefined, {
        _fields: DETAIL_FIELDS,
      });
      return toDetail(data);
    } catch (error) {
      // WooCommerce answers 400 woocommerce_rest_product_invalid_id for unknown ids.
      if (error instanceof HttpError && (error.status === 404 || error.status === 400)) return null;
      throw error;
    }
  }

  async findBrand(name: string, create: boolean): Promise<number | null> {
    const key = (v: string) => fold(v).replace(/[^a-z0-9]+/g, "");
    const brands = await this.listAll<WcTerm>("/wc/v3/products/brands", { hide_empty: "false" });
    const found = brands.find((b) => key(b.name) === key(name));
    if (found) return found.id;
    if (!create) return null;
    try {
      const { data } = await this.call<WcTerm>("POST", "/wc/v3/products/brands", { name });
      return data.id;
    } catch (error) {
      const body = (error as HttpError).body as { code?: string; data?: { resource_id?: number } } | null;
      if (body?.code === "term_exists" && body.data?.resource_id) return body.data.resource_id;
      throw error;
    }
  }

  async uploadImage(file: { data: Buffer; fileName: string; mimeType: string }) {
    const { data } = await requestJson<{ id: number; source_url: string }>(this.url("/wp/v2/media"), {
      method: "POST",
      headers: {
        Authorization: this.auth,
        "Content-Type": file.mimeType,
        "Content-Disposition": `attachment; filename="${file.fileName.replace(/[^a-z0-9._-]/gi, "")}"`,
      },
      rawBody: new Uint8Array(file.data),
      timeoutMs: 120_000,
      retries: 0,
      errorMessage: wcError,
    });
    return { id: data.id, url: data.source_url };
  }

  async updateMedia(mediaId: number, meta: { alt?: string; title?: string; parent?: number }) {
    const body: Record<string, unknown> = {};
    if (meta.alt !== undefined) body.alt_text = meta.alt;
    if (meta.title !== undefined) body.title = meta.title;
    if (meta.parent !== undefined) body.post = meta.parent;
    await requestJson(this.url(`/wp/v2/media/${mediaId}`), {
      method: "POST",
      headers: { Authorization: this.auth },
      body,
      timeoutMs: 30_000,
      retries: 2,
      errorMessage: wcError,
    });
  }

  async mediaExists(mediaId: number): Promise<boolean> {
    try {
      await this.call("GET", `/wp/v2/media/${mediaId}`, undefined, { _fields: "id", context: "edit" });
      return true;
    } catch (error) {
      if (error instanceof HttpError && (error.status === 404 || error.status === 410)) return false;
      throw error;
    }
  }

  async createProduct(payload: ProductPayload): Promise<ProductDetail> {
    const { data } = await this.call<WcProduct>(
      "POST",
      "/wc/v3/products",
      { type: "simple", ...payload },
      { _fields: DETAIL_FIELDS },
    );
    return toDetail(data);
  }

  async updateProduct(id: number, payload: Partial<ProductPayload>): Promise<ProductDetail> {
    const { data } = await this.call<WcProduct>("PUT", `/wc/v3/products/${id}`, payload, { _fields: DETAIL_FIELDS });
    return toDetail(data);
  }
}
