import { after } from "next/server";
import { runPipeline } from "@/lib/jobs/runner";
import { createJob, getJob } from "@/lib/jobs/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Generate again from the same input (a new job keeps the previous one in the history). */
export async function POST(_request: Request, context: RouteContext<"/api/jobs/[id]/retry">) {
  const { id } = await context.params;
  const previous = await getJob(id).catch(() => null);
  if (!previous) return Response.json({ error: "Cadastro não encontrado" }, { status: 404 });
  const job = await createJob(previous.input);
  after(() => runPipeline(job.id));
  return Response.json({ id: job.id }, { status: 201 });
}
