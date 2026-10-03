import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  gateUiRequest,
} from "../dist/ui/security.js";

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const bootstrap =
    request.method === "GET" && pathname === "/api/session";

  const gate = gateUiRequest({
    method: request.method,
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    cookieToken: cookieValue(request.headers.get("cookie"), CSRF_COOKIE),
    headerToken: request.headers.get(CSRF_HEADER),
    bootstrap,
    headers: request.headers,
  });

  if (!gate.ok) {
    return NextResponse.json({ error: gate.reason }, { status: gate.status });
  }

  const res = NextResponse.next();
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}

export const config = {
  matcher: "/api/:path*",
};
