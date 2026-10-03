import { existsSync, lstatSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAcDArgv, graphNodeEmphasis } from "../src/ui/cli-args.js";
import {
  artifactKind,
  editorFileHref,
  tokenizeJson,
  tokenizeYaml,
} from "../src/ui/artifacts.js";
import { validateRepoRoot } from "../src/ui/repo.js";
import { hasProductionUiBuild, resolveNextBin } from "../src/cli/ui.js";
import { stageUiApp, uiAppNeedsStaging } from "../src/cli/ui-stage.js";
import {
  gateUiRequest,
  isAllowedHost,
  isAllowedOrigin,
  timingSafeEqual,
} from "../src/ui/security.js";

describe("ui security", () => {
  it("accepts loopback Host and rejects others", () => {
    expect(isAllowedHost("127.0.0.1:4173")).toBe(true);
    expect(isAllowedHost("localhost:4173")).toBe(true);
    expect(isAllowedHost("evil.example:4173")).toBe(false);
    expect(isAllowedHost("0.0.0.0:4173")).toBe(false);
  });

  it("requires Origin to match loopback Host", () => {
    expect(isAllowedOrigin("http://127.0.0.1:4173", "127.0.0.1:4173")).toBe(true);
    expect(isAllowedOrigin("http://evil.example", "127.0.0.1:4173")).toBe(false);
    expect(isAllowedOrigin("http://localhost:4173", "127.0.0.1:4173")).toBe(false);
  });

  it("rejects non-loopback X-Forwarded-Host", () => {
    const headers = {
      get(name: string) {
        return name === "x-forwarded-host" ? "evil.example" : null;
      },
    };
    expect(
      gateUiRequest({
        method: "POST",
        host: "127.0.0.1:4173",
        origin: "http://127.0.0.1:4173",
        cookieToken: "a",
        headerToken: "a",
        headers,
      }).ok,
    ).toBe(false);

    expect(
      gateUiRequest({
        method: "POST",
        host: "127.0.0.1:4173",
        origin: "http://127.0.0.1:4173",
        cookieToken: "token-a",
        headerToken: "token-b",
      }).ok,
    ).toBe(false);

    expect(
      gateUiRequest({
        method: "POST",
        host: "127.0.0.1:4173",
        origin: "http://127.0.0.1:4173",
        cookieToken: "same-token",
        headerToken: "same-token",
      }).ok,
    ).toBe(true);
  });

  it("timingSafeEqual", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
  });
});

describe("ui cli argv", () => {
  it("builds allowlisted argv", () => {
    expect(
      buildAcDArgv({
        command: "specify",
        flags: { artifact: "all", "work-id": "w1" },
      }),
    ).toEqual(["specify", "--artifact", "all", "--work-id", "w1"]);
  });

  it("rejects unknown commands", () => {
    expect(() => buildAcDArgv({ command: "rm" })).toThrow(/not allowed/);
  });

  it("builds artifact-save argv without putting contents on the command line", () => {
    expect(
      buildAcDArgv({
        command: "artifact-save",
        args: ["intent.md"],
        flags: { "work-id": "w1" },
        stdin: "# hello",
      }),
    ).toEqual(["artifact-save", "intent.md", "--work-id", "w1"]);
  });

  it("rejects path traversal on artifact-save", () => {
    expect(() =>
      buildAcDArgv({
        command: "artifact-save",
        args: ["../secret.md"],
        stdin: "x",
      }),
    ).toThrow(/safe artifact/);
  });
});

describe("graphNodeEmphasis", () => {
  it("shows specify as done after approval even if currentStage is still specify", () => {
    expect(
      graphNodeEmphasis("specify", {
        currentStage: "specify",
        completedStages: ["intake", "specify"],
        awaitingApproval: null,
        awaitingGuidance: null,
      }),
    ).toBe("done");
    expect(
      graphNodeEmphasis("specify", {
        currentStage: "specify",
        completedStages: ["intake"],
        awaitingApproval: "specify",
        awaitingGuidance: null,
      }),
    ).toBe("wait");
  });
});

