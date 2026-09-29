import { extractJson } from "../util/json.js";
import { gateDecisionSchema } from "../schemas/zod.js";
import type { HarnessDriver, HarnessRunRequest, HarnessRunResult } from "./types.js";

/**
 * Dedicated classifier endpoint (Jev-class).
 * POST {baseUrl}/classify { criteria, candidate } → { decision, reason }
 *
 * baseUrl comes from classifiers.<name>.baseUrl in YAML (preferred).
 * CLASSIFIER_BASE_URL env remains an optional override for CI/local.
 */
export class ClassifierDriver implements HarnessDriver {
  kind = "classifier-api" as const;

  async run(request: HarnessRunRequest): Promise<HarnessRunResult> {
    const baseUrl =
      process.env.CLASSIFIER_BASE_URL?.trim() || request.baseUrl?.trim();
    const apiKeyEnv = request.apiKeyEnv ?? "CLASSIFIER_API_KEY";
    const apiKey = process.env[apiKeyEnv];
    if (!baseUrl) {
      throw new Error(
        "Classifier base URL missing. Set classifiers.<name>.baseUrl in .acd/acd.config.yaml " +
          "(or CLASSIFIER_BASE_URL), or use driver: cursor-sdk / stub under classifiers.",
      );
    }
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/classify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: request.modelId,
        criteria: request.criteria ?? request.skillMarkdown,
        candidate: request.input,
      }),
    });
    if (!res.ok) {
      throw new Error(`Classifier API ${res.status}: ${await res.text()}`);
    }
    const json = await res.json();
    const parsed = gateDecisionSchema.safeParse(json);
    const payload = parsed.success
      ? parsed.data
      : extractJson(JSON.stringify(json));
    return { text: JSON.stringify(payload), json: payload };
  }
}
