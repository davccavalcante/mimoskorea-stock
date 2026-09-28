import { readiness } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(readiness());
  } catch (error) {
    return Response.json({ problems: [error instanceof Error ? error.message : String(error)] }, { status: 500 });
  }
}
