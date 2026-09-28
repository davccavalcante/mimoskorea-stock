import { discardJob, JobConflictError } from "@/lib/jobs/runner";
import { toView } from "@/lib/jobs/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Descartar": the registration is kept in the history but can no longer be synced. */
export async function POST(_request: Request, context: RouteContext<"/api/jobs/[id]/discard">) {
  const { id } = await context.params;
  try {
    const job = await discardJob(id);
    if (!job) return Response.json({ error: "Cadastro não encontrado" }, { status: 404 });
    return Response.json(toView(job));
  } catch (error) {
    if (error instanceof JobConflictError) return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
