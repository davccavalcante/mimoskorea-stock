import "server-only";
import { requestJson } from "@/lib/net/http";
import { fold } from "@/lib/text/normalize";
import type { CatalogProduct } from "@/lib/types";
import type { CatalogCategory, CatalogProvider, ProductPayload, SavedProduct } from "./catalog";

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
  sku: string;
  global_unique_id?: string;
  status: string;
  stock_quantity: number | null;
  permalink: string;
  price: string;
  regular_price: string;
  brands?: Array<{ id: number; name: string }>;
};

type WcTerm = {
  id: number;
  name: string;
  slug: string;
  parent?: number;
  count?: number;
};

const wcError = (body: unknown) => {
  const b = body as { code?: string; message?: string } | null;
  return b?.message ? `${b.message}${b.code ? ` (${b.code})` : ""}` : undefined;
};

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
  };
}

const PRODUCT_FIELDS = "id,name,slug,sku,global_unique_id,status,stock_quantity,permalink,price,regular_price,brands";

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

  private async call<T>(
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: unknown,
    params?: Record<string, string | number>,
  ) {
    const { data, headers } = await requestJson<T>(this.url(path, params), {
      method,
      headers: { Authorization: this.auth },
      body,
      timeoutMs: 60_000,
      retries: method === "GET" ? 2 : 0,
      errorMessage: wcError,
    });
    return { data, headers };
  }

  private async listAll<T>(path: string, params: Record<string, string | number> = {}): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= 50; page++) {
      const { data, headers } = await this.call<T[]>("GET", path, undefined, {
        per_page: 100,
        page,
        ...params,
      });
      out.push(...data);
      const totalPages = Number(headers.get("x-wp-totalpages") ?? "1");
      if (page >= totalPages || data.length < 100) break;
    }
    return out;
  }

  async listCategories(): Promise<CatalogCategory[]> {
    const terms = await this.listAll<WcTerm>("/wc/v3/products/categories", {
      hide_empty: "false",
    });
    return terms.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      parent: t.parent ?? 0,
      count: t.count ?? 0,
    }));
  }

  async searchProducts(query: string): Promise<CatalogProduct[]> {
    const { data } = await this.call<WcProduct[]>("GET", "/wc/v3/products", undefined, {
      search: query,
      status: "any",
      per_page: 50,
      _fields: PRODUCT_FIELDS,
    });
    return data.map(toCatalog);
  }

  async findBySku(sku: string): Promise<CatalogProduct | null> {
    const { data } = await this.call<WcProduct[]>("GET", "/wc/v3/products", undefined, {
      sku,
      status: "any",
      _fields: PRODUCT_FIELDS,
    });
    const exact = data.find((p) => p.sku?.toUpperCase() === sku.toUpperCase());
    return exact ? toCatalog(exact) : null;
  }

  async getProduct(id: number): Promise<SavedProduct | null> {
    try {
      const { data } = await this.call<WcProduct>("GET", `/wc/v3/products/${id}`, undefined, {
        _fields: PRODUCT_FIELDS,
      });
      return {
        ...toCatalog(data),
        hasPrice: Boolean(data.regular_price || data.price),
      };
    } catch {
      return null;
    }
  }

  async ensureBrand(name: string): Promise<number> {
    const brands = await this.listAll<WcTerm>("/wc/v3/products/brands", {
      hide_empty: "false",
    });
    const wanted = fold(name).replace(/[^a-z0-9]+/g, "");
    const found = brands.find((b) => fold(b.name).replace(/[^a-z0-9]+/g, "") === wanted);
    if (found) return found.id;
    const { data } = await this.call<WcTerm>("POST", "/wc/v3/products/brands", {
      name,
    });
    return data.id;
  }

  async uploadImage(file: { data: Buffer; fileName: string; mimeType: string; alt: string; title: string }) {
    const { data } = await requestJson<{ id: number; source_url: string }>(this.url("/wp/v2/media"), {
      method: "POST",
      headers: {
        Authorization: this.auth,
        "Content-Type": file.mimeType,
        "Content-Disposition": `attachment; filename="${file.fileName.replace(/"/g, "")}"`,
      },
      rawBody: new Uint8Array(file.data),
      timeoutMs: 120_000,
      retries: 0,
      errorMessage: wcError,
    });
    await this.call("POST", `/wp/v2/media/${data.id}`, {
      alt_text: file.alt,
      title: file.title,
      caption: "",
    });
    return { id: data.id, url: data.source_url };
  }

  async attachMedia(mediaId: number, productId: number) {
    await this.call("POST", `/wp/v2/media/${mediaId}`, { post: productId });
  }

  async createProduct(payload: ProductPayload): Promise<SavedProduct> {
    const { data } = await this.call<WcProduct>("POST", "/wc/v3/products", {
      type: "simple",
      ...payload,
    });
    return {
      ...toCatalog(data),
      hasPrice: Boolean(data.regular_price || data.price),
    };
  }

  async updateProduct(id: number, payload: Partial<ProductPayload>): Promise<SavedProduct> {
    const { data } = await this.call<WcProduct>("PUT", `/wc/v3/products/${id}`, payload);
    return {
      ...toCatalog(data),
      hasPrice: Boolean(data.regular_price || data.price),
    };
  }
}
