import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import net from "node:net";
import { delimiter, isAbsolute, join, resolve, sep } from "node:path";

export type OpenCommandRunner = (
  argv: string[],
  env: NodeJS.ProcessEnv,
) => Promise<{ ok: boolean; detail?: string }>;

export interface OpenInEditorInput {
  repoRoot: string;
  /** Absolute or repo-relative path. */
  file: string;
  line?: number | null;
  /** Template from `repo.openCommand`, e.g. `cursor -g {location}`. */
  openCommand?: string | null;
  env?: NodeJS.ProcessEnv;
  /** Override XDG runtime dir (tests); default `XDG_RUNTIME_DIR` or `/run/user/<uid>`. */
  runtimeDir?: string;
  /** Injected for tests; defaults to spawning the argv. */
  run?: OpenCommandRunner;
  available?: (bin: string) => boolean;
  /** Injected for tests; defaults to a short unix-socket connect probe. */
  ipcAlive?: (hookPath: string) => Promise<boolean>;
}

export interface OpenInEditorResult {
  ok: boolean;
  file: string;
  line: number | null;
  command: string;
  detail?: string;
}

const DEFAULT_TEMPLATES = [
  "cursor -g {location}",
  "code -g {location}",
] as const;

const IPC_BINS = new Set(["cursor", "code"]);

/** Resolve `file` under `repoRoot`; reject path escapes and missing files. */
export function assertUnderRepo(repoRoot: string, file: string): string {
  const root = realpathSync(resolve(repoRoot));
  const candidate = isAbsolute(file) ? resolve(file) : resolve(root, file);
  if (!existsSync(candidate)) {
    throw new Error(`Path does not exist: ${candidate}`);
  }
  if (!statSync(candidate).isFile() && !statSync(candidate).isDirectory()) {
    throw new Error(`Not a file: ${candidate}`);
  }
  const abs = realpathSync(candidate);
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (abs !== root && !abs.startsWith(prefix)) {
    throw new Error(`Path is outside the repository: ${abs}`);
  }
  return abs;
}

/**
 * Pick an open command template.
 * Order: config `openCommand` → `ACD_EDITOR` → cursor → code → throw.
 */
export function resolveOpenCommandTemplate(input: {
  openCommand?: string | null;
  env?: NodeJS.ProcessEnv;
  available?: (bin: string) => boolean;
}): string {
  const configured = input.openCommand?.trim();
  if (configured) return configured;

  // Prefer ACD_EDITOR. Ignore bare $EDITOR (often vi/vim) — those hang without a TTY
  // when spawned from the UI server.
  const fromEnv = input.env?.ACD_EDITOR?.trim();
  if (fromEnv) {
    if (!/\s/.test(fromEnv) && !fromEnv.includes("{")) {
      if (fromEnv === "cursor" || fromEnv === "code") {
        return `${fromEnv} -g {location}`;
      }
      return `${fromEnv} {file}`;
    }
    return fromEnv;
  }

  const available = input.available ?? commandOnPath;
  for (const template of DEFAULT_TEMPLATES) {
    const bin = template.split(/\s+/)[0] ?? "";
    if (bin && available(bin)) return template;
  }

  throw new Error(
    "No editor configured. Set repo.openCommand (e.g. \"cursor -g {location}\") or ACD_EDITOR.",
  );
}

/** Expand `{file}`, `{line}`, `{location}` into an argv array. */
export function expandOpenCommand(
  template: string,
  file: string,
  line: number | null,
): string[] {
  const location =
    line != null && line > 0 ? `${file}:${line}` : file;
  const lineText = line != null && line > 0 ? String(line) : "1";
  const expanded = template
    .replaceAll("{location}", location)
    .replaceAll("{file}", file)
    .replaceAll("{line}", lineText);
  return splitArgs(expanded);
}

/** Cursor/VS Code remote-cli sockets under the user runtime dir, newest first. */
export function listVscodeIpcHooks(runtimeDir: string): string[] {
  if (!runtimeDir || !existsSync(runtimeDir)) return [];
  try {
    return readdirSync(runtimeDir)
      .filter((name) => /^vscode-ipc-.*\.sock$/.test(name))
      .map((name) => join(runtimeDir, name))
      .filter((path) => {
        try {
          return existsSync(path);
        } catch {
          return false;
        }
      })
      .sort((a, b) => {
        try {
          return statSync(b).mtimeMs - statSync(a).mtimeMs;
        } catch {
          return 0;
        }
      });
  } catch {
    return [];
  }
}

