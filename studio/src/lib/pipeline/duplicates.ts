import "server-only";
import type { CatalogProvider } from "@/lib/providers/catalog";
import { compareProducts, MATCH_THRESHOLD, POSSIBLE_THRESHOLD } from "@/lib/text/similarity";
import type { CatalogProduct, DuplicateCandidate, DuplicateCheck, Identity, ProductDraft } from "@/lib/types";

// =============================================================================
// Duplicate guard
// =============================================================================
// Before anything is created, look for the same item in the store (any status:
// published, draft, pending, private). The audit showed that restocking by
// re-creating listings is the root cause of the catalogue mess, so a confident
// match forces the "update existing product" path.
//
// The check FAILS CLOSED: if the store cannot be queried, the error propagates
// and nothing can be synced, instead of wrongly reporting "new product".

const TIER_RANK: Record<DuplicateCandidate["tier"], number> = { gtin: 0, sku: 1, name: 2 };

export function rankCandidates(candidates: DuplicateCandidate[]): DuplicateCandidate[] {
  return [...candidates].sort(
    (a, b) =>
      b.score - a.score ||
      TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
      Number(b.status === "publish") - Number(a.status === "publish") ||
      a.id - b.id,
  );
}

export async function checkDuplicates(args: {
  catalog: CatalogProvider;
  identity: Identity;
  draft: Pick<ProductDraft, "title" | "sku" | "gtin" | "brand">;
  /** The name the operator typed: old listings were often created with the same words. */
  typedName?: string;
}): Promise<DuplicateCheck> {
  const { catalog, identity, draft, typedName } = args;
  const found = new Map<number, { product: CatalogProduct; tier: DuplicateCandidate["tier"] }>();
  const add = (p: CatalogProduct | null, tier: DuplicateCandidate["tier"]) => {
    if (!p) return;
    const prev = found.get(p.id);
    if (!prev || TIER_RANK[tier] < TIER_RANK[prev.tier]) found.set(p.id, { product: p, tier });
  };

  add(await catalog.findBySku(draft.sku), "sku");
  if (draft.gtin) add(await catalog.findByGtin(draft.gtin), "gtin");

  const queries = new Set(
    [
      [identity.line, identity.variant].filter(Boolean).join(" "),
      [identity.brand, identity.line].filter(Boolean).join(" "),
      [identity.productType, identity.variant].filter(Boolean).join(" "),
      [identity.productType, identity.line].filter(Boolean).join(" "),
      typedName?.slice(0, 80) ?? "",
    ]
      .map((q) => q.trim())
      .filter((q) => q.length >= 3),
  );
  for (const q of queries) {
    for (const p of await catalog.searchProducts(q)) add(p, "name");
  }

  const candidates = rankCandidates(
    [...found.values()]
      .filter(({ product }) => product.status !== "trash")
      .map(({ product, tier }) => {
        const compare = (title: string) =>
          compareProducts(
            {
              title,
              brand: draft.brand ?? identity.brand,
              variant: identity.variant,
              netContent: identity.netContent,
              gtin: draft.gtin,
              sku: draft.sku,
            },
            product,
          );
        const byTitle = compare(draft.title);
        const byTyped = typedName ? compare(typedName) : null;
        const { score, reasons } = byTyped && byTyped.score > byTitle.score ? byTyped : byTitle;
        return { ...product, score, reasons, tier };
      })
      .filter((c) => c.score >= POSSIBLE_THRESHOLD),
  ).slice(0, 6);

  const verdict = candidates[0]?.score >= MATCH_THRESHOLD ? "match" : candidates.length ? "possible" : "none";
  return { verdict, candidates };
}
