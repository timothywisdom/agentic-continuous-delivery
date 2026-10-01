import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CSRF_COOKIE } from "../../src/ui/security";
import { validateRepoRoot } from "../../src/ui/repo";

const g = globalThis as typeof globalThis & { __acdRepoRoot?: string };

export function mintCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function csrfCookieHeader(token: string): string {
  return [
    `${CSRF_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=86400",
  ].join("; ");
}

export function jsonHeaders(extra?: Record<string, string>): Headers {
  return new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    ...extra,
  });
}

export function repoRoot(): string {
  return (
    g.__acdRepoRoot ||
    process.env.ACD_REPO_ROOT?.trim() ||
    process.cwd()
  );
}

export function setRepoRoot(input: string): string {
  const resolved = validateRepoRoot(input);
  g.__acdRepoRoot = resolved;
  process.env.ACD_REPO_ROOT = resolved;
  return resolved;
}

export function kitRoot(): string {
  const fromEnv = process.env.ACD_KIT_ROOT?.trim();
  if (fromEnv) return fromEnv;
  const cwd = process.cwd();
  const parent = join(cwd, "..");
  if (existsSync(join(parent, "bin", "acd.js"))) return parent;
  return cwd;
}
