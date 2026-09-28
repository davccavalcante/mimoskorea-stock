import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

// =============================================================================
// Optional HTTP Basic protection
// =============================================================================
// There is no login screen by design. If STUDIO_BASIC_AUTH="user:password" is
// set, the browser asks for those credentials once. Leave it empty only when
// the app runs on a trusted machine or private network.

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function proxy(request: NextRequest) {
  const expected = process.env.STUDIO_BASIC_AUTH;
  if (!expected) return NextResponse.next();

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const given = Buffer.from(header.slice(6), "base64").toString("utf8");
    if (safeEqual(given, expected)) return NextResponse.next();
  }
  return new NextResponse("Autenticação necessária", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Mimos Catalog Studio", charset="UTF-8"',
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
