import { extractJson } from "../util/json.js";
import type { HarnessDriver, HarnessRunRequest, HarnessRunResult } from "./types.js";

function stubPayload(request: HarnessRunRequest): unknown {
  const { role, input } = request;
  switch (role) {
    case "criteria_gate": {
      const remaining = Number(process.env.ACD_STUB_CLASSIFY_FAILS ?? "0");
      if (Number.isFinite(remaining) && remaining > 0) {
        process.env.ACD_STUB_CLASSIFY_FAILS = String(remaining - 1);
        return {
          decision: "fail",
          reason: "Stub classifier forced fail (ACD_STUB_CLASSIFY_FAILS).",
        };
      }
      return { decision: "pass", reason: "Stub classifier: output matches criteria." };
    }
    case "spec_collaborator":
      return {
        intent: String(input.sourceText ?? input.intent ?? ""),
        behavior: stubBehavior(String(input.sourceText ?? "")),
        feature: stubFeature(String(input.sourceText ?? "")),
        acceptance: stubAcceptance(String(input.sourceText ?? "")),
        notes: ["Stub collaborator drafted artifacts from plain English."],
      };
    case "spec_validator":
      return {
        decision: "pass",
        findings: [],
      };
    case "implementation":
      return {
        files: [],
        tests: [],
        concern: null,
        contextNeeded: null,
        summary: `Stub implemented scenario ${input.scenario ?? 1} without writing product code (configure cursor or anthropic).`,
      };
    case "semantic_review":
    case "security_review":
    case "performance_review":
    case "concurrency_review":
    case "test_fidelity":
    case "implementation_coupling":
    case "architectural_conformance":
    case "intent_alignment":
    case "constraint_compliance":
      return { decision: "pass", findings: [] };
    default:
      return { decision: "pass", findings: [] };
  }
}

function stubBehavior(source: string): string {
  const title = source.split("\n")[0]?.slice(0, 80) || "change";
  return `Feature: ${title}

  Scenario: primary success path
    Given the current system
    When the change is applied
    Then the observable outcome in the intent occurs

  Scenario: failure path
    Given an invalid or boundary condition
    When the change is exercised
    Then the system fails safely with an observable error
`;
}

function stubFeature(source: string): string {
  return `## Feature

### Musts
- Implement only the behavior described in the intent
- Keep the change small enough for one or two-day delivery

### Must Nots
- Must not expand scope beyond the intent
- Must not introduce new production dependencies without escalation

### Preferences
- Prefer existing patterns in the repository

### Escalation Triggers
- If the change requires a new external dependency, stop and ask

Source: ${source.slice(0, 200)}
`;
}

function stubAcceptance(source: string): string {
  return `## Done definition

1. The primary success path in the user-facing behavior is observable.
2. The failure path fails safely.

## Evaluation design

**Test Case 1 (Happy Path):** Exercise the primary scenario. Result: expected observable outcome.

**Test Case 2 (Failure):** Exercise the failure scenario. Result: safe error.

Intent snippet: ${source.slice(0, 120)}
`;
}

export class StubDriver implements HarnessDriver {
  kind = "stub" as const;

  async run(request: HarnessRunRequest): Promise<HarnessRunResult> {
    const json = stubPayload(request);
    const text = JSON.stringify(json, null, 2);
    return { text, json: extractJson(text) ?? json };
  }
}
