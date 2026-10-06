export function decisionFromStageResult(
  stage: string,
  result: {
    awaitingGuidance?: boolean;
    awaitingApproval?: boolean;
    output: unknown;
  },
): string {
  if (result.awaitingGuidance) {
    return `${stage} paused for human guidance`;
  }
  if (result.awaitingApproval) {
    return `${stage} awaiting approval`;
  }
  return decisionFromOutput(stage, result.output);
}

export function decisionFromOutput(stage: string, output: unknown): string {
  if (!output || typeof output !== "object") {
    return `${stage} completed`;
  }
  const o = output as Record<string, unknown>;
  switch (stage) {
    case "intake":
      return o.workId
        ? `created work item ${String(o.workId)}`
        : "created work item";
    case "specify": {
      const n = o.scenarioCount;
      const tooLarge = o.tooLarge === true ? "; spec flagged too large" : "";
      return typeof n === "number"
        ? `specified ${n} numbered scenario${n === 1 ? "" : "s"}${tooLarge}`
        : "specified artifacts";
    }
    case "implement": {
      const completed = Array.isArray(o.scenariosCompleted)
        ? o.scenariosCompleted.join(", ")
        : o.scenario != null
          ? String(o.scenario)
          : "";
      const remaining =
        typeof o.remaining === "number" ? `; ${o.remaining} remaining` : "";
      const pipe = o.pipelineStatus ? `; pipeline ${o.pipelineStatus}` : "";
      return `implemented scenario${completed.includes(",") ? "s" : ""} ${completed || "?"}${remaining}${pipe}`;
    }
    case "review":
    case "ci_review": {
      const decision = String(o.decision ?? "unknown");
      const n = Array.isArray(o.findings) ? o.findings.length : 0;
      return n > 0 ? `${decision} (${n} findings)` : decision;
    }
    case "fix":
      return o.pipelineStatus === "green"
        ? "restored pipeline to green"
        : `pipeline still ${String(o.pipelineStatus ?? "red")}`;
    case "pr":
      return typeof o.url === "string" && o.url
        ? `opened ${o.url}`
        : "prepared pull request";
    default:
      if (typeof o.decision === "string") return o.decision;
      if (typeof o.summary === "string" && o.summary.trim()) {
        return o.summary.trim().slice(0, 240);
      }
      return `${stage} completed`;
  }
}

export function decisionFromCommand(
  cmd: string,
  payload: unknown,
): string {
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  if (!payload || typeof payload !== "object") return `${cmd} completed`;
  const o = payload as Record<string, unknown>;
  switch (cmd) {
    case "approve":
      return o.currentStage
        ? `approved; current stage ${String(o.currentStage)}`
        : "approved stage";
    case "reject":
      return "rejected stage";
    case "amend":
      return "amended stage (artifacts kept)";
    case "status": {
      const state = asRecord(o.state);
      if (!state) return "reported status";
      return `stage ${String(state.currentStage)}; pipeline ${String(state.pipelineStatus)}`;
    }
    case "list": {
      const n = Array.isArray(o.workIds) ? o.workIds.length : 0;
      return `${n} work item${n === 1 ? "" : "s"}`;
    }
    case "config":
      return "resolved harness routing";
    case "test":
      return o.ok === true ? "tests passed" : "tests failed";
    case "init":
      return "initialized .acd";
    case "artifacts":
      return Array.isArray(o.artifacts)
        ? `${o.artifacts.length} artifacts`
        : "listed artifacts";
    default:
      return decisionFromOutput(cmd, payload);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}
