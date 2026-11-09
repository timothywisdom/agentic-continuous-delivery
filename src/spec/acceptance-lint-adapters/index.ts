import { javascriptAdapter } from "./javascript.js";
import { pythonAdapter } from "./python.js";
import type { AcceptanceLintAdapter } from "./types.js";

export type { AcceptanceLintAdapter, AcceptanceLintHit } from "./types.js";
export { javascriptAdapter } from "./javascript.js";
export { pythonAdapter } from "./python.js";

/** Built-in language adapters. Add a new file + entry here to support another stack. */
export const acceptanceLintAdapters: readonly AcceptanceLintAdapter[] = [
  javascriptAdapter,
  pythonAdapter,
];

/** Pick the adapter for a repo-relative path, or null when none match. */
export function resolveAcceptanceLintAdapter(
  relPath: string,
): AcceptanceLintAdapter | null {
  return (
    acceptanceLintAdapters.find((adapter) => adapter.matchesFile(relPath)) ??
    null
  );
}

/** True when any registered adapter treats this path as an acceptance test file. */
export function isAcceptanceTestFile(relPath: string): boolean {
  return acceptanceLintAdapters.some((adapter) => adapter.isTestFile(relPath));
}
