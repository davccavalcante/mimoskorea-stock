import { z } from "zod";
import { runSync, SyncFailedError } from "@/lib/jobs/runner";
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
    if (error instanceof SyncRejectedError)
      return Response.json({ error: error.message, code: "store" }, { status: 409 });
    if (error instanceof SyncFailedError) {
      return Response.json({ error: error.message, code: error.classified.code }, { status: 502 });
    }
    return Response.json({ error: "Erro inesperado ao sincronizar.", code: "unknown" }, { status: 500 });
  }
}
