import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AcdConfig } from "../types/config.js";
import { systemConstraintsCandidates } from "../paths.js";

export interface MechanicalResult {
  name: string;
  ok: boolean;
  detail?: string;
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
    const ran = runCommand(cmd, repoRoot);
    results.push({ name, ok: ran.ok, detail: ran.detail });
  }
  return results;
}

export function runTests(
  config: AcdConfig,
  repoRoot: string,
): MechanicalResult {
  const cmd = config.repo?.testCommand;
  if (!cmd) {
    return { name: "test", ok: true, detail: "No testCommand configured; skipped." };
  }
  const ran = runCommand(cmd, repoRoot);
  return { name: "test", ok: ran.ok, detail: ran.detail };
}

export function gitDiff(repoRoot: string): string {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: repoRoot,
      stdio: "pipe",
    });
  } catch {
    return "";
  }
  try {
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
    return `${staged}\n${unstaged}`;
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
