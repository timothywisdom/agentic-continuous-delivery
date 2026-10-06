"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CSRF_HEADER } from "../../dist/ui/security.js";
import {
  graphNodeEmphasis,
  isStageName,
  nextPipelineStage,
  stageGraphEdges,
  stageGraphNodes,
} from "../../dist/ui/cli-args.js";
import { ArtifactPane, type Artifact } from "./artifact-pane";
import { TelemetryPane } from "./telemetry-pane";
import type { TelemetrySpanRecord } from "../../dist/telemetry/record.js";

type WorkState = {
  id: string;
  currentStage: string;
  completedStages: string[];
  pipelineStatus: string;
  awaitingApproval: string | null;
  awaitingGuidance: string | null;
  lastError: string | null;
  guidanceNote: string | null;
};

type LogLine = { stream: string; text: string };

const COMMANDS = [
  "intake",
  "specify",
  "implement",
  "review",
  "pr",
  "ci-review",
  "fix",
  "approve",
  "reject",
  "amend",
  "status",
  "list",
  "artifacts",
  "test",
  "config",
] as const;

type Command = (typeof COMMANDS)[number];

const NODE_POS: Record<string, { x: number; y: number }> = {
  intake: { x: 16, y: 28 },
  specify: { x: 168, y: 28 },
  implement: { x: 320, y: 28 },
  review: { x: 472, y: 28 },
  pr: { x: 624, y: 28 },
  ci_review: { x: 776, y: 28 },
  fix: { x: 320, y: 108 },
  deploy: { x: 776, y: 108 },
  canary: { x: 888, y: 108 },
  rollback: { x: 1000, y: 108 },
  hypothesis: { x: 888, y: 168 },
};

function nodeClass(id: string, state: WorkState | null): string {
  const kind = id === "fix" ? "fix" : NODE_POS[id] && ["deploy", "canary", "rollback", "hypothesis"].includes(id)
    ? "stub"
    : "pipeline";
  const classes = ["node", kind];
  if (!state) return classes.join(" ");
  const emphasis = graphNodeEmphasis(id, state);
  if (emphasis) classes.push(emphasis);
  return classes.join(" ");
}

