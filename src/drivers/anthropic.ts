import { extractJson } from "../util/json.js";
import type { HarnessDriver, HarnessRunRequest, HarnessRunResult } from "./types.js";

export class AnthropicDriver implements HarnessDriver {
  kind = "anthropic-api" as const;

  async run(request: HarnessRunRequest): Promise<HarnessRunResult> {
    const apiKeyEnv = request.apiKeyEnv ?? "ANTHROPIC_API_KEY";
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) {
      throw new Error(`${apiKeyEnv} is not set.`);
    }
    const body = {
      model: request.modelId,
      max_tokens: 4096,
      system: `${request.systemRules}\n\n${request.skillMarkdown}`,
      messages: [
        {
          role: "user",
          content: [
            "Input JSON:",
            JSON.stringify(request.input, null, 2),
            request.criteria ? `Criteria:\n${request.criteria}` : "",
            "Return only JSON.",
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    };
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
    };
    const text = data.content?.map((c) => c.text ?? "").join("\n") ?? "";
    return { text, json: extractJson(text) };
  }
}
