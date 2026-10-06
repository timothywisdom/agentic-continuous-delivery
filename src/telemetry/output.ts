const MAX_STRING = 800;
const MAX_JSON_CHARS = 24_000;
const OMIT_KEYS = new Set([
  "content",
  "contents",
  "skillMarkdown",
  "systemRules",
  "stdin",
]);

/** Drop bodies / secrets; keep the typed stage contract for OTel. */
export function sanitizeOutput(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[max depth]";
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}… [${value.length} chars]`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((item) => sanitizeOutput(item, depth + 1));
  }
  if (typeof value !== "object") return String(value);
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (OMIT_KEYS.has(key)) continue;
    if (key === "files" && Array.isArray(nested)) {
      out.files = nested.map((file) => {
        if (!file || typeof file !== "object") return file;
        const rec = file as Record<string, unknown>;
        return {
          path: rec.path,
          action: rec.action,
          bytes:
            typeof rec.content === "string"
              ? Buffer.byteLength(rec.content, "utf8")
              : undefined,
        };
      });
      continue;
    }
    if (
      ["intent", "behavior", "feature", "acceptance"].includes(key) &&
      typeof nested === "string" &&
      nested.length > 200
    ) {
      out[key] = { omitted: true, chars: nested.length };
      continue;
    }
    if (key === "state" && nested && typeof nested === "object") {
      const st = nested as Record<string, unknown>;
      out.state = {
        id: st.id,
        currentStage: st.currentStage,
        pipelineStatus: st.pipelineStatus,
        awaitingApproval: st.awaitingApproval,
        awaitingGuidance: st.awaitingGuidance,
      };
      continue;
    }
    out[key] = sanitizeOutput(nested, depth + 1);
  }
  return out;
}

export function stringifyOutput(value: unknown): string {
  const json = JSON.stringify(sanitizeOutput(value));
  if (json.length <= MAX_JSON_CHARS) return json;
  return `${json.slice(0, MAX_JSON_CHARS)}… [truncated]`;
}

export function typedSpanAttributes(
  output: unknown,
): Record<string, string | number | boolean> {
  if (!output || typeof output !== "object") return {};
  const o = output as Record<string, unknown>;
  const attrs: Record<string, string | number | boolean> = {};
  if (typeof o.pipelineStatus === "string") {
    attrs["acd.pipeline_status"] = o.pipelineStatus;
  }
  if (typeof o.scenarioCount === "number") {
    attrs["acd.scenario_count"] = o.scenarioCount;
  }
  if (typeof o.decision === "string") {
    attrs["acd.review_decision"] = o.decision;
  }
  if (typeof o.remaining === "number") attrs["acd.remaining"] = o.remaining;
  if (typeof o.awaitingApproval === "boolean") {
    attrs["acd.awaiting_approval"] = o.awaitingApproval;
  }
  if (typeof o.awaitingGuidance === "boolean") {
    attrs["acd.awaiting_guidance"] = o.awaitingGuidance;
  }
  if (typeof o.ok === "boolean") attrs["acd.tests_ok"] = o.ok;
  if (typeof o.testsOk === "boolean") attrs["acd.tests_ok"] = o.testsOk;
  if (typeof o.workId === "string") attrs["acd.work_id"] = o.workId;
  if (typeof o.tooLarge === "boolean") attrs["acd.spec_too_large"] = o.tooLarge;
  return attrs;
}
