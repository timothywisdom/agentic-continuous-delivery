import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { AcdConfig } from "../types/config.js";
import { isAcceptanceTestFile } from "./acceptance-lint-adapters/index.js";

const DEFAULT_TEST_ROOTS = ["tests/acceptance"];
const DEFAULT_SUPPORT_ROOTS = ["tests/support", "tests/helpers"];

export function acceptanceTestRoots(config: AcdConfig): string[] {
  const roots = config.repo?.acceptanceTestRoots;
  return roots && roots.length > 0 ? roots : DEFAULT_TEST_ROOTS;
}

export function acceptanceSupportRoots(config: AcdConfig): string[] {
  const roots = config.repo?.acceptanceSupportRoots;
  return roots && roots.length > 0 ? roots : DEFAULT_SUPPORT_ROOTS;
}

/** True when any non-empty file already exists under a support root. */
export function acceptanceSupportPresent(
  repoRoot: string,
  config: AcdConfig,
): boolean {
  for (const root of acceptanceSupportRoots(config)) {
    const dir = join(repoRoot, root);
    if (!existsSync(dir)) continue;
    let found = false;
    walkFiles(dir, () => {
      found = true;
    });
    if (found) return true;
  }
  return false;
}

export function listAcceptanceTestFiles(
  repoRoot: string,
  config: AcdConfig,
): string[] {
  const out: string[] = [];
  for (const root of acceptanceTestRoots(config)) {
    const dir = join(repoRoot, root);
    if (!existsSync(dir)) continue;
    walkFiles(dir, (abs) => {
      const rel = relative(repoRoot, abs).split("\\").join("/");
      if (!isAcceptanceTestFile(rel)) return;
      out.push(rel);
    });
  }
  return out.sort();
}

export function isUnderRoots(relPath: string, roots: string[]): boolean {
  const norm = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  return roots.some(
    (root) =>
      norm === root ||
      norm.startsWith(`${root}/`) ||
      root.endsWith(`/${norm}`),
  );
}

function walkFiles(dir: string, visit: (abs: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walkFiles(abs, visit);
    } else if (entry.isFile()) {
      visit(abs);
    }
  }
}
