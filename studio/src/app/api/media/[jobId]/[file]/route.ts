import { readFile } from "node:fs/promises";
import path from "node:path";
import { mediaDir } from "@/lib/jobs/store";

export const runtime = "nodejs";

/** Serve the processed WebP previews of a job. */
export async function GET(_request: Request, context: RouteContext<"/api/media/[jobId]/[file]">) {
  const { jobId, file } = await context.params;
  if (!/^[a-z0-9-]+\.webp$/.test(file)) return new Response("Not found", { status: 404 });
  try {
    const data = await readFile(path.join(mediaDir(jobId), file));
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
