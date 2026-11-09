import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AcdConfig } from "../types/config.js";
import { systemConstraintsCandidates } from "../paths.js";
import {
  formatAcceptanceLint,
  lintAcceptanceTests,
} from "../spec/acceptance-lint.js";
import { artifactExists, readArtifact } from "../work/store.js";

export interface MechanicalResult {
  name: string;
  ok: boolean;
  /** The command was not run. `ok` stays true so a skip cannot block review. */
  skipped?: boolean;
  detail?: string;
}

export interface ChangedSpan {
  path: string;
  /** New-file line numbers touched by a hunk. Empty means the whole file changed. */
  lines: number[];
}

export function runCommand(
  command: string,
  cwd: string,
): { ok: boolean; detail: string } {
  try {
    const out = execSync(command, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, detail: out.slice(0, 4000) };
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message: string };
    return {
      ok: false,
      detail: (e.stderr || e.stdout || e.message).slice(0, 4000),
    };
  }
}

export function runMechanicalHooks(
  config: AcdConfig,
  repoRoot: string,
  workId?: string,
): MechanicalResult[] {
  const results: MechanicalResult[] = [];
  const repo = config.repo ?? {};
  const checks: [string, string | undefined][] = [
    ["lint", repo.lintCommand],
    ["typecheck", repo.typecheckCommand],
    ["secret-scan", repo.secretScanCommand],
  ];
  for (const [name, cmd] of checks) {
    if (!cmd) continue;
    if (name === "lint" && !packageHasLintScript(repoRoot)) {
      results.push({
        name,
        ok: true,
        skipped: true,
        detail: "No lint script in package.json; skipped.",
      });
      continue;
    }
    const ran = runCommand(cmd, repoRoot);
    results.push({ name, ok: ran.ok, detail: ran.detail });
  }
  if (workId && artifactExists(repoRoot, workId, "behavior.feature")) {
    const acceptance = runAcceptanceLintHook(config, repoRoot, workId);
    results.push(acceptance);
  }
  return results;
}

export function runAcceptanceLintHook(
  config: AcdConfig,
  repoRoot: string,
  workId: string,
  onlyFiles?: string[],
): MechanicalResult {
  const behavior = readArtifact(repoRoot, workId, "behavior.feature");
  const lint = lintAcceptanceTests(repoRoot, config, behavior, onlyFiles);
  return {
    name: "acceptance-lint",
    ok: lint.ok,
    detail: formatAcceptanceLint(lint),
  };
}

/** True when package.json exists and its scripts.lint entry is a non-empty string. */
export function packageHasLintScript(repoRoot: string): boolean {
  const path = join(repoRoot, "package.json");
  if (!existsSync(path)) return false;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    return typeof parsed.scripts?.lint === "string" && parsed.scripts.lint.trim() !== "";
  } catch {
    return false;
  }
}

export function runTests(
  config: AcdConfig,
  repoRoot: string,
): MechanicalResult {
  const cmd = config.repo?.testCommand;
  if (!cmd) {
    return {
      name: "test",
      ok: true,
      detail: "No testCommand configured; skipped.",
    };
  }
  const ran = runCommand(cmd, repoRoot);
  return { name: "test", ok: ran.ok, detail: ran.detail };
}

export function gitRev(repoRoot: string, rev = "HEAD"): string | null {
  try {
    const sha = execSync(`git rev-parse ${rev}`, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return sha || null;
  } catch {
    return null;
  }
}

/** Working tree compared with `from`, so committed and uncommitted edits both count. */
export function gitDiffRange(
  repoRoot: string,
  from: string | null,
): { diff: string; files: ChangedSpan[] } {
  if (!from) return { diff: "", files: [] };
  try {
    const diff = execSync(`git diff -U0 ${from}`, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 20_000_000,
    });
    return { diff, files: parseChangedLines(diff) };
  } catch {
    return { diff: "", files: [] };
  }
}

export function parseChangedLines(diff: string): ChangedSpan[] {
  const spans: ChangedSpan[] = [];
  let current: ChangedSpan | null = null;
  for (const line of diff.split("\n")) {
    const file = line.match(/^\+\+\+ b\/(.+)$/);
    if (file?.[1] && file[1] !== "/dev/null") {
      current = { path: file[1], lines: [] };
      spans.push(current);
      continue;
    }
    if (!current) continue;
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!hunk) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    if (!Number.isFinite(start) || !Number.isFinite(count) || count <= 0) continue;
    for (let i = 0; i < count; i++) current.lines.push(start + i);
  }
  return spans;
}

export function gitDiff(repoRoot: string): string {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: repoRoot,
      stdio: "pipe",
    });
    const staged = execSync("git diff --cached", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const unstaged = execSync("git diff", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const working = `${staged}\n${unstaged}`.trim();
    if (working) return working;

    for (const base of ["origin/main", "main", "origin/master", "master"]) {
      try {
        const branchDiff = execSync(`git diff ${base}...HEAD`, {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }).trim();
        if (branchDiff) return branchDiff;
      } catch {
        // base ref does not exist or diff failed; try next
      }
    }
    return "";
  } catch {
    return "";
  }
}

export function gitIdentity(repoRoot: string): string {
  try {
    const name = execSync("git config user.name", {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const email = execSync("git config user.email", {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    return `${name} <${email}>`;
  } catch {
    return process.env.USER ?? "unknown";
  }
}

export function gitCommit(
  repoRoot: string,
  message: string,
  paths: string[] = [],
): boolean {
  if (paths.length === 0) return false;
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: repoRoot,
      stdio: "pipe",
    });
    execSync(`git add -- ${paths.map((p) => JSON.stringify(p)).join(" ")}`, {
      cwd: repoRoot,
      stdio: "pipe",
    });
    execSync(`git commit -m ${JSON.stringify(message)}`, {
      cwd: repoRoot,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

export function currentBranch(repoRoot: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "HEAD";
  }
}

export function ghPrCreate(
  repoRoot: string,
  title: string,
  body: string,
): { url: string | null; created: boolean } {
  try {
    const url = execSync(
      `gh pr create --title ${JSON.stringify(title)} --body ${JSON.stringify(body)}`,
      { cwd: repoRoot, encoding: "utf8" },
    ).trim();
    return { url, created: true };
  } catch {
    return { url: null, created: false };
  }
}

export function readSystemConstraints(repoRoot: string): string {
  for (const p of systemConstraintsCandidates(repoRoot)) {
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  return "";
}
