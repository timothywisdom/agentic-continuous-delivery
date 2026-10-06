import { createRequire } from "node:module";
import { extractJson } from "../util/json.js";
import {
  estimateTokensFromText,
  parseUsageFromUnknown,
} from "../telemetry/usage.js";
import type { HarnessDriver, HarnessRunRequest, HarnessRunResult } from "./types.js";

/** Resolve @cursor/sdk from this package (acd-kit), not the consumer's cwd. */
const requireFromKit = createRequire(import.meta.url);

/**
 * Cursor driver: uses @cursor/sdk shipped with acd-kit, else `cursor-agent` CLI.
 */
export class CursorDriver implements HarnessDriver {
  kind = "cursor-sdk" as const;

  async run(request: HarnessRunRequest): Promise<HarnessRunResult> {
    const prompt = buildPrompt(request);
    const sdk = await tryCursorSdk(prompt, request.modelId);
    if (sdk.ok) return sdk.result;

    const cli = process.env.ACD_CURSOR_CLI ?? "cursor-agent";
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync(
        cli,
        ["--print", "--model", request.modelId, prompt],
        { timeout: 120_000, maxBuffer: 2_000_000 },
      );
      const text = String(stdout);
      return {
        text,
        json: extractJson(text),
        usage: estimateTokensFromText(prompt, text),
      };
    } catch (err) {
      const cliErr = (err as Error).message;
      throw new Error(
        [
          "Cursor harness failed.",
          `SDK: ${sdk.reason}`,
          `CLI (${cli}): ${cliErr}`,
          "Set CURSOR_API_KEY in .env.local (KEY=value or export KEY=value).",
          "Or install cursor-agent on PATH / set ACD_CURSOR_CLI.",
        ].join(" "),
      );
    }
  }
}

type SdkAttempt =
  | { ok: true; result: HarnessRunResult }
  | { ok: false; reason: string };

async function tryCursorSdk(
  prompt: string,
  modelId: string,
): Promise<SdkAttempt> {
  let mod: {
    Agent?: {
      prompt: (
        p: string,
        opts: { apiKey: string; model: { id: string } },
      ) => Promise<{ result?: string }>;
    };
  };
  try {
    // Ensure the kit dependency is present (resolves from @acd/kit, not cwd).
    requireFromKit.resolve("@cursor/sdk");
    // Import by package name so Node picks the ESM export map (Agent lives there).
    mod = (await import("@cursor/sdk")) as typeof mod;
  } catch (err) {
    return {
      ok: false,
      reason: `@cursor/sdk missing from @acd/kit (${(err as Error).message})`,
    };
  }
  if (!mod.Agent) {
    return { ok: false, reason: "@cursor/sdk has no Agent export" };
  }
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      reason: "CURSOR_API_KEY is not set (put it in .env.local)",
    };
  }
  try {
    const result = await mod.Agent.prompt(prompt, {
      apiKey,
      model: { id: modelId },
    });
    const text = String(result.result ?? "");
    return {
      ok: true,
      result: {
        text,
        json: extractJson(text),
        usage:
          parseUsageFromUnknown(result) ?? estimateTokensFromText(prompt, text),
      },
    };
  } catch (err) {
    return {
      ok: false,
      reason: `Agent.prompt failed (${(err as Error).message})`,
    };
  }
}

function buildPrompt(request: HarnessRunRequest): string {
  return [
    request.systemRules,
    "",
    request.skillMarkdown,
    "",
    "Input JSON:",
    JSON.stringify(request.input, null, 2),
    request.criteria ? `\nCriteria:\n${request.criteria}` : "",
    "",
    "Return only the JSON object required by the skill. No prose.",
  ].join("\n");
}
