import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertUnderRepo,
  expandOpenCommand,
  listVscodeIpcHooks,
  openInEditor,
  resolveOpenCommandTemplate,
} from "../src/ui/open-editor.js";

describe("assertUnderRepo", () => {
  it("resolves a repo-relative path and rejects escapes", () => {
    const repo = mkdtempSync(join(tmpdir(), "acd-open-repo-"));
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "a.js"), "export {}\n");

    expect(assertUnderRepo(repo, "src/a.js")).toBe(resolve(repo, "src/a.js"));
    expect(assertUnderRepo(repo, join(repo, "src", "a.js"))).toBe(
      resolve(repo, "src/a.js"),
    );
    expect(() => assertUnderRepo(repo, "../outside.js")).toThrow(/outside|repo/i);
    expect(() => assertUnderRepo(repo, "src/missing.js")).toThrow(/does not exist/i);
  });
});

describe("resolveOpenCommandTemplate", () => {
  it("prefers config openCommand, then ACD_EDITOR, then a discovered editor", () => {
    expect(
      resolveOpenCommandTemplate({
        openCommand: "nvim +{line} {file}",
        env: { ACD_EDITOR: "code -g {location}" },
        available: () => true,
      }),
    ).toBe("nvim +{line} {file}");

    expect(
      resolveOpenCommandTemplate({
        openCommand: null,
        env: { ACD_EDITOR: "code -g {location}" },
        available: () => true,
      }),
    ).toBe("code -g {location}");

    expect(
      resolveOpenCommandTemplate({
        openCommand: null,
        env: {},
        available: (bin) => bin === "cursor",
      }),
    ).toBe("cursor -g {location}");

    expect(
      resolveOpenCommandTemplate({
        openCommand: null,
        env: {},
        available: (bin) => bin === "code",
      }),
    ).toBe("code -g {location}");

    expect(() =>
      resolveOpenCommandTemplate({
        openCommand: null,
        env: {},
        available: () => false,
      }),
    ).toThrow(/ACD_EDITOR|openCommand/i);
  });

  it("ignores interactive EDITOR=vi so UI open can use cursor", () => {
    expect(
      resolveOpenCommandTemplate({
        openCommand: null,
        env: { EDITOR: "vi" },
        available: (bin) => bin === "cursor",
      }),
    ).toBe("cursor -g {location}");
  });
});

describe("expandOpenCommand", () => {
  it("expands {file}, {line}, and {location} into argv", () => {
    expect(expandOpenCommand("cursor -g {location}", "/repo/a.js", 9)).toEqual([
      "cursor",
      "-g",
      "/repo/a.js:9",
    ]);
    expect(expandOpenCommand("nvim +{line} {file}", "/repo/a.js", 9)).toEqual([
      "nvim",
      "+9",
      "/repo/a.js",
    ]);
    expect(expandOpenCommand("cursor -g {location}", "/repo/a.js", null)).toEqual([
      "cursor",
      "-g",
      "/repo/a.js",
    ]);
  });
});

describe("listVscodeIpcHooks", () => {
  it("returns vscode-ipc sockets newest first", () => {
    const dir = mkdtempSync(join(tmpdir(), "acd-ipc-"));
    writeFileSync(join(dir, "vscode-ipc-old.sock"), "");
    const newer = join(dir, "vscode-ipc-new.sock");
    writeFileSync(newer, "");
    utimesSync(join(dir, "vscode-ipc-old.sock"), 1, 1);
    utimesSync(newer, 2, 2);

    expect(listVscodeIpcHooks(dir)).toEqual([newer, join(dir, "vscode-ipc-old.sock")]);
  });
});

describe("openInEditor", () => {
  it("runs the resolved command for a path under the repo", async () => {
    const repo = mkdtempSync(join(tmpdir(), "acd-open-run-"));
    writeFileSync(join(repo, "package.json"), "{}\n");
    const calls: string[][] = [];

    const result = await openInEditor({
      repoRoot: repo,
      file: "package.json",
      line: 9,
      openCommand: "cursor -g {location}",
      run: async (argv) => {
        calls.push(argv);
        return { ok: true };
      },
    });

    expect(result.ok).toBe(true);
    expect(result.file).toBe(resolve(repo, "package.json"));
    expect(result.line).toBe(9);
    expect(result.command).toBe(`cursor -g ${resolve(repo, "package.json")}:9`);
    expect(calls).toEqual([["cursor", "-g", `${resolve(repo, "package.json")}:9`]]);
  });

  it("retries cursor/code with discovered IPC hooks until one works", async () => {
    const repo = mkdtempSync(join(tmpdir(), "acd-open-ipc-"));
    const runtime = mkdtempSync(join(tmpdir(), "acd-ipc-run-"));
    writeFileSync(join(repo, "a.ts"), "x\n");
    const stale = join(runtime, "vscode-ipc-stale.sock");
    const live = join(runtime, "vscode-ipc-live.sock");
    writeFileSync(stale, "");
    writeFileSync(live, "");
    utimesSync(stale, 1, 1);
    utimesSync(live, 2, 2);

    const hooksTried: Array<string | undefined> = [];
    const result = await openInEditor({
      repoRoot: repo,
      file: "a.ts",
      line: 3,
      openCommand: "cursor -g {location}",
      env: { VSCODE_IPC_HOOK_CLI: stale },
      runtimeDir: runtime,
      ipcAlive: async (hook) => hook === stale || hook === live,
      run: async (_argv, env) => {
        hooksTried.push(env.VSCODE_IPC_HOOK_CLI);
        if (env.VSCODE_IPC_HOOK_CLI === live) return { ok: true };
        return { ok: false, detail: "Unable to connect to VS Code server" };
      },
    });

    expect(result.ok).toBe(true);
    expect(hooksTried[0]).toBe(stale);
    expect(hooksTried).toContain(live);
  });

  it("surfaces runner failures without throwing", async () => {
    const repo = mkdtempSync(join(tmpdir(), "acd-open-fail-"));
    writeFileSync(join(repo, "a.ts"), "x\n");

    const result = await openInEditor({
      repoRoot: repo,
      file: "a.ts",
      line: 1,
      openCommand: "missing-editor {file}",
      run: async () => ({ ok: false, detail: "spawn missing-editor ENOENT" }),
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/ENOENT|missing-editor/);
  });
});
