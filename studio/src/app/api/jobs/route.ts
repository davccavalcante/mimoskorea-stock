import { after } from "next/server";
import { runPipeline } from "@/lib/jobs/runner";
import { createJob, listJobs } from "@/lib/jobs/store";
import { toSummary } from "@/lib/jobs/view";
import { JobInputSchema } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start a new registration. The pipeline runs in the background after the response. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = JobInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: parsed.error.issues[0]?.message ?? "Dados inválidos",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }
  const job = await createJob(parsed.data);
  after(() => runPipeline(job.id));
  return Response.json({ id: job.id }, { status: 201 });
}

export async function GET() {
  const jobs = await listJobs(200);
  return Response.json({ jobs: jobs.map(toSummary) });
}
