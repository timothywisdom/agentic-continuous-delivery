import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { runCommand } from "../hooks/mechanical.js";
import type { AcdConfig } from "../types/config.js";
import { slugify } from "../work/store.js";
import type { Scenario } from "./gherkin.js";

const ROOTS = ["tests/acceptance", "tests", "test"];

export function findScenarioTests(repoRoot: string, scenario: Scenario): string[] {
  const titleSlug = slugify(scenario.title);
  if (titleSlug.length < 3) return [];
  for (const root of ROOTS) {
    const dir = join(repoRoot, root);
    if (!existsSync(dir)) continue;
    const found: string[] = [];
    walk(dir, (abs) => {
      if (!/\.(test|spec)\.[^.]+$/i.test(abs)) return;
      const base = abs.split(/[/\\]/).pop() ?? "";
      const stem = base.replace(/\.(test|spec)\.[^.]+$/i, "");
      const fileSlug = slugify(stem);
      if (slugsMatch(fileSlug, titleSlug)) {
        found.push(relative(repoRoot, abs).split("\\").join("/"));
      }
    });
    if (found.length > 0) return found;
  }
  return [];
}

export function slugsMatch(fileSlug: string, titleSlug: string): boolean {
  if (titleSlug.length < 3 || fileSlug.length < 3) return false;
  if (fileSlug === titleSlug) return true;
  if (titleSlug.length < 8 || fileSlug.length < 8) return false;
  return fileSlug.includes(titleSlug) || titleSlug.includes(fileSlug);
}

export function runScenarioTests(
  config: AcdConfig,
  repoRoot: string,
  files: string[],
): { ok: boolean; detail: string; ran: boolean } {
  const cmd = config.repo?.testCommand?.trim() ?? "";
  if (!cmd || files.length === 0) {
    return { ok: false, detail: "", ran: false };
  }
  const quoted = files.map(shellQuote).join(" ");
  let narrowed: string | null = null;
  if (/^node\s+--test\b/.test(cmd)) {
    narrowed = `node --test ${quoted}`;
  } else if (/^npm\s+test\b/.test(cmd)) {
    narrowed = `${cmd} -- ${quoted}`;
  }
  if (!narrowed) {
    return {
      ok: false,
      detail: "testCommand cannot target one scenario file",
      ran: false,
    };
  }
  const ran = runCommand(narrowed, repoRoot);
  return { ok: ran.ok, detail: ran.detail, ran: true };
}

function walk(dir: string, visit: (abs: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(abs, visit);
    } else if (entry.isFile()) {
      visit(abs);
    }
  }
}

function shellQuote(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}
