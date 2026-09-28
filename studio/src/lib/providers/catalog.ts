import "server-only";
import type { CatalogProduct } from "@/lib/types";

// =============================================================================
// Catalog (store) provider contract
// =============================================================================

export type CatalogCategory = {
  id: number;
  name: string;
  slug: string;
  parent: number;
  count: number;
};

export type ProductAttribute = {
  id?: number;
  name: string;
  options: string[];
  visible: boolean;
  variation: boolean;
};

export type ProductPayload = {
  name: string;
  slug?: string;
  status?: "publish" | "pending" | "draft" | "private";
  description: string;
  short_description: string;
  sku?: string;
  global_unique_id?: string;
  manage_stock: boolean;
  stock_quantity: number;
  weight?: string;
  dimensions?: { length: string; width: string; height: string };
  categories?: Array<{ id: number }>;
  brands?: Array<{ id: number }>;
  attributes?: ProductAttribute[];
  images?: Array<{ id: number; alt?: string }>;
  meta_data?: Array<{ key: string; value: string }>;
};

/** Full view of one product, used before an update so owner data is merged, not replaced. */
export type ProductDetail = CatalogProduct & {
  type: string;
  manageStock: boolean;
  weight: string;
  dimensions: { length: string; width: string; height: string };
  categoryIds: number[];
  brandIds: number[];
  attributes: ProductAttribute[];
  /** Job id stored by a previous studio sync (idempotent recovery). */
  studioJob: string | null;
};

export interface CatalogProvider {
  readonly name: string;
  /** Public base URL of the store (used to build admin links). */
  readonly baseUrl: string;
  listCategories(): Promise<CatalogCategory[]>;
  /** Name search in every status (publish, draft, pending, private). */
  searchProducts(query: string): Promise<CatalogProduct[]>;
  findBySku(sku: string): Promise<CatalogProduct | null>;
  findByGtin(gtin: string): Promise<CatalogProduct | null>;
  /** null only when the store answers "not found"; other errors are thrown. */
  getProduct(id: number): Promise<ProductDetail | null>;
  /** Existing brand id, or a new term when `create` is true. */
  findBrand(name: string, create: boolean): Promise<number | null>;
  uploadImage(file: { data: Buffer; fileName: string; mimeType: string }): Promise<{ id: number; url: string }>;
  /** Best effort: alt text, title and parent product of an uploaded image. */
  updateMedia(mediaId: number, meta: { alt?: string; title?: string; parent?: number }): Promise<void>;
  mediaExists(mediaId: number): Promise<boolean>;
  createProduct(payload: ProductPayload): Promise<ProductDetail>;
  updateProduct(id: number, payload: Partial<ProductPayload>): Promise<ProductDetail>;
}
