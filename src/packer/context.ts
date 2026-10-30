import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { Scenario } from "../spec/gherkin.js";

export interface RepoFile {
  path: string;
  content: string;
}

export interface ContextPack {
  intentSummary: string;
  feature: string;
  scenario: Scenario;
  priorSummary: string;
  files: RepoFile[];
  /** Paths that exist but were not inlined, usually because of the size budget. */
  omitted: string[];
}

/** Directories that are not product source. */
const SKIP_DIRS = new Set([
  ".git",
  ".acd",
  "node_modules",
  "dist",
  ".next",
  "coverage",
]);

const SKIP_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const BINARY_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "mp4",
  "zip",
  "gz",
  "pdf",
  "wasm",
]);

/** A single source file above this size is listed, not inlined. */
export const REPO_FILE_CHAR_CAP = 200_000;
/** Stop inlining once the packed text reaches this size. Remaining paths are listed. */
export const REPO_PACK_CHAR_BUDGET = 500_000;

export function summarizeIntent(intent: string): string {
  return intent
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("<!--"))
    .slice(0, 8)
    .join(" ");
}

/**
 * Repo-relative path the implementer is allowed to read or write.
 * Rejects escapes, `.git`, and `.acd`.
 */
export function resolveRepoPath(repoRoot: string, rel: string): string | null {
  const cleaned = rel.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (!cleaned || cleaned.startsWith("/") || cleaned.split("/").includes("..")) {
    return null;
  }
  const root = resolve(repoRoot);
  const full = resolve(root, cleaned);
  if (full !== root && !full.startsWith(root + sep)) return null;
  const top = cleaned.split("/")[0];
  if (top === ".git" || top === ".acd") return null;
  return cleaned;
}

/** First path token in a CONTEXT_NEEDED value, ignoring the skill's prefix. */
export function contextNeededPath(value: string): string | null {
  const stripped = value.replace(/^\s*CONTEXT_NEEDED:\s*/i, "").trim();
  const path = stripped.split(/\s+-\s+|\s+—\s+/)[0]?.trim() ?? "";
  if (!path || /\s/.test(path)) return null;
  return path;
}

export function packContext(
  repoRoot: string,
  workDir: string,
  scenario: Scenario,
  forceFiles: string[] = [],
): ContextPack {
  const intent = readFileSync(join(workDir, "intent.md"), "utf8");
  const feature = readFileSync(join(workDir, "feature.md"), "utf8");
  const prior = latestSessionSummary(workDir);
  const { files, omitted } = collectRepoFiles(repoRoot, forceFiles);
  return {
    intentSummary: summarizeIntent(intent),
    feature,
    scenario,
    priorSummary: prior,
    files,
    omitted,
  };
}

export function collectRepoFiles(
  repoRoot: string,
  forceFiles: string[] = [],
): { files: RepoFile[]; omitted: string[] } {
  const paths = walkRepo(repoRoot).sort();
  const forced = new Set(
    forceFiles
      .map((rel) => resolveRepoPath(repoRoot, rel))
      .filter((rel): rel is string => rel != null && existsSync(join(repoRoot, rel))),
  );
  const files: RepoFile[] = [];
  const omitted: string[] = [];
  let used = 0;

  const consider = (rel: string, force: boolean) => {
    const loaded = readRepoText(repoRoot, rel);
    if (!loaded) {
      omitted.push(rel);
      return;
    }
    if (!force && used + loaded.length > REPO_PACK_CHAR_BUDGET) {
      omitted.push(rel);
      return;
    }
    files.push({ path: rel, content: loaded });
    used += loaded.length;
  };

  for (const rel of [...forced].sort()) consider(rel, true);
  for (const rel of paths) {
    if (forced.has(rel)) continue;
    consider(rel, false);
  }
  return { files, omitted };
}

function walkRepo(repoRoot: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        visit(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile() || SKIP_FILES.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      const rel = relative(repoRoot, abs).split(sep).join("/");
      if (resolveRepoPath(repoRoot, rel)) out.push(rel);
    }
  };
  visit(repoRoot);
  return out;
}

function readRepoText(repoRoot: string, rel: string): string | null {
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  if (BINARY_EXT.has(ext)) return null;
  const abs = join(repoRoot, rel);
  let size = 0;
  try {
    size = statSync(abs).size;
  } catch {
    return null;
  }
  if (size > REPO_FILE_CHAR_CAP) return null;
  const buf = readFileSync(abs);
  if (buf.includes(0)) return null;
  return buf.toString("utf8");
}

function latestSessionSummary(workDir: string): string {
  const sessions = join(workDir, "sessions");
  if (!existsSync(sessions)) return "";
  const names = readdirSync(sessions)
    .filter((n) => n.endsWith("-summary.md"))
    .sort();
  const last = names.at(-1);
  if (!last) return "";
  return readFileSync(join(sessions, last), "utf8");
}
