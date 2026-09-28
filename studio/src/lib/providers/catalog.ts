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

export type ProductPayload = {
  name: string;
  slug?: string;
  status?: "publish" | "pending" | "draft";
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
  attributes?: Array<{
    name: string;
    options: string[];
    visible: boolean;
    variation: boolean;
  }>;
  images?: Array<{ id: number; alt?: string }>;
  meta_data?: Array<{ key: string; value: string }>;
};

export type SavedProduct = CatalogProduct & { hasPrice: boolean };

export interface CatalogProvider {
  readonly name: string;
  /** Public base URL of the store (used to build admin links). */
  readonly baseUrl: string;
  listCategories(): Promise<CatalogCategory[]>;
  searchProducts(query: string): Promise<CatalogProduct[]>;
  findBySku(sku: string): Promise<CatalogProduct | null>;
  getProduct(id: number): Promise<SavedProduct | null>;
  ensureBrand(name: string): Promise<number>;
  uploadImage(file: {
    data: Buffer;
    fileName: string;
    mimeType: string;
    alt: string;
    title: string;
  }): Promise<{ id: number; url: string }>;
  attachMedia(mediaId: number, productId: number): Promise<void>;
  createProduct(payload: ProductPayload): Promise<SavedProduct>;
  updateProduct(id: number, payload: Partial<ProductPayload>): Promise<SavedProduct>;
}
