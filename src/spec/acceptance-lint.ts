import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AcdConfig } from "../types/config.js";
import {
  isAcceptanceTestFile,
  resolveAcceptanceLintAdapter,
  type AcceptanceLintAdapter,
} from "./acceptance-lint-adapters/index.js";
import type { Scenario } from "./gherkin.js";
import { parseScenarios } from "./gherkin.js";
import {
  acceptanceSupportRoots,
  acceptanceTestRoots,
  isUnderRoots,
  listAcceptanceTestFiles,
} from "./acceptance-paths.js";

export interface AcceptanceLintIssue {
  file: string;
  line: number | null;
  rule: string;
  message: string;
}

export interface AcceptanceLintResult {
  ok: boolean;
  issues: AcceptanceLintIssue[];
}

const SCENARIO_HEADER =
  /(?:\/\/|#|\/\*|<!--)\s*acd-scenario:\s*(\S+)/i;

/**
 * Deterministic structural checks for acceptance tests.
 *
 * Shared (language-neutral): scenario binding, step comments, configured roots.
 * Language-specific smells (product imports, source reads, console spies) go
 * through {@link AcceptanceLintAdapter} — see `acceptance-lint-adapters/`.
 * Files with no matching adapter still get the shared checks only.
 */
export function lintAcceptanceTests(
  repoRoot: string,
  config: AcdConfig,
  behaviorFeature: string,
  onlyFiles?: string[],
): AcceptanceLintResult {
  const scenarios = parseScenarios(behaviorFeature);
  const byLabel = new Map(
    scenarios.map((scenario) => [scenario.label.toLowerCase(), scenario]),
  );
  const testRoots = acceptanceTestRoots(config);
  const supportRoots = acceptanceSupportRoots(config);
  const allowedImportRoots = [...testRoots, ...supportRoots, "node_modules"];
  const issues: AcceptanceLintIssue[] = [];
  const all = listAcceptanceTestFiles(repoRoot, config);
  let files =
    onlyFiles && onlyFiles.length > 0
      ? all.filter((file) =>
          onlyFiles.some((wanted) => {
            const norm = wanted.replace(/\\/g, "/");
            return file === norm || file.endsWith(`/${norm}`);
          }),
        )
      : all;
  if (onlyFiles && onlyFiles.length > 0 && files.length === 0) {
    for (const wanted of onlyFiles) {
      const norm = wanted.replace(/\\/g, "/");
      if (isUnderRoots(norm, testRoots) && isAcceptanceTestFile(norm)) {
        files = [...files, norm];
      }
    }
  }

  for (const rel of files) {
    const abs = join(repoRoot, rel);
    let text = "";
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      issues.push({
        file: rel,
        line: null,
        rule: "readable",
        message: "Acceptance test file could not be read.",
      });
      continue;
    }

    const header = text.match(SCENARIO_HEADER);
    if (!header?.[1]) {
      issues.push({
        file: rel,
        line: 1,
        rule: "acd-scenario",
        message:
          "Missing `acd-scenario: <label>` header binding this file to a behavior scenario.",
      });
    } else {
      const label = header[1].replace(/[,;].*$/, "").trim();
      const scenario = byLabel.get(label.toLowerCase());
      if (!scenario) {
        issues.push({
          file: rel,
          line: lineOf(text, header.index ?? 0),
          rule: "acd-scenario",
          message: `Header binds to scenario '${label}', which is not in behavior.feature.`,
        });
      } else {
        issues.push(...missingStepComments(rel, text, scenario));
      }
    }

    const adapter = resolveAcceptanceLintAdapter(rel);
    if (adapter) {
      issues.push(
        ...adapterIssues(rel, text, adapter, allowedImportRoots, testRoots),
      );
    }
  }

  return { ok: issues.length === 0, issues };
}

export function formatAcceptanceLint(result: AcceptanceLintResult): string {
  if (result.ok) return "acceptance lint passed";
  return result.issues
    .map(
      (issue) =>
        `${issue.file}${issue.line != null ? `:${issue.line}` : ""} [${issue.rule}] ${issue.message}`,
    )
    .join("\n");
}

