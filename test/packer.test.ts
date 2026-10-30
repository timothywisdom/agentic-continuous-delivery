import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectRepoFiles,
  contextNeededPath,
  resolveRepoPath,
} from "../src/packer/context.js";

describe("collectRepoFiles", () => {
  it("includes root source files and skips dependency and work-item dirs", () => {
    const root = mkdtempSync(join(tmpdir(), "acd-pack-"));
    writeFileSync(join(root, "calculator.js"), "export function enter() {}\n");
    mkdirSync(join(root, "tests"));
    writeFileSync(join(root, "tests", "add.test.js"), "test()\n");
    mkdirSync(join(root, "node_modules", "leftpad"), { recursive: true });
    writeFileSync(join(root, "node_modules", "leftpad", "index.js"), "nope\n");
    mkdirSync(join(root, ".acd", "work"), { recursive: true });
    writeFileSync(join(root, ".acd", "work", "state.json"), "{}\n");
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "config"), "[core]\n");

    const { files, omitted } = collectRepoFiles(root);
    const paths = files.map((file) => file.path);
    expect(paths).toContain("calculator.js");
    expect(paths).toContain("tests/add.test.js");
    expect(paths.join("\n")).not.toMatch(/node_modules|\.acd|\.git/);
    expect(omitted.join("\n")).not.toMatch(/node_modules|\.acd|\.git/);
  });
});

describe("resolveRepoPath", () => {
  const root = "/repo";

  it("accepts a nested source path", () => {
    expect(resolveRepoPath(root, "tests/add.test.js")).toBe("tests/add.test.js");
  });

  it("rejects escapes and orchestrator paths", () => {
    expect(resolveRepoPath(root, "../secret")).toBeNull();
    expect(resolveRepoPath(root, ".acd/work/state.json")).toBeNull();
    expect(resolveRepoPath(root, ".git/config")).toBeNull();
  });
});

describe("contextNeededPath", () => {
  it("reads the path and drops a repeated prefix", () => {
    expect(
      contextNeededPath(
        "CONTEXT_NEEDED: calculator.js - engine writes display text only",
      ),
    ).toBe("calculator.js");
  });
});
