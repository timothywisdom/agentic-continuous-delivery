import { afterEach, describe, expect, it } from "vitest";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  currentPricing,
  decisionFromCommand,
  decisionFromStageResult,
  estimateCostUsd,
  initTelemetry,
  noteValue,
  parseTelemetryStderrLine,
  parseUsageFromUnknown,
  recordUsage,
  sanitizeOutput,
  shutdownTelemetry,
  toTotals,
  typedSpanAttributes,
  withSpan,
} from "../src/telemetry/index.js";

describe("telemetry usage", () => {
  it("parses Anthropic-style usage and estimates USD from the pricing table", () => {
    const usage = parseUsageFromUnknown({
      usage: { input_tokens: 1_000_000, output_tokens: 500_000 },
    });
    expect(usage?.inputTokens).toBe(1_000_000);
    expect(usage?.outputTokens).toBe(500_000);
    const { costUsd, costSource } = estimateCostUsd(
      usage!,
      "claude-sonnet-5-5",
      {
        "claude-sonnet": { inputPerMillion: 3, outputPerMillion: 15 },
      },
    );
    expect(costSource).toBe("estimated");
    expect(costUsd).toBe(3 + 7.5);
  });

  it("prefers a vendor-reported dollar amount", () => {
    const { costUsd, costSource } = estimateCostUsd(
      {
        inputTokens: 10,
        outputTokens: 10,
        costUsd: 0.42,
        tokenSource: "api",
      },
      "composer-2",
      { default: { inputPerMillion: 1, outputPerMillion: 1 } },
    );
    expect(costSource).toBe("api");
    expect(costUsd).toBe(0.42);
  });
});

describe("telemetry decisions", () => {
  it("summarizes specify and implement outputs", () => {
    expect(
      decisionFromStageResult("specify", {
        output: { scenarioCount: 16, tooLarge: false },
      }),
    ).toBe("specified 16 numbered scenarios");
    expect(
      decisionFromStageResult("implement", {
        output: {
          scenariosCompleted: [2, 3],
          remaining: 13,
          pipelineStatus: "green",
        },
      }),
    ).toBe("implemented scenarios 2, 3; 13 remaining; pipeline green");
    expect(
      decisionFromStageResult("review", {
        output: { decision: "block", findings: [{}, {}] },
      }),
    ).toBe("block (2 findings)");
    expect(
      decisionFromCommand("status", {
        state: { currentStage: "implement", pipelineStatus: "red" },
      }),
    ).toBe("stage implement; pipeline red");
  });

  it("sanitizes file bodies and promotes typed fields", () => {
    const cleaned = sanitizeOutput({
      files: [{ path: "index.html", action: "create", content: "<html></html>" }],
      pipelineStatus: "green",
      behavior: "x".repeat(500),
      contents: "secret",
    }) as Record<string, unknown>;
    expect(cleaned.contents).toBeUndefined();
    expect(cleaned.files).toEqual([
      { path: "index.html", action: "create", bytes: 13 },
    ]);
    expect(cleaned.behavior).toEqual({ omitted: true, chars: 500 });
    expect(typedSpanAttributes({ scenarioCount: 4, decision: "pass" })).toEqual({
      "acd.scenario_count": 4,
      "acd.review_decision": "pass",
    });
  });
});

describe("telemetry spans", () => {
  afterEach(async () => {
    await shutdownTelemetry();
  });

  it("records duration, cost, and decision on the command span", async () => {
    const exporter = new InMemorySpanExporter();
    initTelemetry(
      {
        enabled: true,
        pricing: {
          default: { inputPerMillion: 3, outputPerMillion: 15 },
        },
      },
      exporter,
    );
    await withSpan(
      "acd.command.specify",
      { "acd.command": "specify" },
      async (span) => {
        noteValue(
          "specified 2 numbered scenarios",
          { scenarioCount: 2, tooLarge: false, awaitingApproval: true },
          span,
        );
        recordUsage(
          toTotals(
            {
              inputTokens: 1_000_000,
              outputTokens: 0,
              tokenSource: "api",
            },
            "claude-sonnet-5-5",
            currentPricing(),
          ),
        );
      },
    );
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0]?.attributes ?? {};
    expect(attrs["acd.command"]).toBe("specify");
    expect(attrs["acd.decision"]).toBe("specified 2 numbered scenarios");
    expect(attrs["acd.scenario_count"]).toBe(2);
    expect(attrs["acd.awaiting_approval"]).toBe(true);
    expect(String(attrs["acd.output"])).toContain("scenarioCount");
    expect(Number(attrs["acd.duration_ms"])).toBeGreaterThanOrEqual(0);
    expect(attrs["acd.cost_usd"]).toBe(3);
    expect(attrs["acd.cost_source"]).toBe("estimated");
    expect(attrs["acd.input_tokens"]).toBe(1_000_000);
  });

  it("parses UI stderr telemetry lines", () => {
    const line =
      'acd.telemetry {"name":"acd.stage.specify","traceId":"t","spanId":"s","parentSpanId":null,"durationMs":12,"status":"ok","decision":"specified 2 numbered scenarios","costUsd":0,"attributes":{},"output":{"scenarioCount":2}}';
    const rec = parseTelemetryStderrLine(line);
    expect(rec?.name).toBe("acd.stage.specify");
    expect(rec?.output).toEqual({ scenarioCount: 2 });
  });
});