function adapterIssues(
  rel: string,
  text: string,
  adapter: AcceptanceLintAdapter,
  allowedImportRoots: string[],
  testRoots: string[],
): AcceptanceLintIssue[] {
  const issues: AcceptanceLintIssue[] = [];

  for (const hit of adapter.extractImports(text)) {
    if (!hit.target || adapter.isExternalImport(hit.target)) continue;
    const resolved = normalizeImport(rel, hit.target);
    if (isUnderRoots(resolved, allowedImportRoots)) continue;
    if (isUnderRoots(resolved, testRoots)) continue;
    issues.push({
      file: rel,
      line: lineOf(text, hit.index),
      rule: "no-product-import",
      message: `Acceptance tests must not import product modules ('${hit.target}'). Use the shared acceptance support module.`,
    });
  }

  for (const hit of adapter.extractSourceReads(text)) {
    if (!hit.target) continue;
    const resolved = normalizeImport(rel, hit.target);
    if (isUnderRoots(resolved, allowedImportRoots)) continue;
    if (isAcceptanceTestFile(resolved)) continue;
    issues.push({
      file: rel,
      line: lineOf(text, hit.index),
      rule: "no-source-read",
      message: `Acceptance tests must not read product source ('${hit.target}').`,
    });
  }

  if (adapter.hasConsoleSpy(text)) {
    issues.push({
      file: rel,
      line: null,
      rule: "no-console-spy",
      message:
        "Acceptance tests must not spy on or replace console/print; assert observable user-facing outcomes.",
    });
  }

  return issues;
}

function missingStepComments(
  file: string,
  text: string,
  scenario: Scenario,
): AcceptanceLintIssue[] {
  const issues: AcceptanceLintIssue[] = [];
  const comments = commentBodies(text).map(normalizeStep);
  const steps = scenario.body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(Given|When|Then|And|But)\b/i.test(line))
    .map(normalizeStep)
    .filter((step) => /^(when|then)\b/.test(step));

  let cursor = 0;
  for (const step of steps) {
    const at = comments.findIndex(
      (comment, index) => index >= cursor && commentIncludes(comment, step),
    );
    if (at < 0) {
      issues.push({
        file,
        line: null,
        rule: "step-comment",
        message: `Missing comment for scenario step: ${step}`,
      });
      continue;
    }
    cursor = at + 1;
  }
  return issues;
}

function commentBodies(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//")) {
      out.push(trimmed.slice(2).trim());
      continue;
    }
    if (trimmed.startsWith("#") && !trimmed.startsWith("#!")) {
      out.push(trimmed.slice(1).trim());
      continue;
    }
  }
  for (const block of text.matchAll(/\/\*([\s\S]*?)\*\//g)) {
    out.push(...(block[1] ?? "").split("\n").map((line) => line.trim()));
  }
  return out;
}

function normalizeStep(step: string): string {
  return step
    .toLowerCase()
    .replace(/^#+\s*/, "")
    .replace(/^\/\/\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function commentIncludes(comment: string, step: string): boolean {
  if (!comment || !step) return false;
  if (comment === step) return true;
  const stripped = step.replace(/^(given|when|then|and|but)\s+/i, "");
  return comment.includes(step) || (stripped.length > 8 && comment.includes(stripped));
}

/**
 * Resolve a relative import/module path against the importing file.
 * Dot-only Python relatives (`..support.steps`) become path segments.
 */
function normalizeImport(fromFile: string, spec: string): string {
  const norm = spec.replace(/\\/g, "/");
  if (norm.startsWith(".") && !norm.startsWith("./") && !norm.startsWith("../")) {
    // Python: `..support.steps` → ../support/steps
    const dots = norm.match(/^\.+/)?.[0] ?? "";
    const rest = norm.slice(dots.length).replace(/\./g, "/");
    const up = "../".repeat(Math.max(dots.length - 1, 0));
    return normalizeImport(fromFile, `${up}${rest}`);
  }
  if (!norm.startsWith(".")) return norm;
  const fromDir = fromFile.includes("/")
    ? fromFile.slice(0, fromFile.lastIndexOf("/"))
    : "";
  const parts = [...fromDir.split("/").filter(Boolean), ...norm.split("/")];
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join("/");
}

function lineOf(text: string, index: number): number {
  if (index <= 0) return 1;
  return text.slice(0, index).split("\n").length;
}
