#!/usr/bin/env node
import { join, resolve } from "node:path";
import {
  applyCliOverrides,
  envOverrides,
  loadRepoConfig,
} from "../config/load.js";
import { loadEnvLocal } from "../config/env.js";
import { describeConfig } from "../config/resolve.js";
import { initRepo } from "../init/copy.js";
import { approveStage, amendStage, rejectStage, runStage } from "../orchestrator/index.js";
import { writeKitJsonSchemas } from "../schemas/write-json.js";
import { ciReviewStage } from "../stages/ci-review.js";
import { fixStage } from "../stages/fix.js";
import { implementStage } from "../stages/implement.js";
import { intakeStage } from "../stages/intake.js";
import { prStage } from "../stages/pr.js";
import { reviewStage } from "../stages/review.js";
import { specifyStage } from "../stages/specify.js";
import type { CliOverrides } from "../types/config.js";
import { isStageName, STAGE_NAMES, V1_STUBS, type StageName } from "../types/stages.js";
import { runTests } from "../hooks/mechanical.js";
import { listArtifacts, listWorkIds, readEvents, readState, resolveWorkId, saveWorkArtifact } from "../work/store.js";
import { emit } from "../work/events.js";
import { readFileSync } from "node:fs";
import { startUi } from "./ui.js";

function usage(): string {
  return `acd — Agentic Continuous Delivery runner (deterministic orchestrator)

Usage:
  acd-kit init [dir] [--cursor] [--github]
  acd-kit config
  acd intake --from "<plain english>"
  acd specify [--artifact intent|behavior|feature|acceptance|all]
  acd implement [--scenario N]
  acd review
  acd pr
  acd ci-review
  acd test
  acd fix
  acd approve <stage>
  acd reject <stage> --reason "..."
  acd amend <stage> [--note "..."] [--continue]
  acd status [work-id]
  acd list
  acd artifacts [work-id]
  acd artifact-save <name> [--work-id <id>] [--contents "..."]
  acd ui [--port N] [--repo-root <path>]
  acd deploy|canary|rollback|hypothesis   (stubs)

HitL / guidance:
  approve  — accept stage output and continue the pipeline
  reject   — discard the pause with a reason (re-run the stage later)
  amend    — keep artifacts, optionally add guidance, re-run (--continue)

Global flags:
  --work-id <id>   --harness <name>   --tier classify|low|med|high
  --approve-policy all|none
  --require-approval | --no-require-approval
  --repo-root <path>
  init: --cursor (Cursor adapter at repo root)  --github (CI workflow)
`;
}

function parseArgs(argv: string[]): {
  cmd: string;
  args: string[];
  flags: Record<string, string | boolean>;
} {
  const [cmd = "help", ...rest] = argv;
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i] ?? "";
    if (token === "--require-approval") flags.requireApproval = true;
    else if (token === "--no-require-approval") flags.requireApproval = false;
    else if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      args.push(token);
    }
  }
  return { cmd, args, flags };
}

function overridesFromFlags(flags: Record<string, string | boolean>): CliOverrides {
  const env = envOverrides();
  const overrides: CliOverrides = { ...env };
  if (typeof flags.harness === "string") overrides.harness = flags.harness;
  if (typeof flags.tier === "string") {
    overrides.tier = flags.tier as CliOverrides["tier"];
  }
  if (typeof flags["approve-policy"] === "string") {
    const p = flags["approve-policy"];
    if (p === "all" || p === "none") overrides.approvePolicy = p;
  }
  if (typeof flags.requireApproval === "boolean") {
    overrides.requireApproval = flags.requireApproval;
  }
  if (typeof flags["work-id"] === "string") overrides.workId = flags["work-id"];
  if (typeof flags["repo-root"] === "string") overrides.repoRoot = flags["repo-root"];
  return overrides;
}

