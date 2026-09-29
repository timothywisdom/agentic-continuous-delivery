import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { workEventSchema, workStateSchema } from "../schemas/zod.js";
import type { WorkEvent, WorkState } from "../types/work.js";

import { acdWorkRoot } from "../paths.js";
import { isReservedArtifactName, isSafeArtifactName } from "./artifact-name.js";

export function workRoot(repoRoot: string): string {
  return acdWorkRoot(repoRoot);
}

export function workDir(repoRoot: string, workId: string): string {
  return join(workRoot(repoRoot), workId);
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return slug || "change";
}

export function newWorkId(sourceText: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  return `${stamp}-${slugify(sourceText)}`;
}

export function ensureWorkDir(repoRoot: string, workId: string): string {
  const dir = workDir(repoRoot, workId);
  mkdirSync(join(dir, "sessions"), { recursive: true });
  return dir;
}

export function readState(repoRoot: string, workId: string): WorkState {
  const path = join(workDir(repoRoot, workId), "state.json");
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return workStateSchema.parse(raw);
}

export function writeState(
  repoRoot: string,
  state: WorkState,
): void {
  const dir = ensureWorkDir(repoRoot, state.id);
  const next = { ...state, updatedAt: new Date().toISOString() };
  writeFileSync(
    join(dir, "state.json"),
    JSON.stringify(next, null, 2) + "\n",
  );
}

export function appendEvent(
  repoRoot: string,
  event: WorkEvent,
): void {
  const parsed = workEventSchema.parse(event);
  const dir = ensureWorkDir(repoRoot, parsed.workId);
  appendFileSync(join(dir, "events.jsonl"), JSON.stringify(parsed) + "\n");
}

export function readEvents(repoRoot: string, workId: string): WorkEvent[] {
  const path = join(workDir(repoRoot, workId), "events.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => workEventSchema.parse(JSON.parse(line)));
}

export function listWorkIds(repoRoot: string): string[] {
  const root = workRoot(repoRoot);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

export function latestWorkId(repoRoot: string): string | null {
  const ids = listWorkIds(repoRoot);
  return ids.at(-1) ?? null;
}

export function resolveWorkId(
  repoRoot: string,
  workId?: string,
): string {
  if (workId) return workId;
  const latest = latestWorkId(repoRoot);
  if (!latest) {
    throw new Error("No work items found. Run `acd intake --from \"...\"` first.");
  }
  return latest;
}

export function artifactPath(
  repoRoot: string,
  workId: string,
  name: string,
): string {
  return join(workDir(repoRoot, workId), name);
}

export function writeArtifact(
  repoRoot: string,
  workId: string,
  name: string,
  contents: string,
): string {
  const path = artifactPath(repoRoot, workId, name);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents.endsWith("\n") ? contents : contents + "\n");
  return path;
}

export function readArtifact(
  repoRoot: string,
  workId: string,
  name: string,
): string {
  return readFileSync(artifactPath(repoRoot, workId, name), "utf8");
}

export function artifactExists(
  repoRoot: string,
  workId: string,
  name: string,
): boolean {
  return existsSync(artifactPath(repoRoot, workId, name));
}

export function listArtifacts(
  repoRoot: string,
  workId: string,
): { name: string; path: string; contents: string }[] {
  const dir = workDir(repoRoot, workId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && !isReservedArtifactName(d.name))
    .map((d) => {
      const path = join(dir, d.name);
      return {
        name: d.name,
        path,
        contents: readFileSync(path, "utf8"),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function saveWorkArtifact(
  repoRoot: string,
  workId: string,
  name: string,
  contents: string,
): string {
  if (!isSafeArtifactName(name)) {
    throw new Error(`Invalid artifact name '${name}'.`);
  }
  const path = artifactPath(repoRoot, workId, name);
  if (!existsSync(path)) {
    throw new Error(`Artifact '${name}' does not exist on work item '${workId}'.`);
  }
  return writeArtifact(repoRoot, workId, name, contents);
}
