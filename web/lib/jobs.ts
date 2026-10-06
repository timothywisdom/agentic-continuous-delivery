import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { kitRoot, repoRoot } from "./session";

export type LogChunk = {
  t: string;
  stream: "stdout" | "stderr" | "system" | "telemetry";
  text: string;
};

export type JobRecord = {
  id: string;
  argv: string[];
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  logs: LogChunk[];
};

type InternalJob = JobRecord & {
  listeners: Set<(chunk: LogChunk | { done: true; exitCode: number | null }) => void>;
};

const g = globalThis as typeof globalThis & { __acdJobs?: Map<string, InternalJob> };

function jobs(): Map<string, InternalJob> {
  if (!g.__acdJobs) g.__acdJobs = new Map();
  return g.__acdJobs;
}

export function getJob(id: string): JobRecord | null {
  const job = jobs().get(id);
  if (!job) return null;
  const { listeners: _l, ...rest } = job;
  return rest;
}

export function startCliJob(argv: string[], stdin?: string): JobRecord {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const job: InternalJob = {
    id,
    argv,
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    logs: [],
    listeners: new Set(),
  };
  jobs().set(id, job);

  const bin = join(kitRoot(), "bin", "acd.js");
  if (!existsSync(bin)) {
    emit(job, {
      t: new Date().toISOString(),
      stream: "system",
      text: `acd binary missing at ${bin}`,
    });
    finish(job, 127);
    return publicJob(job);
  }

  const args = argv.includes("--repo-root")
    ? argv
    : [...argv, "--repo-root", repoRoot()];

  emit(job, {
    t: new Date().toISOString(),
    stream: "system",
    text: `$ acd ${args.join(" ")}\n`,
  });

  const child = spawn(process.execPath, [bin, ...args], {
    cwd: repoRoot(),
    env: {
      ...process.env,
      ACD_OTEL_UI: "1",
      ACD_REPO_ROOT: repoRoot(),
    },
    stdio: [stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
  });

  if (stdin !== undefined) {
    child.stdin?.write(stdin, "utf8");
    child.stdin?.end();
  }

  const onStdout = (buf: Buffer) => {
    const text = buf.toString("utf8");
    if (!text) return;
    emit(job, { t: new Date().toISOString(), stream: "stdout", text });
  };
  let stderrBuf = "";
  const onStderr = (buf: Buffer) => {
    stderrBuf += buf.toString("utf8");
    const lines = stderrBuf.split("\n");
    stderrBuf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("acd.telemetry ")) {
        emit(job, {
          t: new Date().toISOString(),
          stream: "telemetry",
          text: `${line.slice("acd.telemetry ".length)}\n`,
        });
      } else {
        emit(job, {
          t: new Date().toISOString(),
          stream: "stderr",
          text: `${line}\n`,
        });
      }
    }
  };
  child.stdout?.on("data", onStdout);
  child.stderr?.on("data", onStderr);
  child.on("error", (err) => {
    emit(job, {
      t: new Date().toISOString(),
      stream: "system",
      text: err.message,
    });
    finish(job, 1);
  });
  child.on("close", (code) => {
    if (stderrBuf) {
      if (stderrBuf.startsWith("acd.telemetry ")) {
        emit(job, {
          t: new Date().toISOString(),
          stream: "telemetry",
          text: `${stderrBuf.slice("acd.telemetry ".length)}\n`,
        });
      } else {
        emit(job, {
          t: new Date().toISOString(),
          stream: "stderr",
          text: stderrBuf,
        });
      }
      stderrBuf = "";
    }
    finish(job, code);
  });

  return publicJob(job);
}

export function subscribeJob(
  id: string,
  listener: (chunk: LogChunk | { done: true; exitCode: number | null }) => void,
): () => void {
  const job = jobs().get(id);
  if (!job) {
    listener({ done: true, exitCode: null });
    return () => {};
  }
  for (const log of job.logs) listener(log);
  if (job.exitCode !== null) {
    listener({ done: true, exitCode: job.exitCode });
    return () => {};
  }
  job.listeners.add(listener);
  return () => job.listeners.delete(listener);
}

function emit(job: InternalJob, chunk: LogChunk): void {
  job.logs.push(chunk);
  for (const listener of job.listeners) listener(chunk);
}

function finish(job: InternalJob, code: number | null): void {
  if (job.exitCode !== null) return;
  job.exitCode = code;
  job.endedAt = new Date().toISOString();
  for (const listener of job.listeners) {
    listener({ done: true, exitCode: code });
  }
  job.listeners.clear();
}

function publicJob(job: InternalJob): JobRecord {
  const { listeners: _l, ...rest } = job;
  return rest;
}
