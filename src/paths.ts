import { join } from "node:path";

/** Consumer-repo holding tank for ACD (config, skills copy, work items). */
export function acdHome(repoRoot: string): string {
  return join(repoRoot, ".acd");
}

export function acdWorkRoot(repoRoot: string): string {
  return join(acdHome(repoRoot), "work");
}

/** Committed project pins — prefer `.acd/`, fall back to repo-root (legacy). */
export function committedConfigCandidates(repoRoot: string): string[] {
  return [
    join(acdHome(repoRoot), "acd.config.yaml"),
    join(repoRoot, "acd.config.yaml"),
  ];
}

export function localConfigCandidates(repoRoot: string): string[] {
  return [
    join(acdHome(repoRoot), "acd.config.local.yaml"),
    join(repoRoot, "acd.config.local.yaml"),
  ];
}

export function envFileCandidates(repoRoot: string): string[] {
  const home = acdHome(repoRoot);
  return [
    join(home, ".env.local"),
    join(home, ".env"),
    join(repoRoot, ".env.local"),
    join(repoRoot, ".env"),
  ];
}

export function systemConstraintsCandidates(repoRoot: string): string[] {
  return [
    join(acdHome(repoRoot), "system-constraints.yaml"),
    join(repoRoot, "acd", "system-constraints.yaml"),
    join(repoRoot, "system-constraints.yaml"),
  ];
}
