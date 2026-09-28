import { after } from "next/server";
import { readiness } from "@/lib/env";
import { listJobsReconciled, runPipeline, takeStartSlot } from "@/lib/jobs/runner";
import { createJob } from "@/lib/jobs/store";
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

  // Refuse early when the configuration cannot work (nothing is spent, nothing is queued).
  let problems: string[];
  try {
    problems = readiness().problems;
  } catch (error) {
    problems = [error instanceof Error ? error.message : String(error)];
  }
  if (problems.length) {
    return Response.json(
      { error: `O sistema não está configurado: ${problems.join("; ")}. Avise o administrador.`, code: "config" },
      { status: 503 },
    );
  }
  if (!takeStartSlot()) {
    return Response.json(
      { error: "Muitos cadastros iniciados em pouco tempo. Aguarde um minuto e tente de novo.", code: "quota" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const job = await createJob(parsed.data);
  after(() => runPipeline(job.id));
  return Response.json({ id: job.id }, { status: 201 });
}

export async function GET() {
  const jobs = await listJobsReconciled(200);
  return Response.json({ jobs: jobs.map(toSummary) }, { headers: { "Cache-Control": "no-store" } });
}
