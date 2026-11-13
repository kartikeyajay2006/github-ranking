import { NextResponse, type NextRequest } from "next/server";

/**
 * When ADMIN_PASSWORD is set (any public deployment), every page and API requires HTTP Basic auth.
 * The user name is ADMIN_USER (default "admin"). /api/health stays open for uptime checks.
 */
export function proxy(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return NextResponse.next();
  const user = process.env.ADMIN_USER || "admin";
  const header = request.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = atob(encoded);
    const sep = decoded.indexOf(":");
    if (safeEqual(decoded.slice(0, sep), user) && safeEqual(decoded.slice(sep + 1), password)) return NextResponse.next();
  }
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="github-ranking", charset="UTF-8"', "Cache-Control": "no-store" },
  });
}

/** Comparison whose duration doesn't depend on where the strings differ. */
function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico|api/health).*)"],
};
