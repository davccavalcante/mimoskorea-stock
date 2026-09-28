import { after } from "next/server";
import { JobConflictError, retryJob, runPipeline, takeStartSlot } from "@/lib/jobs/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Gerar de novo": a new job from the same input. The previous one stays in
 * the history marked as replaced. A double click returns the same new job.
 */
export async function POST(_request: Request, context: RouteContext<"/api/jobs/[id]/retry">) {
  const { id } = await context.params;
  try {
    if (!takeStartSlot()) {
      return Response.json(
        { error: "Muitos cadastros iniciados em pouco tempo. Aguarde um minuto e tente de novo.", code: "quota" },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    const result = await retryJob(id);
    if (!result) return Response.json({ error: "Cadastro não encontrado" }, { status: 404 });
    if (result.created) after(() => runPipeline(result.id));
    return Response.json({ id: result.id }, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof JobConflictError) return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
