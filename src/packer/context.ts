import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Scenario } from "../spec/gherkin.js";

export interface ContextPack {
  intentSummary: string;
  feature: string;
  scenario: Scenario;
  priorSummary: string;
  files: { path: string; content: string }[];
}

const DEFAULT_TOUCH = [
  "src",
  "lib",
  "app",
  "test",
  "tests",
];

export function summarizeIntent(intent: string): string {
  return intent
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("<!--"))
    .slice(0, 8)
    .join(" ");
}

export function packContext(
  repoRoot: string,
  workDir: string,
  scenario: Scenario,
  extraFiles: string[] = [],
): ContextPack {
  const intent = readFileSync(join(workDir, "intent.md"), "utf8");
  const feature = readFileSync(join(workDir, "feature.md"), "utf8");
  const prior = latestSessionSummary(workDir);
  const files = extraFiles
    .filter((p) => existsSync(join(repoRoot, p)))
    .map((p) => ({
      path: p,
      content: readFileSync(join(repoRoot, p), "utf8").slice(0, 8000),
    }));
  return {
    intentSummary: summarizeIntent(intent),
    feature,
    scenario,
    priorSummary: prior,
    files,
  };
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

export { DEFAULT_TOUCH };
