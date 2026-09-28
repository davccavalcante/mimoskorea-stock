import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

// =============================================================================
// Request guard (runs before every page and API route)
// =============================================================================
// There is no login screen by design, so the app protects itself in layers:
//   1. Host allowlist (STUDIO_ALLOWED_HOSTS): a page on another site cannot
//      reach the app through DNS rebinding, because its Host header is refused.
//   2. Same-origin writes: POST/PUT/DELETE must come from the app's own pages
//      (Sec-Fetch-Site or Origin), so another site open in the operator's
//      browser cannot start registrations or syncs (CSRF).
//   3. JSON only for API writes (a plain HTML form cannot send it).
//   4. Optional HTTP Basic password (STUDIO_BASIC_AUTH="user:password").

const DEFAULT_HOSTS = "localhost,127.0.0.1,[::1]";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** "Localhost:3000" -> "localhost", "[::1]:3000" -> "[::1]" */
export function hostName(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.replace(/:\d+$/, "");
}

export function allowedHosts(value = process.env.STUDIO_ALLOWED_HOSTS): Set<string> {
  return new Set(
    (value || DEFAULT_HOSTS)
      .split(",")
      .map((h) => hostName(h))
      .filter(Boolean),
  );
}

const refuse = (status: number, message: string) =>
  new NextResponse(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export function proxy(request: NextRequest) {
  // 1. Host allowlist ------------------------------------------------------------
  const host = request.headers.get("host") ?? "";
  if (!allowedHosts().has(hostName(host))) {
    return refuse(421, `Endereço não permitido: ${hostName(host) || "(vazio)"}. Adicione-o em STUDIO_ALLOWED_HOSTS.`);
  }

  // 2 and 3. Writes only from the app itself, as JSON ---------------------------
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const site = request.headers.get("sec-fetch-site");
    const origin = request.headers.get("origin");
    const sameOrigin = site ? site === "same-origin" : origin ? safeHost(origin) === hostName(host) : false;
    if (!sameOrigin) return refuse(403, "Pedido recusado: ele não veio da própria aplicação.");
    const type = request.headers.get("content-type") ?? "";
    const length = Number(request.headers.get("content-length") ?? "0");
    if (request.nextUrl.pathname.startsWith("/api/") && length > 0 && !type.includes("application/json")) {
      return refuse(415, "Envie os dados em JSON.");
    }
  }

  // 4. Optional password ------------------------------------------------------
  const expected = process.env.STUDIO_BASIC_AUTH;
  if (!expected) return NextResponse.next();
  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const given = Buffer.from(header.slice(6), "base64").toString("utf8");
    if (safeEqual(given, expected)) return NextResponse.next();
  }
  return new NextResponse("Autenticação necessária", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Mimos Catalog Studio", charset="UTF-8"' },
  });
}

function safeHost(origin: string): string | null {
  try {
    return hostName(new URL(origin).host);
  } catch {
    return null;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