export function Console() {
  const [token, setToken] = useState<string | null>(null);
  const [repo, setRepo] = useState<string>("");
  const [repoDraft, setRepoDraft] = useState<string>("");
  const [bootError, setBootError] = useState<string | null>(null);
  const [workIds, setWorkIds] = useState<string[]>([]);
  const [workId, setWorkId] = useState<string>("");
  const [state, setState] = useState<WorkState | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [command, setCommand] = useState<Command>("status");
  const [fromText, setFromText] = useState("");
  const [artifact, setArtifact] = useState("all");
  const [scenario, setScenario] = useState("");
  const [stageArg, setStageArg] = useState("specify");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [continueAmend, setContinueAmend] = useState(true);
  const [harness, setHarness] = useState("");
  const [tier, setTier] = useState("");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [spans, setSpans] = useState<TelemetrySpanRecord[]>([]);
  const [running, setRunning] = useState(false);
  const [savingName, setSavingName] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    fetch("/api/session", { credentials: "same-origin" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Session failed");
        setToken(json.token);
        setRepo(json.repoRoot ?? "");
        setRepoDraft(json.repoRoot ?? "");
      })
      .catch((err: Error) => setBootError(err.message));
  }, []);

  const snapshot = useCallback(async (lockWorkId?: string) => {
    if (!token) return;
    try {
      const listJson = await runAndParse(token, { command: "list" }, silentLog);
      const ids = (listJson as { workIds?: string[] }).workIds ?? [];
      setWorkIds(ids);
      const wanted = lockWorkId !== undefined ? lockWorkId : workId;
      const selected = wanted && ids.includes(wanted) ? wanted : (ids.at(-1) ?? "");
      if (selected !== workId) setWorkId(selected);
      if (!selected) {
        setState(null);
        setArtifacts([]);
        return;
      }
      const statusJson = await runAndParse(
        token,
        { command: "status", args: [selected] },
        silentLog,
      );
      const st = (statusJson as { state?: WorkState }).state;
      if (st) setState(st);
      const artJson = await runAndParse(
        token,
        { command: "artifacts", args: [selected] },
        silentLog,
      );
      setArtifacts((artJson as { artifacts?: Artifact[] }).artifacts ?? []);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    }
  }, [token, workId]);

  useEffect(() => {
    if (token) void snapshot();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [logs]);

  const runSelected = async () => {
    if (!token) return;
    setRunning(true);
    setRunError(null);
    setLogs([]);
    setSpans([]);
    try {
      const body = buildBody({
        command,
        workId,
        fromText,
        artifact,
        scenario,
        stageArg,
        reason,
        note,
        continueAmend,
        harness,
        tier,
      });
      await runAndParse(token, body, setLogs, setSpans);
      await snapshot();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const applyRepo = async () => {
    if (!token) return;
    setRunError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          [CSRF_HEADER]: token,
        },
        body: JSON.stringify({ repoRoot: repoDraft }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not set repo");
      setRepo(json.repoRoot);
      setRepoDraft(json.repoRoot);
      setWorkId("");
      setState(null);
      setArtifacts([]);
      setWorkIds([]);
      await snapshot("");
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    }
  };

  const pauseLabel = useMemo(() => {
    if (!state) return "No work item yet — run intake.";
    if (state.pipelineStatus === "red") return "Pipeline red — only fix is legal.";
    if (state.awaitingGuidance) {
      return `Needs guidance on ${state.awaitingGuidance}. Use amend + note.`;
    }
    if (state.awaitingApproval) {
      return `Awaiting approval of ${state.awaitingApproval}. Approve, reject, or amend.`;
    }
    if (state.completedStages.includes(state.currentStage)) {
      const next = isStageName(state.currentStage)
        ? nextPipelineStage(state.currentStage)
        : null;
      return next
        ? `${state.currentStage} is approved. Pipeline ${state.pipelineStatus}. Next: ${next}.`
        : `${state.currentStage} is approved. Pipeline ${state.pipelineStatus}.`;
    }
    return `Current stage: ${state.currentStage} (${state.pipelineStatus}).`;
  }, [state]);

  if (bootError) {
    return (
      <div className="shell">
        <p className="error-line">{bootError}</p>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <h1>ACD console</h1>
          <p>Optional UI. Every action runs the CLI on 127.0.0.1.</p>
        </div>
        <form
          className="repo-form"
          onSubmit={(e) => {
            e.preventDefault();
            void applyRepo();
          }}
        >
          <label>
            Target repo
            <input
              value={repoDraft}
              onChange={(e) => setRepoDraft(e.target.value)}
              spellCheck={false}
              placeholder="/home/you/source/dj-simulator"
            />
          </label>
          <button type="submit" disabled={running || !token || repoDraft === repo}>
            Use this repo
          </button>
          <div className="work-id">{workId || "no work item"}</div>
        </form>
      </header>

      <section className="graph-wrap">
        <Graph state={state} onSelect={(id) => setCommand(graphCommand(id))} />
        <div className="legend">
          <span className="l-done">completed</span>
          <span className="l-now">current</span>
          <span className="l-wait">awaiting human</span>
          <span className="l-stub">v1 stub</span>
        </div>
      </section>

      <div className={`banner ${state?.pipelineStatus === "red" ? "err" : state?.awaitingGuidance || state?.awaitingApproval ? "warn" : ""}`}>
        {pauseLabel}
        {state?.lastError ? ` — ${state.lastError}` : ""}
      </div>

      <div className="main">
        <aside className="panel drive-panel">
          <h2>Drive CLI</h2>
          <div className="panel-body">
            <label>
              Work item
              <select value={workId} onChange={(e) => setWorkId(e.target.value)}>
                {workIds.length === 0 ? <option value="">(none)</option> : null}
                {workIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Command
              <select
                value={command}
                onChange={(e) => setCommand(e.target.value as Command)}
              >
                {COMMANDS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            {command === "intake" ? (
              <label>
                --from
                <textarea
                  value={fromText}
                  onChange={(e) => setFromText(e.target.value)}
                  placeholder="Plain English intent"
                />
              </label>
            ) : null}
            {command === "specify" ? (
              <label>
                --artifact
                <select value={artifact} onChange={(e) => setArtifact(e.target.value)}>
                  {["all", "intent", "behavior", "feature", "acceptance"].map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {command === "implement" ? (
              <label>
                --scenario
                <input
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value)}
                  placeholder="optional"
                />
              </label>
            ) : null}
            {command === "approve" || command === "reject" || command === "amend" ? (
              <label>
                stage
                <select value={stageArg} onChange={(e) => setStageArg(e.target.value)}>
                  {["specify", "review", "pr", "implement"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {command === "reject" ? (
              <label>
                --reason
                <input value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
            ) : null}
            {command === "amend" ? (
              <>
                <label>
                  --note (human guidance)
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
                <label>
                  <span>
                    <input
                      type="checkbox"
                      checked={continueAmend}
                      onChange={(e) => setContinueAmend(e.target.checked)}
                    />{" "}
                    --continue
                  </span>
                </label>
              </>
            ) : null}
            <div className="row">
              <label>
                --harness
                <input
                  value={harness}
                  onChange={(e) => setHarness(e.target.value)}
                  placeholder="optional"
                />
              </label>
              <label>
                --tier
                <input
                  value={tier}
                  onChange={(e) => setTier(e.target.value)}
                  placeholder="optional"
                />
              </label>
            </div>
            <div className="actions">
              <button type="button" className="run-btn" disabled={running} onClick={runSelected}>
                {running ? "Running…" : "Run acd"}
              </button>
              <button type="button" disabled={running || !token} onClick={() => void snapshot()}>
                Refresh
              </button>
            </div>
            {runError ? <div className="error-line">{runError}</div> : null}
          </div>
        </aside>

        <div className="main-right">
        <section className="panel log-panel">
          <h2>CLI output</h2>
          <pre className="log" ref={logRef}>
            {logs.length === 0
              ? "Logs from acd (stdout / stderr) appear here."
              : logs.map((l, i) => (
                  <span key={i} className={l.stream}>
                    {l.text}
                  </span>
                ))}
          </pre>
        </section>
        <TelemetryPane spans={spans} running={running} />
        </div>
      </div>

      <section className="panel">
        <h2>Artifacts</h2>
        <div className="panel-body artifacts">
          {artifacts.length === 0 ? (
            <span className="banner">No artifacts yet.</span>
          ) : (
            artifacts.map((a) => (
              <ArtifactPane
                key={a.name}
                artifact={a}
                fallbackPath={`${repo.replace(/\\/g, "/").replace(/\/$/, "")}/.acd/work/${workId}/${a.name}`}
                saving={savingName === a.name}
                onSave={async (name, contents) => {
                  if (!token) throw new Error("No session");
                  setSavingName(name);
                  setRunError(null);
                  try {
                    const result = await runAndParse(
                      token,
                      {
                        command: "artifact-save",
                        args: [name],
                        flags: workId ? { "work-id": workId } : {},
                        stdin: contents,
                      },
                      setLogs,
                    );
                    if (
                      !result ||
                      typeof result !== "object" ||
                      !("path" in result)
                    ) {
                      throw new Error("Save did not complete through acd artifact-save.");
                    }
                    setArtifacts((prev) =>
                      prev.map((item) =>
                        item.name === name ? { ...item, contents } : item,
                      ),
                    );
                  } finally {
                    setSavingName(null);
                  }
                }}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function Graph({
  state,
  onSelect,
}: {
  state: WorkState | null;
  onSelect: (id: string) => void;
}) {
  const nodes = stageGraphNodes();
  const edges = stageGraphEdges();
  return (
    <svg className="graph" viewBox="0 0 1120 220" role="img" aria-label="ACD state machine">
      {edges.map((e) => {
        const a = NODE_POS[e.from];
        const b = NODE_POS[e.to];
        if (!a || !b) return null;
        return (
          <line
            key={`${e.from}-${e.to}`}
            x1={a.x + 128}
            y1={a.y + 18}
            x2={b.x}
            y2={b.y + 18}
            stroke="#3d4a58"
            strokeWidth="1.5"
          />
        );
      })}
      {nodes.map((n) => {
        const p = NODE_POS[n.id];
        if (!p) return null;
        return (
          <g
            key={n.id}
            className={nodeClass(n.id, state)}
            transform={`translate(${p.x},${p.y})`}
            onClick={() => onSelect(n.id)}
          >
            <rect width="128" height="36" rx="6" />
            <text x="64" y="23" textAnchor="middle">
              {n.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function graphCommand(id: string): Command {
  if (id === "ci_review") return "ci-review";
  if (COMMANDS.includes(id as Command)) return id as Command;
  return "status";
}

function buildBody(opts: {
  command: Command;
  workId: string;
  fromText: string;
  artifact: string;
  scenario: string;
  stageArg: string;
  reason: string;
  note: string;
  continueAmend: boolean;
  harness: string;
  tier: string;
}) {
  const flags: Record<string, string | boolean> = {};
  if (
    opts.workId &&
    opts.command !== "intake" &&
    opts.command !== "list" &&
    opts.command !== "status" &&
    opts.command !== "artifacts"
  ) {
    flags["work-id"] = opts.workId;
  }
  if (opts.harness) flags.harness = opts.harness;
  if (opts.tier) flags.tier = opts.tier;
  const args: string[] = [];
  if (opts.command === "intake") flags.from = opts.fromText;
  if (opts.command === "specify") flags.artifact = opts.artifact;
  if (opts.command === "implement" && opts.scenario) flags.scenario = opts.scenario;
  if (opts.command === "approve" || opts.command === "reject" || opts.command === "amend") {
    args.push(opts.stageArg);
  }
  if (opts.command === "reject") flags.reason = opts.reason || "rejected";
  if (opts.command === "amend") {
    if (opts.note) flags.note = opts.note;
    if (opts.continueAmend) flags.continue = true;
  }
  if (opts.command === "status" && opts.workId) args.push(opts.workId);
  if (opts.command === "artifacts" && opts.workId) args.push(opts.workId);
  return { command: opts.command, args, flags };
}

function silentLog(_fn: (prev: LogLine[]) => LogLine[]): void {}

async function runAndParse(
  token: string,
  body: {
    command: string;
    args?: string[];
    flags?: Record<string, string | boolean>;
    stdin?: string;
  },
  setLogs: (fn: (prev: LogLine[]) => LogLine[]) => void,
  setSpans?: (fn: (prev: TelemetrySpanRecord[]) => TelemetrySpanRecord[]) => void,
): Promise<unknown> {
  const res = await fetch("/api/run", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      [CSRF_HEADER]: token,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Run failed");
  const jobId = json.job.id as string;
  return waitForJob(jobId, token, (line) => {
    if (line.stream === "telemetry") {
      try {
        const span = JSON.parse(line.text.trim()) as TelemetrySpanRecord;
        if (span?.name) setSpans?.((prev) => [...prev, span]);
      } catch {
        /* ignore malformed telemetry */
      }
      return;
    }
    setLogs((prev) => [...prev, line]);
  });
}

async function waitForJob(
  jobId: string,
  token: string,
  onLog: (line: LogLine) => void,
): Promise<unknown> {
  const res = await fetch(`/api/run/${jobId}/stream`, {
    credentials: "same-origin",
    headers: { [CSRF_HEADER]: token },
  });
  if (!res.ok || !res.body) throw new Error("Log stream failed");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let stdout = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const event = JSON.parse(line.slice(6)) as
        | { t?: string; stream?: string; text?: string; done?: boolean; exitCode?: number | null };
      if (event.done) {
        const json = extractJson(stdout);
        if (event.exitCode && event.exitCode !== 0 && event.exitCode !== 2 && !json) {
          throw new Error("acd command failed");
        }
        return json;
      }
      if (event.text) {
        if (event.stream === "stdout") stdout += event.text;
        onLog({ stream: event.stream ?? "stdout", text: event.text });
      }
    }
  }
  return extractJson(stdout);
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return { raw: trimmed };
      }
    }
    return { raw: trimmed };
  }
}