async function main(): Promise<void> {
  const { cmd, args, flags } = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(
    typeof flags["repo-root"] === "string" ? flags["repo-root"] : process.cwd(),
  );
  loadEnvLocal(repoRoot);

  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    process.stdout.write(usage());
    return;
  }

  const overrides = overridesFromFlags(flags);

  if (cmd === "init") {
    const target = resolve(args[0] ?? repoRoot);
    initRepo(target, {
      cursorIde: flags.cursor === true,
      github: flags.github === true,
    });
    process.stdout.write(
      `Initialized ACD in ${join(target, ".acd")}\n\n` +
        `Next:\n` +
        `  npx acd-kit ui\n` +
        `  npx acd-kit intake --from "<what you want to build>"\n`,
    );
    return;
  }

  if (cmd === "ui") {
    const port =
      typeof flags.port === "string" ? Number(flags.port) : undefined;
    await startUi({ repoRoot, port });
    return;
  }

  if (cmd === "write-schemas") {
    writeKitJsonSchemas();
    process.stdout.write("Wrote acd/schemas\n");
    return;
  }

  const config = applyCliOverrides(loadRepoConfig(repoRoot), overrides);
  const ctx = { repoRoot, config, overrides };

  if (cmd === "config") {
    process.stdout.write(JSON.stringify(describeConfig(config, overrides), null, 2) + "\n");
    return;
  }

  if (cmd === "intake") {
    const from = flags.from;
    if (typeof from !== "string" || !from.trim()) {
      throw new Error(`acd intake requires --from "<plain english>"`);
    }
    const result = await runStage(intakeStage, { sourceText: from }, ctx);
    printJson(result);
    return;
  }

  if (cmd === "specify") {
    const artifact = (flags.artifact as string) ?? "all";
    const workId = resolveWorkId(repoRoot, overrides.workId);
    const result = await runStage(
      specifyStage,
      { workId, artifact },
      { ...ctx, workId },
    );
    printJson(result);
    if (result.awaitingGuidance) process.exitCode = 2;
    return;
  }

  if (cmd === "implement") {
    const workId = resolveWorkId(repoRoot, overrides.workId);
    const scenario =
      typeof flags.scenario === "string" ? Number(flags.scenario) : undefined;
    const result = await runStage(
      implementStage,
      { workId, scenario },
      { ...ctx, workId },
    );
    printJson(result);
    return;
  }

  if (cmd === "review") {
    const workId = resolveWorkId(repoRoot, overrides.workId);
    const result = await runStage(reviewStage, { workId }, { ...ctx, workId });
    printJson(result);
    if (result.output?.decision === "block") process.exitCode = 1;
    return;
  }

  if (cmd === "pr") {
    const workId = resolveWorkId(repoRoot, overrides.workId);
    const result = await runStage(prStage, { workId }, { ...ctx, workId });
    printJson(result);
    return;
  }

  if (cmd === "ci-review" || cmd === "ci_review") {
    const ids = listWorkIds(repoRoot);
    if (ids.length === 0) {
      const tests = runTests(config, repoRoot);
      printJson({
        decision: tests.ok ? "pass" : "block",
        findings: [],
        testsOk: tests.ok,
        note: "No ACD work items; ran tests only.",
      });
      if (!tests.ok) process.exitCode = 1;
      return;
    }
    const workId = overrides.workId
      ? resolveWorkId(repoRoot, overrides.workId)
      : undefined;
    const result = await runStage(
      ciReviewStage,
      { workId },
      { ...ctx, workId },
    );
    printJson(result);
    if (result.output?.decision === "block") process.exitCode = 1;
    return;
  }

  if (cmd === "test") {
    const result = runTests(config, repoRoot);
    printJson(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (cmd === "fix") {
    const workId = resolveWorkId(repoRoot, overrides.workId);
    const result = await runStage(fixStage, { workId }, { ...ctx, workId });
    printJson(result);
    if (result.output?.pipelineStatus === "red") process.exitCode = 1;
    return;
  }

  if (cmd === "approve") {
    const stage = args[0];
    if (!stage || !isStageName(stage)) {
      throw new Error(`acd approve requires a stage (${STAGE_NAMES.join(", ")})`);
    }
    const workId = resolveWorkId(repoRoot, overrides.workId);
    const state = approveStage(
      repoRoot,
      workId,
      stage,
      process.env.USER ?? "human",
    );
    printJson(state);
    return;
  }

  if (cmd === "reject") {
    const stage = args[0];
    if (!stage || !isStageName(stage)) {
      throw new Error(`acd reject requires a stage`);
    }
    const reason =
      typeof flags.reason === "string" ? flags.reason : "rejected";
    const workId = resolveWorkId(repoRoot, overrides.workId);
    const state = rejectStage(
      repoRoot,
      workId,
      stage,
      reason,
      process.env.USER ?? "human",
    );
    printJson(state);
    return;
  }

  if (cmd === "amend") {
    const stage = args[0];
    if (!stage || !isStageName(stage)) {
      throw new Error(`acd amend requires a stage (${STAGE_NAMES.join(", ")})`);
    }
    const note = typeof flags.note === "string" ? flags.note : null;
    const workId = resolveWorkId(repoRoot, overrides.workId);
    const state = amendStage(
      repoRoot,
      workId,
      stage,
      note,
      process.env.USER ?? "human",
    );
    if (flags.continue === true || flags.continue === "true") {
      if (stage === "specify") {
        const result = await runStage(
          specifyStage,
          { workId, artifact: "all" },
          { ...ctx, workId, overrides: { ...overrides, workId } },
        );
        printJson({ amended: state, continued: result });
        if (result.awaitingGuidance) process.exitCode = 2;
        return;
      }
      throw new Error(
        `acd amend --continue is implemented for specify in v1; re-run \`acd ${stage}\` manually.`,
      );
    }
    printJson(state);
    process.stderr.write(
      `acd: amended '${stage}'. Re-run: npx acd ${stage}` +
        (note ? ` (guidance note saved)` : "") +
        `\n`,
    );
    return;
  }

  if (cmd === "status") {
    const workId = resolveWorkId(repoRoot, args[0] ?? overrides.workId);
    const state = readState(repoRoot, workId);
    const events = readEvents(repoRoot, workId);
    printJson({
      state,
      lastEvent: events.at(-1) ?? null,
      eventCount: events.length,
    });
    return;
  }

  if (cmd === "list") {
    const ids = listWorkIds(repoRoot);
    printJson({ workIds: ids, latest: ids.at(-1) ?? null });
    return;
  }

  if (cmd === "artifacts") {
    const workId = resolveWorkId(repoRoot, args[0] ?? overrides.workId);
    printJson({
      workId,
      artifacts: listArtifacts(repoRoot, workId),
    });
    return;
  }

  if (cmd === "artifact-save") {
    const name = args[0];
    if (!name) {
      throw new Error(`acd artifact-save requires a file name (e.g. intent.md)`);
    }
    const workId = resolveWorkId(repoRoot, overrides.workId ?? args[1]);
    const contents = readArtifactSaveContents(flags);
    const path = saveWorkArtifact(repoRoot, workId, name, contents);
    emit(repoRoot, workId, "artifact.saved", undefined, {
      name,
      bytes: Buffer.byteLength(contents, "utf8"),
    });
    printJson({ workId, name, path, bytes: Buffer.byteLength(contents, "utf8") });
    return;
  }

  if (V1_STUBS.includes(cmd as StageName) || cmd === "deploy") {
    throw new Error(
      `Stage '${cmd}' is named in the ACD state machine but not implemented in v1.`,
    );
  }

  throw new Error(`Unknown command '${cmd}'.\n${usage()}`);
}

function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function readArtifactSaveContents(flags: Record<string, string | boolean>): string {
  if (typeof flags.contents === "string") return flags.contents;
  if (process.stdin.isTTY) {
    throw new Error(
      `acd artifact-save requires --contents "..." or file contents on stdin`,
    );
  }
  return readFileSync(0, "utf8");
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
