import { describe, expect, it } from "vitest";
import { resolveDecision, SyncRejectedError } from "@/lib/pipeline/sync";
import type { DuplicateCheck, Job } from "@/lib/types";

// =============================================================================
// Create vs update rules (the duplicate guard at sync time)
// =============================================================================

const candidate = (id: number, score: number) => ({
  id,
  name: `Produto ${id}`,
  slug: `p-${id}`,
  sku: "",
  gtin: "",
  status: "publish",
  stockQuantity: 0,
  permalink: "",
  brands: [],
  score,
  reasons: [],
});

const job = (duplicates: DuplicateCheck | null) => ({ duplicates }) as unknown as Job;

describe("resolveDecision", () => {
  it("match: creating is forbidden, only the matched product can be updated", () => {
    const j = job({ verdict: "match", candidates: [candidate(235, 0.95), candidate(954, 0.9)] });
    expect(() => resolveDecision(j, { mode: "create" })).toThrow(SyncRejectedError);
    expect(() => resolveDecision(j, { mode: "update", productId: 954 })).toThrow(SyncRejectedError);
    expect(resolveDecision(j, { mode: "update", productId: 235 })).toEqual({ mode: "update", productId: 235 });
  });

  it("possible: the operator may create or update one of the suggested products", () => {
    const j = job({ verdict: "possible", candidates: [candidate(10, 0.6), candidate(11, 0.58)] });
    expect(resolveDecision(j, { mode: "create" })).toEqual({ mode: "create" });
    expect(resolveDecision(j, { mode: "update", productId: 11 })).toEqual({ mode: "update", productId: 11 });
    expect(() => resolveDecision(j, { mode: "update", productId: 99 })).toThrow(SyncRejectedError);
  });

  it("none: updating an arbitrary product id is rejected", () => {
    const j = job({ verdict: "none", candidates: [] });
    expect(resolveDecision(j, { mode: "create" })).toEqual({ mode: "create" });
    expect(() => resolveDecision(j, { mode: "update", productId: 1 })).toThrow(SyncRejectedError);
  });
});
