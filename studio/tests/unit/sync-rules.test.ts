import { describe, expect, it } from "vitest";
import { planCreate, planUpdate, updatableCandidates } from "@/lib/pipeline/plan";
import { mergeAttributes, resolveDecision, SyncRejectedError, storeChanged } from "@/lib/pipeline/sync";
import type { DuplicateCandidate, DuplicateCheck, Job } from "@/lib/types";

// =============================================================================
// Create vs update rules (the duplicate guard at sync time)
// =============================================================================

const candidate = (id: number, score: number, extra: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
  id,
  name: `Produto ${id}`,
  slug: `p-${id}`,
  sku: "",
  gtin: "",
  status: "publish",
  stockQuantity: 0,
  permalink: "",
  brands: [],
  hasPrice: true,
  score,
  reasons: [],
  tier: "name",
  ...extra,
});

const job = (duplicates: DuplicateCheck | null) => ({ duplicates }) as unknown as Job;
const settings = { statusWhenComplete: "publish", statusWhenIncomplete: "pending" } as const;

describe("resolveDecision", () => {
  it("match: creating is forbidden, only confident matches can be updated", () => {
    const j = job({ verdict: "match", candidates: [candidate(235, 0.95), candidate(954, 0.7)] });
    expect(() => resolveDecision(j, { mode: "create" })).toThrow(SyncRejectedError);
    expect(() => resolveDecision(j, { mode: "update", productId: 954 })).toThrow(SyncRejectedError);
    expect(resolveDecision(j, { mode: "update", productId: 235 })).toEqual({ mode: "update", productId: 235 });
  });

  it("match repeated in the store: the operator may pick any of the confident matches, never create", () => {
    const dup: DuplicateCheck = { verdict: "match", candidates: [candidate(235, 0.95), candidate(1021, 0.9)] };
    expect(updatableCandidates(dup).map((c) => c.id)).toEqual([235, 1021]);
    expect(resolveDecision(job(dup), { mode: "update", productId: 1021 })).toEqual({
      mode: "update",
      productId: 1021,
    });
    expect(() => resolveDecision(job(dup), { mode: "create" })).toThrow(/só pode ser atualizado/);
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

  it("fails closed when the duplicate check never finished", () => {
    expect(() => resolveDecision(job(null), { mode: "create" })).toThrow(SyncRejectedError);
  });
});

describe("storeChanged (re-check right before sync)", () => {
  const reviewed: DuplicateCheck = { verdict: "possible", candidates: [candidate(10, 0.6)] };

  it("blocks a create when an equal product appeared meanwhile", () => {
    const fresh: DuplicateCheck = { verdict: "match", candidates: [candidate(77, 0.97), candidate(10, 0.6)] };
    expect(storeChanged(reviewed, fresh, { mode: "create" })).toMatch(/produto igual/);
  });

  it("blocks a create when new similar products appeared", () => {
    const fresh: DuplicateCheck = { verdict: "possible", candidates: [candidate(10, 0.6), candidate(12, 0.56)] };
    expect(storeChanged(reviewed, fresh, { mode: "create" })).toMatch(/parecidos/);
  });

  it("blocks an update when the target vanished (trashed or deleted)", () => {
    const fresh: DuplicateCheck = { verdict: "none", candidates: [] };
    expect(storeChanged(reviewed, fresh, { mode: "update", productId: 10 })).toMatch(/ID 10/);
  });

  it("lets an unchanged store through", () => {
    expect(storeChanged(reviewed, reviewed, { mode: "create" })).toBeNull();
    expect(storeChanged(reviewed, reviewed, { mode: "update", productId: 10 })).toBeNull();
  });
});

describe("sync plan (shared by the server and the confirmation dialog)", () => {
  const draft = (complete: boolean) => ({ complete, images: [{}, {}] as never[] });

  it("new products always wait for price and approval", () => {
    const plan = planCreate(draft(true), 12, settings);
    expect(plan).toMatchObject({ ok: true, mode: "create", status: "pending", contentUpdated: true });
  });

  it("a live product is never overwritten by an incomplete listing: stock only", () => {
    const plan = planUpdate(draft(false), candidate(5, 1, { status: "publish" }), 9, settings);
    expect(plan).toMatchObject({ ok: true, status: "publish", contentUpdated: false });
    if (plan.ok) expect(plan.lines.join(" ")).toMatch(/só o estoque/);
  });

  it("never publishes a draft or private product automatically", () => {
    expect(planUpdate(draft(true), candidate(5, 1, { status: "draft" }), 1, settings)).toMatchObject({
      status: "draft",
      contentUpdated: true,
    });
    expect(planUpdate(draft(true), candidate(5, 1, { status: "private" }), 1, settings)).toMatchObject({
      status: "private",
    });
  });

  it("a pending product with price and a complete listing is promoted as configured", () => {
    expect(planUpdate(draft(true), candidate(5, 1, { status: "pending" }), 1, settings)).toMatchObject({
      status: "publish",
    });
    expect(planUpdate(draft(true), candidate(5, 1, { status: "pending", hasPrice: false }), 1, settings)).toMatchObject(
      { status: "pending" },
    );
  });

  it("refuses products in the trash", () => {
    expect(planUpdate(draft(true), candidate(5, 1, { status: "trash" }), 1, settings)).toMatchObject({ ok: false });
  });
});

describe("mergeAttributes", () => {
  it("keeps the owner's global and custom attributes and adds ours", () => {
    const existing = [
      { id: 3, name: "Cor", options: ["Rosa"], visible: true, variation: false },
      { name: "Observação da loja", options: ["Importado pela Mimos"], visible: true, variation: false },
      { name: "Teor alcoólico", options: ["16%"], visible: true, variation: false },
    ];
    const ours = [
      { name: "Teor alcoólico", options: ["12% vol."], visible: true, variation: false },
      { name: "País de origem", options: ["Coreia do Sul"], visible: true, variation: false },
    ];
    const merged = mergeAttributes(existing, ours);
    expect(merged.map((a) => a.name)).toEqual(["Cor", "Observação da loja", "Teor alcoólico", "País de origem"]);
    expect(merged.find((a) => a.name === "Teor alcoólico")?.options).toEqual(["12% vol."]);
    expect(merged.find((a) => a.name === "Cor")?.id).toBe(3);
  });
});
