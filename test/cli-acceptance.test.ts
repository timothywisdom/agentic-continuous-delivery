import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { V1_STUBS } from "../src/types/stages.js";

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(kitRoot, "bin/acd.js");
const exercised = new Set<string>();

function commandsInCli(): string[] {
  const source = readFileSync(join(kitRoot, "src/cli/index.ts"), "utf8");
  const found = new Set<string>(V1_STUBS);
  for (const match of source.matchAll(/cmd === "([^"]+)"/g)) {
    const name = match[1] ?? "";
    if (name && name !== "--help" && name !== "-h") found.add(name);
  }
  return [...found];
}

function baseEnv(repo: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OTEL_SDK_DISABLED: "true",
    ACD_REPO_ROOT: repo,
    ...extra,
  };
  delete env.ACD_HARNESS;
  delete env.ACD_TIER;
  delete env.ACD_APPROVE_POLICY;
  delete env.ACD_STUB_CLASSIFY_FAILS;
  delete env.ACD_STUB_REVIEW_PAYLOAD;
  delete env.ACD_OTEL_CONSOLE;
  delete env.ACD_OTEL_UI;
  for (const [key, value] of Object.entries(extra)) env[key] = value;
  return env;
}

function run(
  repo: string,
  args: string[],
  opts: { status?: number; input?: string; env?: Record<string, string> } = {},
): { stdout: string; stderr: string } {
  const command = args[0];
  if (command) exercised.add(command);
  const res = spawnSync(process.execPath, [bin, ...args], {
    cwd: repo,
    encoding: "utf8",
    input: opts.input,
    env: baseEnv(repo, opts.env),
  });
  const status = res.status ?? 1;
  const expected = opts.status ?? 0;
  if (status !== expected) {
    throw new Error(
      `acd ${args.join(" ")} exited ${status}, expected ${expected}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
    );
  }
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function jsonOf(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout) as Record<string, unknown>;
}

function writePins(repo: string, testCommand: string): void {
  writeFileSync(
    join(repo, ".acd", "acd.config.local.yaml"),
    `defaults:\n  hitl: none\nrepo:\n  testCommand: ${JSON.stringify(testCommand)}\n  lintCommand: "true"\n`,
  );
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function killGroup(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}

describe("CLI acceptance", () => {
  afterAll(() => {
    const missing = commandsInCli().filter((name) => !exercised.has(name));
    expect(missing, `commands with no acceptance run: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("prints every command and parameter from help, --help, and -h", () => {
    const repo = mkdtempSync(join(tmpdir(), "acd-help-"));
    const texts = ["help", "--help", "-h"].map((flag) => run(repo, [flag]).stdout);
    const required = [
      ...commandsInCli(),
      "--cursor",
      "--github",
      "--from",
      "--artifact",
      "--scenario",
      "--reason",
      "--note",
      "--continue",
      "--work-id",
      "--harness",
      "--tier",
      "--approve-policy",
      "--require-approval",
      "--no-require-approval",
      "--repo-root",
      "--contents",
      "--port",
      "intent|behavior|feature|acceptance|all",
      "classify|low|med|high",
    ];
    for (const text of texts) {
      for (const token of required) {
        expect(text, `missing ${token}`).toContain(token);
      }
    }
  }, 20_000);

  it("init honors dir, --repo-root, --cursor, and --github", () => {
    const parent = mkdtempSync(join(tmpdir(), "acd-init-"));
    const viaRoot = join(parent, "via-root");
    run(parent, ["init", "--repo-root", viaRoot]);
    expect(existsSync(join(viaRoot, ".acd", "acd.config.yaml"))).toBe(true);
    expect(existsSync(join(viaRoot, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(viaRoot, ".github"))).toBe(false);

    const viaDir = join(parent, "via-dir");
    run(parent, ["init", viaDir, "--cursor", "--github"]);
    expect(existsSync(join(viaDir, ".acd", "system-constraints.yaml"))).toBe(true);
    expect(existsSync(join(viaDir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(viaDir, ".cursor", "rules"))).toBe(true);
    expect(existsSync(join(viaDir, ".github", "workflows", "acd-ci-review.yml"))).toBe(
      true,
    );
  }, 20_000);

  it("config applies harness, tier, approval policy, and --repo-root", () => {
    const repo = mkdtempSync(join(tmpdir(), "acd-config-"));
    run(repo, ["init"]);
    const elsewhere = mkdtempSync(join(tmpdir(), "acd-cwd-"));

    const fromOtherCwd = spawnSync(
      process.execPath,
      [bin, "config", "--repo-root", repo],
      { cwd: elsewhere, encoding: "utf8", env: baseEnv(repo) },
    );
    exercised.add("config");
    expect(fromOtherCwd.status).toBe(0);
    const viaRoot = jsonOf(fromOtherCwd.stdout ?? "");
    expect((viaRoot.defaults as { harness: string }).harness).toBe("stub");

    const cursor = jsonOf(run(repo, ["config", "--harness", "cursor"]).stdout);
    expect((cursor.defaults as { harness: string }).harness).toBe("cursor");
    const agents = cursor.agents as Record<string, { harness: string; tier: string }>;
    expect(agents.implementation?.harness).toBe("cursor");

    for (const tier of ["classify", "low", "med", "high"]) {
      const described = jsonOf(run(repo, ["config", "--tier", tier]).stdout);
      const impl = (described.agents as Record<string, { tier: string }>).implementation;
      expect(impl?.tier).toBe(tier);
    }

    const all = jsonOf(run(repo, ["config", "--approve-policy", "all"]).stdout);
    expect(
      (all.stages as Record<string, { require_human_approval: boolean }>).implement
        ?.require_human_approval,
    ).toBe(true);
    const none = jsonOf(run(repo, ["config", "--approve-policy", "none"]).stdout);
    expect(
      (none.stages as Record<string, { require_human_approval: boolean }>).specify
        ?.require_human_approval,
    ).toBe(false);

    const required = jsonOf(run(repo, ["config", "--require-approval"]).stdout);
    expect(
      (required.stages as Record<string, { require_human_approval: boolean }>).review
        ?.require_human_approval,
    ).toBe(true);
    const skipped = jsonOf(run(repo, ["config", "--no-require-approval"]).stdout);
    expect(
      (skipped.stages as Record<string, { require_human_approval: boolean }>).review
        ?.require_human_approval,
    ).toBe(false);

    const unknown = jsonOf(run(repo, ["config", "--harness", "not-a-harness"]).stdout);
    expect((unknown.defaults as { harness: string }).harness).toBe("not-a-harness");
    const broken = (unknown.agents as Record<string, { error?: string }>).implementation;
    expect(broken?.error).toMatch(/Unknown harness/);
  }, 30_000);

  it("runs every work-item command and the parameters that change its behavior", () => {
    const repo = mkdtempSync(join(tmpdir(), "acd-cli-"));
    run(repo, ["init"]);
    writePins(repo, "true");

    expect(run(repo, ["intake"], { status: 1 }).stderr).toMatch(/--from/);

    const intake = jsonOf(
      run(repo, [
        "intake",
        "--from",
        "Build a calculator web app",
        "--harness",
        "stub",
        "--tier",
        "low",
      ]).stdout,
    );
    const workId = (intake.output as { workId: string }).workId;
    expect(workId).toBeTruthy();

    const intentOnly = jsonOf(
      run(repo, [
        "specify",
        "--artifact",
        "intent",
        "--work-id",
        workId,
        "--require-approval",
      ]).stdout,
    );
    expect((intentOnly.state as { awaitingApproval: string }).awaitingApproval).toBe(
      "specify",
    );
    const behaviorAfterIntent = readFileSync(
      join(repo, ".acd", "work", workId, "behavior.feature"),
      "utf8",
    );
    expect(behaviorAfterIntent).toContain("[observable outcome]");
    expect(behaviorAfterIntent).not.toContain("observable outcome in the intent");

    run(repo, ["reject", "specify", "--reason", "draft the rest", "--work-id", workId]);

    run(repo, ["specify", "--artifact", "behavior", "--work-id", workId]);
    expect(
      readFileSync(join(repo, ".acd", "work", workId, "behavior.feature"), "utf8"),
    ).toContain("observable outcome in the intent");

    run(repo, ["specify", "--artifact", "feature", "--work-id", workId]);
    expect(readFileSync(join(repo, ".acd", "work", workId, "feature.md"), "utf8")).toContain(
      "Implement only the behavior described in the intent",
    );

    run(repo, ["specify", "--artifact", "acceptance", "--work-id", workId]);
    expect(
      readFileSync(join(repo, ".acd", "work", workId, "acceptance.md"), "utf8"),
    ).toContain("Done definition");

    expect(run(repo, ["specify", "--artifact", "nope", "--work-id", workId], { status: 1 }).stderr)
      .toMatch(/artifact|Invalid|enum/i);

    const specified = jsonOf(
      run(repo, ["specify", "--artifact", "all", "--work-id", workId, "--approve-policy", "none"])
        .stdout,
    );
    expect((specified.state as { awaitingApproval: string | null }).awaitingApproval).toBe(
      null,
    );

    const one = jsonOf(
      run(repo, ["implement", "--scenario", "1", "--work-id", workId]).stdout,
    );
    expect((one.output as { scenariosCompleted: number[] }).scenariosCompleted).toEqual([1]);

    const rest = jsonOf(run(repo, ["implement", "--work-id", workId]).stdout);
    expect((rest.output as { scenariosCompleted: number[] }).scenariosCompleted).toEqual([
      2,
    ]);

    const again = jsonOf(
      run(repo, ["implement", "--scenario", "1", "--work-id", workId]).stdout,
    );
    expect((again.output as { scenario: number }).scenario).toBe(1);

    const review = jsonOf(run(repo, ["review", "--work-id", workId]).stdout);
    expect((review.output as { decision: string }).decision).toBe("pass");

    const pr = jsonOf(run(repo, ["pr", "--work-id", workId]).stdout);
    expect((pr.output as { created: boolean }).created).toBe(false);
    expect((pr.output as { body: string }).body).toContain(workId);

    const ci = jsonOf(run(repo, ["ci-review", "--work-id", workId]).stdout);
    expect((ci.output as { decision: string }).decision).toBe("pass");
    const ciAlias = jsonOf(run(repo, ["ci_review", "--work-id", workId]).stdout);
    expect((ciAlias.output as { decision: string }).decision).toBe("pass");

    const blocked = jsonOf(
      run(repo, ["review", "--work-id", workId], {
        status: 1,
        env: {
          ACD_STUB_REVIEW_PAYLOAD: JSON.stringify({
            semantic_review: {
              decision: "block",
              findings: [
                {
                  file: "behavior.feature",
                  line: 1,
                  issue: "missing error state",
                  why: "users need a visible error",
                },
              ],
            },
            default: { decision: "pass", findings: [] },
          }),
        },
      }).stdout,
    );
    expect((blocked.output as { decision: string }).decision).toBe("block");

    const revised = jsonOf(run(repo, ["revise", "--work-id", workId]).stdout);
    expect((revised.addedScenarios as unknown[]).length).toBeGreaterThan(0);
    expect((revised.implementQueue as unknown[]).length).toBeGreaterThan(0);

    writePins(repo, "false");
    const red = jsonOf(
      run(repo, ["implement", "--scenario", "1", "--work-id", workId]).stdout,
    );
    expect((red.state as { pipelineStatus: string }).pipelineStatus).toBe("red");
    expect(run(repo, ["test"], { status: 1 }).stdout).toMatch(/"ok": false/);
    expect(run(repo, ["specify", "--work-id", workId], { status: 1 }).stderr).toMatch(
      /acd fix/,
    );
    const stillRed = jsonOf(run(repo, ["fix", "--work-id", workId], { status: 1 }).stdout);
    expect((stillRed.output as { pipelineStatus: string }).pipelineStatus).toBe("red");

    writePins(repo, "true");
    expect(jsonOf(run(repo, ["test"]).stdout).ok).toBe(true);
    const fixed = jsonOf(run(repo, ["fix", "--work-id", workId]).stdout);
    expect((fixed.output as { pipelineStatus: string }).pipelineStatus).toBe("green");

    const second = jsonOf(
      run(repo, ["intake", "--from", "A second work item"]).stdout,
    );
    const work2 = (second.output as { workId: string }).workId;
    expect(work2).not.toBe(workId);

    const listed = jsonOf(run(repo, ["list"]).stdout);
    expect(listed.workIds).toEqual([workId, work2].sort());
    expect([workId, work2]).toContain(listed.latest);

    const latestStatus = jsonOf(run(repo, ["status"]).stdout);
    expect((latestStatus.state as { id: string }).id).toBe(listed.latest);
    const positional = jsonOf(run(repo, ["status", workId]).stdout);
    expect((positional.state as { id: string }).id).toBe(workId);
    const flagged = jsonOf(run(repo, ["status", "--work-id", workId]).stdout);
    expect((flagged.state as { id: string }).id).toBe(workId);

    expect((jsonOf(run(repo, ["artifacts", workId]).stdout).artifacts as { name: string }[]).map((a) => a.name)).toContain(
      "intent.md",
    );
    expect(
      jsonOf(run(repo, ["artifacts", "--work-id", work2]).stdout).workId,
    ).toBe(work2);

    expect(
      (jsonOf(run(repo, ["events", workId]).stdout).events as { type: string }[]).some(
        (event) => event.type === "intake.created",
      ),
    ).toBe(true);
    expect(jsonOf(run(repo, ["events", "--work-id", work2]).stdout).workId).toBe(work2);

    expect(
      (jsonOf(run(repo, ["reviews", workId]).stdout).reviews as unknown[]).length,
    ).toBeGreaterThan(0);
    expect(jsonOf(run(repo, ["reviews", "--work-id", work2]).stdout).workId).toBe(work2);

    const saved = jsonOf(
      run(repo, ["artifact-save", "intent.md", "--work-id", workId, "--contents", "hello"]).stdout,
    );
    expect(saved.bytes).toBe(5);
    expect(readFileSync(join(repo, ".acd", "work", workId, "intent.md"), "utf8")).toContain(
      "hello",
    );

    const piped = jsonOf(
      run(repo, ["artifact-save", "feature.md", work2], { input: "from stdin" }).stdout,
    );
    expect(piped.workId).toBe(work2);
    expect(readFileSync(join(repo, ".acd", "work", work2, "feature.md"), "utf8")).toContain(
      "from stdin",
    );

    expect(run(repo, ["artifact-save"], { status: 1 }).stderr).toMatch(/file name/);
    expect(
      run(repo, ["artifact-save", "state.json", "--contents", "{}", "--work-id", workId], {
        status: 1,
      }).stderr,
    ).toMatch(/Invalid artifact name/);

    expect(run(repo, ["approve"], { status: 1 }).stderr).toMatch(/requires a stage/);
    expect(run(repo, ["approve", "not-a-stage"], { status: 1 }).stderr).toMatch(/requires a stage/);
    expect(run(repo, ["reject"], { status: 1 }).stderr).toMatch(/requires a stage/);
    expect(run(repo, ["amend"], { status: 1 }).stderr).toMatch(/requires a stage/);

    run(repo, ["specify", "--work-id", work2, "--require-approval"]);
    const defaultReject = jsonOf(run(repo, ["reject", "specify", "--work-id", work2]).stdout);
    expect(defaultReject.lastError).toBe("rejected");

    run(repo, ["specify", "--work-id", work2, "--require-approval"]);
    const reasoned = jsonOf(
      run(repo, ["reject", "specify", "--reason", "Split the spec", "--work-id", work2]).stdout,
    );
    expect(reasoned.lastError).toBe("Split the spec");
    expect(
      (reasoned.rejectedStages as { reason: string }[]).some(
        (row) => row.reason === "Split the spec",
      ),
    ).toBe(true);

    run(repo, ["specify", "--work-id", work2, "--require-approval"]);
    const amended = jsonOf(
      run(repo, [
        "amend",
        "specify",
        "--note",
        "Keep it small",
        "--continue",
        "--require-approval",
        "--work-id",
        work2,
      ]).stdout,
    );
    expect((amended.amended as { guidanceNote: string }).guidanceNote).toBe("Keep it small");
    expect((amended.continued as { awaitingApproval: boolean }).awaitingApproval).toBe(true);

    const approved = jsonOf(run(repo, ["approve", "specify", "--work-id", work2]).stdout);
    expect(approved.approvedStages).toContain("specify");
    expect(approved.awaitingApproval).toBeNull();

    for (const stub of ["deploy", "canary", "rollback", "hypothesis"]) {
      expect(run(repo, [stub], { status: 1 }).stderr).toMatch(/not implemented in v1/);
    }

    expect(run(repo, ["no-such-command"], { status: 1 }).stderr).toMatch(/Unknown command/);
  }, 180_000);

  it("ci-review with no work items runs tests only", () => {
    const repo = mkdtempSync(join(tmpdir(), "acd-empty-"));
    run(repo, ["init"]);
    writePins(repo, "true");
    const payload = jsonOf(run(repo, ["ci-review"]).stdout);
    expect(payload.note).toMatch(/No ACD work items/);
    expect(payload.decision).toBe("pass");

    writePins(repo, "false");
    const failed = jsonOf(run(repo, ["ci_review"], { status: 1 }).stdout);
    expect(failed.decision).toBe("block");
    expect(failed.testsOk).toBe(false);
  }, 20_000);

  it("write-schemas writes the kit schema directory", () => {
    const repo = mkdtempSync(join(tmpdir(), "acd-schemas-"));
    expect(run(repo, ["write-schemas"]).stdout).toMatch(/Wrote acd\/schemas/);
    expect(existsSync(join(kitRoot, "acd", "schemas", "work-state.schema.json"))).toBe(true);
  });

  it("ui honors --port and --repo-root", async () => {
    const repo = mkdtempSync(join(tmpdir(), "acd-ui-"));
    run(repo, ["init"]);
    const port = await freePort();
    const child = spawn(
      process.execPath,
      [bin, "ui", "--port", String(port), "--repo-root", repo],
      {
        cwd: repo,
        detached: true,
        env: baseEnv(repo),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    exercised.add("ui");
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    const started = Date.now();
    try {
      while (!output.includes(`http://127.0.0.1:${port}`) || !output.includes(repo)) {
        if (Date.now() - started > 20_000) {
          throw new Error(`ui did not announce its port\n${output}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      killGroup(child);
    }
  }, 30_000);
});
