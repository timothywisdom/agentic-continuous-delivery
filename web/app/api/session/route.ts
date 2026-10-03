import { NextResponse } from "next/server";
import { CSRF_COOKIE } from "../../../../dist/ui/security.js";
import { csrfCookieHeader, jsonHeaders, mintCsrfToken, repoRoot, setRepoRoot } from "../../../lib/session";

export const runtime = "nodejs";

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function GET(request: Request) {
  const existing = cookieValue(request.headers.get("cookie"), CSRF_COOKIE);
  const token = existing ?? mintCsrfToken();
  const headers = jsonHeaders();
  if (!existing) headers.set("set-cookie", csrfCookieHeader(token));
  return new NextResponse(
    JSON.stringify({
      token,
      repoRoot: repoRoot(),
      bind: "127.0.0.1",
    }),
    { status: 200, headers },
  );
}

export async function POST(request: Request) {
  let body: { repoRoot?: unknown };
  try {
    body = (await request.json()) as { repoRoot?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.repoRoot !== "string") {
    return NextResponse.json({ error: "repoRoot string required" }, { status: 400 });
  }
  try {
    const next = setRepoRoot(body.repoRoot);
    return new NextResponse(JSON.stringify({ repoRoot: next, bind: "127.0.0.1" }), {
      status: 200,
      headers: jsonHeaders(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
