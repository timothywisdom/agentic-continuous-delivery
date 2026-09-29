import { existsSync, readFileSync } from "node:fs";
import { envFileCandidates } from "../paths.js";

/**
 * Load KEY=VALUE pairs from `.acd/.env.local` (then repo-root `.env.local` / `.env`).
 * Does not override variables already set in the environment.
 */
export function loadEnvLocal(repoRoot: string): void {
  for (const path of envFileCandidates(repoRoot)) {
    if (!existsSync(path)) continue;
    applyEnvFile(readFileSync(path, "utf8"));
  }
}

function applyEnvFile(raw: string): void {
  for (const line of raw.split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("export ")) {
      trimmed = trimmed.slice("export ".length).trim();
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
