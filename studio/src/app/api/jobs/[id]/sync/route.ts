import { z } from "zod";
import { runSync } from "@/lib/jobs/runner";
import { toView } from "@/lib/jobs/view";
import { SyncRejectedError } from "@/lib/pipeline/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("create") }),
  z.object({
    mode: z.literal("update"),
    productId: z.number().int().positive(),
  }),
]);

export async function POST(request: Request, context: RouteContext<"/api/jobs/[id]/sync">) {
  const { id } = await context.params;
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Escolha criar ou atualizar." }, { status: 400 });
  try {
    const job = await runSync(id, parsed.data);
    return Response.json(toView(job));
  } catch (error) {
    const status = error instanceof SyncRejectedError ? 409 : 502;
    const text = error instanceof Error ? error.message : String(error);
    return Response.json({ error: text }, { status });
  }
}
