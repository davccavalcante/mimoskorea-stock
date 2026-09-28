import { reconcile } from "@/lib/jobs/runner";
import { getJob } from "@/lib/jobs/store";
import { toView } from "@/lib/jobs/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<"/api/jobs/[id]">) {
  const { id } = await context.params;
  const job = await getJob(id).catch(() => null);
  if (!job) return Response.json({ error: "Cadastro não encontrado" }, { status: 404 });
  return Response.json(toView(await reconcile(job)), {
    headers: { "Cache-Control": "no-store" },
  });
}
