import { STAGE_NAMES, V1_STUBS, isStageName } from "../types/stages.js";
import { isSafeArtifactName } from "../work/artifact-name.js";

export const UI_ALLOWED_COMMANDS = [
  "config",
  "list",
  "status",
  "artifacts",
  "artifact-save",
  "intake",
  "specify",
  "implement",
  "review",
  "pr",
  "ci-review",
  "test",
  "fix",
  "approve",
  "reject",
  "amend",
  ...V1_STUBS,
] as const;

export type UiAllowedCommand = (typeof UI_ALLOWED_COMMANDS)[number];

export interface UiRunRequest {
  command: string;
  args?: string[];
  flags?: Record<string, string | boolean | number | null | undefined>;
  /** Body for `artifact-save` (not placed on argv / logs). */
  stdin?: string;
}

const ALLOWED = new Set<string>(UI_ALLOWED_COMMANDS);

const FLAG_NAME = /^[a-z][a-z0-9-]*$/;
const MAX_STDIN_BYTES = 2_000_000;

export function isAllowedUiCommand(command: string): command is UiAllowedCommand {
  return ALLOWED.has(command);
}

export function buildAcDArgv(req: UiRunRequest): string[] {
  if (!isAllowedUiCommand(req.command)) {
    throw new Error(`Command '${req.command}' is not allowed from the UI.`);
  }
  if (req.stdin !== undefined && req.command !== "artifact-save") {
    throw new Error("stdin is only allowed for artifact-save.");
  }
  if (req.command === "artifact-save") {
    const name = req.args?.[0];
    if (!name || !isSafeArtifactName(name)) {
      throw new Error("artifact-save requires a safe artifact file name.");
    }
    if (typeof req.stdin !== "string") {
      throw new Error("artifact-save requires stdin contents.");
    }
    if (Buffer.byteLength(req.stdin, "utf8") > MAX_STDIN_BYTES) {
      throw new Error("artifact-save payload is too large.");
    }
    for (const key of Object.keys(req.flags ?? {})) {
      if (key !== "work-id") {
        throw new Error(`Flag '${key}' is not allowed for artifact-save from the UI.`);
      }
    }
  }
  const argv: string[] = [req.command];
  for (const arg of req.args ?? []) {
    if (typeof arg !== "string" || arg.startsWith("-")) {
      throw new Error("Invalid positional argument.");
    }
    argv.push(arg);
  }
  if (
    (req.command === "approve" ||
      req.command === "reject" ||
      req.command === "amend") &&
    req.args?.[0] &&
    !isStageName(req.args[0])
  ) {
    throw new Error(`Unknown stage '${req.args[0]}'.`);
  }
  for (const [key, value] of Object.entries(req.flags ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (!FLAG_NAME.test(key)) {
      throw new Error(`Invalid flag '${key}'.`);
    }
    if (value === true) {
      argv.push(`--${key}`);
    } else {
      argv.push(`--${key}`, String(value));
    }
  }
  return argv;
}

export function stageGraphNodes(): {
  id: string;
  kind: "pipeline" | "fix" | "stub";
}[] {
  return [
    ...["intake", "specify", "implement", "review", "pr", "ci_review"].map(
      (id) => ({ id, kind: "pipeline" as const }),
    ),
    { id: "fix", kind: "fix" },
    ...V1_STUBS.map((id) => ({ id, kind: "stub" as const })),
  ];
}

export function stageGraphEdges(): { from: string; to: string }[] {
  return [
    { from: "intake", to: "specify" },
    { from: "specify", to: "implement" },
    { from: "implement", to: "review" },
    { from: "review", to: "pr" },
    { from: "pr", to: "ci_review" },
    { from: "implement", to: "ci_review" },
    { from: "ci_review", to: "deploy" },
    { from: "deploy", to: "canary" },
    { from: "canary", to: "rollback" },
    { from: "implement", to: "fix" },
  ];
}

export { STAGE_NAMES };
