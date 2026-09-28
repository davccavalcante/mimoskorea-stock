import { MATCH_THRESHOLD } from "@/lib/text/similarity";
import type { CatalogProduct, DuplicateCandidate, DuplicateCheck, ProductDraft } from "@/lib/types";

/** Candidates the operator may update: all confident matches when the verdict is "match", else every candidate. */
export function updatableCandidates(check: DuplicateCheck): DuplicateCandidate[] {
  return check.verdict === "match" ? check.candidates.filter((c) => c.score >= MATCH_THRESHOLD) : check.candidates;
}

// =============================================================================
// Sync plan (pure, shared by the server and the confirmation dialog)
// =============================================================================
// The operator reads exactly what the server will do. Owner rules:
// - new products have no price, so they wait for approval (pending/draft);
// - a live product is never overwritten with an incomplete listing: only its
//   stock is updated and the new text waits for the owner;
// - nothing is ever published automatically from draft or private;
// - products in the trash are never touched.

export type SyncStatus = "publish" | "pending" | "draft" | "private";

export type SyncSettingsLike = {
  statusWhenComplete: "publish" | "pending" | "draft";
  statusWhenIncomplete: "pending" | "draft";
};

export type SyncPlan =
  | { ok: false; reason: string }
  | {
      ok: true;
      mode: "create" | "update";
      targetId: number | null;
      status: SyncStatus;
      contentUpdated: boolean;
      lines: string[];
    };

const STATUS_WORDS: Record<string, string> = {
  publish: "publicado",
  pending: "aguardando aprovação",
  draft: "rascunho",
  private: "privado",
};

export function planCreate(draft: Pick<ProductDraft, "images">, stock: number, settings: SyncSettingsLike): SyncPlan {
  return {
    ok: true,
    mode: "create",
    targetId: null,
    status: settings.statusWhenIncomplete,
    contentUpdated: true,
    lines: [
      "Criar um produto novo na loja.",
      `Estoque inicial: ${stock} unidades.`,
      `${draft.images.length} foto(s) em WebP serão enviadas para a biblioteca de mídia.`,
      "O produto fica aguardando preço e aprovação do administrador antes de aparecer para os clientes.",
    ],
  };
}

export function planUpdate(
  draft: Pick<ProductDraft, "complete" | "images">,
  target: Pick<CatalogProduct, "id" | "name" | "status" | "stockQuantity" | "hasPrice">,
  stock: number,
  settings: SyncSettingsLike,
): SyncPlan {
  if (target.status === "trash") {
    return {
      ok: false,
      reason: `O produto ID ${target.id} está na lixeira do WordPress. Restaure-o antes de atualizar.`,
    };
  }
  const live = target.status === "publish";
  const contentUpdated = draft.complete || !live;
  let status: SyncStatus = (
    ["publish", "pending", "draft", "private"].includes(target.status) ? target.status : "pending"
  ) as SyncStatus;
  if (target.status === "pending" && draft.complete && target.hasPrice) status = settings.statusWhenComplete;

  const lines = [
    `Atualizar o produto ID ${target.id} (${target.name}).`,
    `Estoque passa de ${target.stockQuantity ?? 0} para ${stock} unidades.`,
  ];
  if (contentUpdated) {
    lines.push(
      `Título, descrições, informações e ${draft.images.length} foto(s) serão substituídos pelo novo conteúdo.`,
    );
    lines.push("O endereço (link) e o SKU do produto na loja não mudam.");
  } else {
    lines.push("Como faltam informações obrigatórias, só o estoque será atualizado.");
    lines.push("O texto novo fica guardado no histórico para o administrador revisar.");
  }
  lines.push(`Situação na loja depois: ${STATUS_WORDS[status] ?? status}.`);
  return { ok: true, mode: "update", targetId: target.id, status, contentUpdated, lines };
}
