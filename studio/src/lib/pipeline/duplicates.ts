import "server-only";
import type { CatalogProvider } from "@/lib/providers/catalog";
import { compareProducts, MATCH_THRESHOLD, POSSIBLE_THRESHOLD } from "@/lib/text/similarity";
import type { CatalogProduct, DuplicateCheck, Identity, ProductDraft } from "@/lib/types";

// =============================================================================
// Duplicate guard
// =============================================================================
// Before anything is created, look for the same item in the store (any status:
// published, draft, pending, private). The audit showed that restocking by
// re-creating listings is the root cause of the catalogue mess, so a confident
// match forces the "update existing product" path.

export async function checkDuplicates(args: {
  catalog: CatalogProvider;
  identity: Identity;
  draft: Pick<ProductDraft, "title" | "sku" | "gtin" | "brand">;
}): Promise<DuplicateCheck> {
  const { catalog, identity, draft } = args;
  const found = new Map<number, CatalogProduct>();

  const bySku = await catalog.findBySku(draft.sku).catch(() => null);
  if (bySku) found.set(bySku.id, bySku);

  const queries = new Set(
    [
      [identity.line, identity.variant].filter(Boolean).join(" "),
      [identity.brand, identity.line].filter(Boolean).join(" "),
      [identity.productType, identity.variant].filter(Boolean).join(" "),
      identity.gtin ?? "",
      draft.gtin ?? "",
    ]
      .map((q) => q.trim())
      .filter((q) => q.length >= 3),
  );
  for (const q of queries) {
    for (const p of await catalog.searchProducts(q).catch(() => [])) found.set(p.id, p);
  }

  const candidates = [...found.values()]
    .filter((p) => p.status !== "trash")
    .map((p) => {
      const { score, reasons } = compareProducts(
        {
          title: draft.title,
          brand: draft.brand ?? identity.brand,
          variant: identity.variant,
          netContent: identity.netContent,
          gtin: draft.gtin,
          sku: draft.sku,
        },
        p,
      );
      return { ...p, score, reasons };
    })
    .filter((c) => c.score >= POSSIBLE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const verdict = candidates[0]?.score >= MATCH_THRESHOLD ? "match" : candidates.length ? "possible" : "none";
  return { verdict, candidates };
}
