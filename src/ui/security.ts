/** Loopback-only Host / Origin checks (CSRF + DNS rebinding). */

export const CSRF_COOKIE = "acd_csrf";
export const CSRF_HEADER = "x-acd-token";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function parseHostHeader(
  host: string | null | undefined,
): { hostname: string; port: string } | null {
  if (!host) return null;
  const first = host.split(",")[0]?.trim() ?? "";
  if (!first) return null;
  const idx = first.lastIndexOf(":");
  if (idx > 0 && /^\d+$/.test(first.slice(idx + 1))) {
    return {
      hostname: first.slice(0, idx).toLowerCase(),
      port: first.slice(idx + 1),
    };
  }
  return { hostname: first.toLowerCase(), port: "" };
}

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

export function isAllowedHost(hostHeader: string | null | undefined): boolean {
  const parsed = parseHostHeader(hostHeader);
  return parsed !== null && isLoopbackHostname(parsed.hostname);
}

export function isAllowedOrigin(
  origin: string | null | undefined,
  hostHeader: string | null | undefined,
): boolean {
  if (!origin) return false;
  const host = parseHostHeader(hostHeader);
  if (!host || !isLoopbackHostname(host.hostname)) return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (!isLoopbackHostname(url.hostname)) return false;
    const originPort = url.port || (url.protocol === "https:" ? "443" : "80");
    const hostPort = host.port || "80";
    if (url.hostname !== host.hostname) return false;
    if (host.port && originPort !== hostPort) return false;
    return true;
  } catch {
    return false;
  }
}

export function forwardedHeadersPresent(headers: {
  get(name: string): string | null;
}): boolean {
  return Boolean(
    headers.get("x-forwarded-host") ||
      headers.get("x-forwarded-for") ||
      headers.get("x-forwarded-proto"),
  );
}

/** If a proxy header is present, it must still name loopback. */
export function forwardedHeadersSafe(headers: {
  get(name: string): string | null;
}): boolean {
  const xfh = headers.get("x-forwarded-host");
  if (xfh && !isAllowedHost(xfh)) return false;
  return true;
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

export type RequestGate =
  | { ok: true }
  | { ok: false; status: number; reason: string };

/**
 * @param bootstrap GET session mint — Host/loopback only, token not required.
 * @param mutating POST/PUT/PATCH/DELETE — Origin + CSRF token required.
 */
export function gateUiRequest(opts: {
  method: string;
  host: string | null;
  origin: string | null;
  cookieToken: string | null;
  headerToken: string | null;
  bootstrap?: boolean;
  headers?: { get(name: string): string | null };
}): RequestGate {
  if (opts.headers && !forwardedHeadersSafe(opts.headers)) {
    return {
      ok: false,
      status: 403,
      reason: "X-Forwarded-Host must be 127.0.0.1 or localhost.",
    };
  }
  if (!isAllowedHost(opts.host)) {
    return { ok: false, status: 403, reason: "Host must be 127.0.0.1 or localhost." };
  }
  if (opts.bootstrap) {
    return { ok: true };
  }
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(opts.method.toUpperCase());
  if (mutating || opts.origin) {
    if (!isAllowedOrigin(opts.origin, opts.host)) {
      return {
        ok: false,
        status: 403,
        reason: "Origin must match this loopback Host (CSRF).",
      };
    }
  }
  if (!opts.cookieToken || !opts.headerToken) {
    return { ok: false, status: 403, reason: "CSRF token missing." };
  }
  if (!timingSafeEqual(opts.cookieToken, opts.headerToken)) {
    return { ok: false, status: 403, reason: "CSRF token mismatch." };
  }
  return { ok: true };
}
