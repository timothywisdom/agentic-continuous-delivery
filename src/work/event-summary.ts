import { decisionFromOutput } from "../telemetry/decision.js";

/** One-line account of an events.jsonl record. Deterministic; no model call. */
export function summarizeEvent(event: {
  type: string;
  stage?: string;
  data?: Record<string, unknown>;
}): string {
  const data = event.data ?? {};
  const stage = event.stage ?? "stage";
  const output = asRecord(data.output);
  switch (event.type) {
    case "stage.start":
      return `started ${stage}`;
    case "stage.complete":
      return clip(decisionFromOutput(stage, output ?? data));
    case "stage.awaiting_approval":
      return clip(`${decisionFromOutput(stage, output ?? data)}; awaiting approval`);
    case "stage.awaiting_guidance":
      return `${stage} paused for human guidance`;
    case "stage.approved":
      return `approved ${stage}`;
    case "stage.rejected":
      return clip(
        `rejected ${stage}${typeof data.reason === "string" && data.reason ? `: ${data.reason}` : ""}`,
      );
    case "stage.amended":
      return `amended ${stage}`;
    case "intake.created":
      return "created work item";
    case "specify.validated": {
      const n = data.scenarioCount;
      const tooLarge = data.tooLarge === true ? "; spec flagged too large" : "";
      return typeof n === "number"
        ? `specified ${n} scenario${n === 1 ? "" : "s"}${tooLarge}`
        : "specified artifacts";
    }
    case "implement.session": {
      const n = data.scenario != null ? String(data.scenario) : "?";
      const title = typeof data.title === "string" && data.title ? ` ${data.title}` : "";
      const outcome =
        data.skipped === true
          ? "existing test passed"
          : data.testsOk === false
            ? "tests failed"
            : "tests passed";
      return clip(`scenario ${n}${title}: ${outcome}`);
    }
    case "pipeline.red":
      return "pipeline red";
    case "review.complete":
    case "ci_review.complete": {
      const decision = typeof data.decision === "string" ? data.decision : "unknown";
      const n =
        typeof data.findingCount === "number"
          ? data.findingCount
          : Array.isArray(data.findings)
            ? data.findings.length
            : null;
      const tests = data.testsOk === false ? "; tests failed" : data.testsOk === true ? "; tests passed" : "";
      return n != null ? `${decision} (${n} findings)${tests}` : `${decision}${tests}`;
    }
    case "revise.complete": {
      const added = typeof data.addedScenarios === "number" ? data.addedScenarios : 0;
      const reopened = typeof data.reopened === "number" ? data.reopened : 0;
      return `revised spec; ${added} new scenario${added === 1 ? "" : "s"}, ${reopened} reopened`;
    }
    case "pr.opened":
      return typeof data.url === "string" && data.url
        ? `opened ${data.url}`
        : data.created === true
          ? "opened pull request"
          : "prepared pull request";
    case "fix.attempt":
      return data.pipelineStatus === "green"
        ? "restored pipeline to green"
        : `pipeline still ${typeof data.pipelineStatus === "string" ? data.pipelineStatus : "red"}`;
    case "artifact.saved":
      return typeof data.name === "string" ? `saved ${data.name}` : "saved artifact";
    default:
      return event.type;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= 240 ? flat : `${flat.slice(0, 239)}…`;
}
