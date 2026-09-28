import { env } from "@/lib/env";
import type { SyncSettingsLike } from "@/lib/pipeline/plan";
import type { Job } from "@/lib/types";

// =============================================================================
// Public job view (what the browser receives)
// =============================================================================
// Source page texts can be hundreds of KB; the UI only needs their titles and
// links. Everything else is safe to expose to the operator.

export type JobView = Omit<Job, "sources"> & {
  sources: Array<{
    id: string;
    url: string;
    title: string;
    domain: string;
    origin: string;
    chars: number;
  }>;
  /** Store status rules, so the confirmation dialog shows exactly what the server will do. */
  syncSettings: SyncSettingsLike;
};

export function toView(job: Job): JobView {
  const e = env();
  return {
    ...job,
    syncSettings: { statusWhenComplete: e.WC_STATUS_WHEN_COMPLETE, statusWhenIncomplete: e.WC_STATUS_WHEN_INCOMPLETE },
    sources: job.sources.map((s) => ({
      id: s.id,
      url: s.url,
      title: s.title,
      domain: s.domain,
      origin: s.origin,
      chars: s.text.length,
    })),
  };
}

export type JobSummary = {
  id: string;
  createdAt: string;
  productName: string;
  title: string | null;
  status: Job["status"];
  stockQuantity: number;
  syncMode: "create" | "update" | null;
  productId: number | null;
  adminUrl: string | null;
  complete: boolean | null;
  supersededBy: string | null;
};

export function toSummary(job: Job): JobSummary {
  return {
    id: job.id,
    createdAt: job.createdAt,
    productName: job.input.productName,
    title: job.draft?.title ?? null,
    status: job.status,
    stockQuantity: job.input.stockQuantity,
    syncMode: job.sync?.mode ?? null,
    productId: job.sync?.productId ?? null,
    adminUrl: job.sync?.adminUrl ?? null,
    complete: job.draft?.complete ?? null,
    supersededBy: job.supersededBy,
  };
}