describe("artifact view helpers", () => {
  it("classifies names and builds editor hrefs", () => {
    expect(artifactKind("intent.md")).toBe("markdown");
    expect(artifactKind("order.yaml")).toBe("yaml");
    expect(artifactKind("state.json")).toBe("json");
    expect(editorFileHref("/home/me/.acd/work/w1/intent.md")).toBe(
      "vscode://file/home/me/.acd/work/w1/intent.md",
    );
  });

  it("color-codes json keys and yaml comments", () => {
    const json = tokenizeJson('{"a": 1, "b": true}');
    expect(json.some((t) => t.cls === "tok-key" && t.text === '"a"')).toBe(true);
    expect(json.some((t) => t.cls === "tok-num" && t.text === "1")).toBe(true);
    const yaml = tokenizeYaml("foo: bar\n# note\n");
    expect(yaml.some((t) => t.cls === "tok-key" && t.text === "foo")).toBe(true);
    expect(yaml.some((t) => t.cls === "tok-comment" && t.text.includes("# note"))).toBe(
      true,
    );
  });
});

describe("repo root", () => {
  it("resolves an existing directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "acd-repo-"));
    expect(validateRepoRoot(dir)).toBe(dir);
  });

  it("rejects missing paths", () => {
    expect(() => validateRepoRoot("/no/such/acd-repo-root")).toThrow(/does not exist/);
  });
});

describe("ui production build detection", () => {
  it("does not treat a next dev .next/server folder as a production build", () => {
    const dir = mkdtempSync(join(tmpdir(), "acd-ui-"));
    mkdirSync(join(dir, ".next", "server"), { recursive: true });
    expect(hasProductionUiBuild(dir)).toBe(false);
    writeFileSync(join(dir, ".next", "BUILD_ID"), "abc123\n");
    expect(hasProductionUiBuild(dir)).toBe(true);
  });
});

describe("resolveNextBin", () => {
  it("finds next even when it is hoisted next to acd-kit, not inside it", () => {
    const bin = resolveNextBin();
    expect(bin.includes("next/dist/bin/next") || bin.endsWith("dist/bin/next")).toBe(
      true,
    );
  });
});

describe("stageUiApp", () => {
  it("runs in place for a kit checkout and stages an npx tree", () => {
    expect(uiAppNeedsStaging("/home/me/source/acd/web")).toBe(false);
    expect(uiAppNeedsStaging("/tmp/prefix/node_modules/acd-kit/web")).toBe(true);

    const fake = mkdtempSync(join(tmpdir(), "acd-npx-"));
    const kit = join(fake, "node_modules", "acd-kit");
    mkdirSync(join(kit, "web", "app"), { recursive: true });
    mkdirSync(join(kit, "src"), { recursive: true });
    mkdirSync(join(kit, "dist"), { recursive: true });
    symlinkSync(
      join(process.cwd(), "node_modules", "next"),
      join(fake, "node_modules", "next"),
      "dir",
    );
    writeFileSync(
      join(kit, "package.json"),
      JSON.stringify({ name: "acd-kit", version: "0.0.0-test" }),
    );
    writeFileSync(join(kit, "web", "package.json"), '{"name":"@acd/web"}');
    writeFileSync(
      join(kit, "web", "app", "layout.tsx"),
      "export default function L(){return null}\n",
    );
    writeFileSync(join(kit, "src", "noop.ts"), "export {}\n");
    writeFileSync(join(kit, "dist", "noop.js"), "export {}\n");

    const staged = stageUiApp(kit, join(fake, "staging"));
    expect(staged.includes(`${join("node_modules", "acd-kit")}`)).toBe(false);
    expect(existsSync(join(staged, "app", "layout.tsx"))).toBe(true);
    expect(existsSync(join(staged, "..", "src", "noop.ts"))).toBe(true);
    expect(existsSync(join(staged, "..", "dist", "noop.js"))).toBe(true);
    expect(lstatSync(join(staged, "node_modules")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(staged, "node_modules", "next"))).toBe(true);
  });
});
