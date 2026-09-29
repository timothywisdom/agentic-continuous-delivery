import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

export function validateRepoRoot(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Repository path is empty.");
  }
  if (trimmed.includes("\0")) {
    throw new Error("Invalid repository path.");
  }
  const resolved = resolve(trimmed);
  if (!existsSync(resolved)) {
    throw new Error(`Path does not exist: ${resolved}`);
  }
  if (!statSync(resolved).isDirectory()) {
    throw new Error(`Not a directory: ${resolved}`);
  }
  return resolved;
}