export function defaultRuntimeDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.XDG_RUNTIME_DIR?.trim()) return env.XDG_RUNTIME_DIR.trim();
  const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
  return `/run/user/${uid}`;
}

export async function openInEditor(
  input: OpenInEditorInput,
): Promise<OpenInEditorResult> {
  const file = assertUnderRepo(input.repoRoot, input.file);
  const line =
    typeof input.line === "number" && Number.isFinite(input.line) && input.line > 0
      ? Math.floor(input.line)
      : null;
  const baseEnv = input.env ?? process.env;
  const template = resolveOpenCommandTemplate({
    openCommand: input.openCommand,
    env: baseEnv,
    available: input.available,
  });
  const argv = expandOpenCommand(template, file, line);
  const command = argv.join(" ");
  const run = input.run ?? spawnOpenCommand;
  const runtimeDir = input.runtimeDir ?? defaultRuntimeDir(baseEnv);
  const attempts = await ipcEnvAttempts(
    argv[0] ?? "",
    baseEnv,
    runtimeDir,
    input.ipcAlive ?? isIpcHookAlive,
  );

  let lastDetail = "";
  for (const env of attempts) {
    const outcome = await run(argv, env);
    if (outcome.ok) {
      return { ok: true, file, line, command };
    }
    lastDetail = outcome.detail ?? lastDetail;
  }

  return {
    ok: false,
    file,
    line,
    command,
    detail:
      lastDetail ||
      "Editor command failed. For Cursor/VS Code remote, ensure the window is connected, or set repo.openCommand.",
  };
}

async function ipcEnvAttempts(
  bin: string,
  baseEnv: NodeJS.ProcessEnv,
  runtimeDir: string,
  ipcAlive: (hookPath: string) => Promise<boolean>,
): Promise<NodeJS.ProcessEnv[]> {
  if (!IPC_BINS.has(bin)) {
    return [baseEnv];
  }

  const hooks: string[] = [];
  const configured = baseEnv.VSCODE_IPC_HOOK_CLI?.trim();
  if (configured) hooks.push(configured);
  for (const hook of listVscodeIpcHooks(runtimeDir)) {
    if (!hooks.includes(hook)) hooks.push(hook);
  }

  const alive: string[] = [];
  for (const hook of hooks) {
    if (await ipcAlive(hook)) alive.push(hook);
    if (alive.length >= 3) break;
  }

  if (alive.length === 0) return [baseEnv];

  return alive.map((hook) => ({
    ...baseEnv,
    VSCODE_IPC_HOOK_CLI: hook,
  }));
}

/** True when a unix socket accepts a connection (filters stale Cursor IPC files). */
export function isIpcHookAlive(
  hookPath: string,
  timeoutMs = 250,
): Promise<boolean> {
  return new Promise((resolvePromise) => {
    if (!hookPath || !existsSync(hookPath)) {
      resolvePromise(false);
      return;
    }
    const socket = net.createConnection(hookPath);
    const timer = setTimeout(() => {
      socket.destroy();
      resolvePromise(false);
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolvePromise(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolvePromise(false);
    });
  });
}

function splitArgs(command: string): string[] {
  const args: string[] = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(command))) {
    args.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  if (args.length === 0) {
    throw new Error(`Empty open command: ${command}`);
  }
  return args;
}

function commandOnPath(bin: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!bin || bin.includes("/") || bin.includes("\\")) {
    return existsSync(bin);
  }
  const pathEnv = env.PATH ?? env.Path ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    if (existsSync(join(dir, bin))) return true;
    if (process.platform === "win32" && existsSync(join(dir, `${bin}.cmd`))) {
      return true;
    }
  }
  return false;
}

function spawnOpenCommand(
  argv: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ ok: boolean; detail?: string }> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (outcome: { ok: boolean; detail?: string }) => {
      if (settled) return;
      settled = true;
      resolvePromise(outcome);
    };

    const child = spawn(argv[0]!, argv.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
      env,
      windowsHide: true,
    });
    let stderr = "";
    let stdout = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.on("error", (err) => {
      finish({ ok: false, detail: err.message });
    });
    child.on("close", (code) => {
      if (code === 0) {
        finish({ ok: true });
        return;
      }
      const detail = (stderr || stdout || `exit ${code ?? "unknown"}`).trim();
      finish({ ok: false, detail: detail.slice(0, 500) });
    });

    // Don't block the UI forever if an editor waits on a TTY / dead IPC.
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        ok: false,
        detail: `Editor command timed out after 3s (${argv.join(" ")})`,
      });
    }, 3_000);
    timer.unref?.();
  });
}
