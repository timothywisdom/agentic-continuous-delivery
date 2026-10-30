import { describe, expect, it } from "vitest";
import { reviseTransfer, suggestNextCommand, type NextCommandState } from "../src/ui/next-command.js";

function state(partial: Partial<NextCommandState>): NextCommandState {
  return {
    currentStage: "review",
    completedStages: ["intake", "specify", "implement"],
    pipelineStatus: "green",
    awaitingApproval: null,
    awaitingGuidance: null,
    implementQueue: null,
    lastStageOutput: null,
    ...partial,
  };
}

describe("suggestNextCommand", () => {
  it("sends a queued revise to implement, not specify", () => {
    const next = suggestNextCommand(
      state({ implementQueue: [{ index: 3 }, { index: 24 }] }),
    );
    expect(next.command).toBe("implement");
    expect(next.detail).toBe("2 scenarios on the implement queue.");
  });

  it("sends a blocking review with no queue to revise", () => {
    const next = suggestNextCommand(
      state({
        awaitingApproval: "review",
        lastStageOutput: { findings: [{ issue: "a" }, { issue: "b" }] },
      }),
    );
    expect(next.command).toBe("revise");
    expect(next.detail).toBe("2 review findings.");
  });

  it("prefers fix while the pipeline is red", () => {
    expect(
      suggestNextCommand(
        state({ pipelineStatus: "red", implementQueue: [{ index: 1 }] }),
      ).command,
    ).toBe("fix");
  });

  it("approves a clean review", () => {
    const next = suggestNextCommand(
      state({ awaitingApproval: "review", lastStageOutput: { findings: [] } }),
    );
    expect(next).toMatchObject({ command: "approve", stage: "review" });
  });
});

describe("reviseTransfer", () => {
  it("counts reopened findings and new scenarios", () => {
    expect(
      reviseTransfer({
        reopened: [{ count: 2 }, { count: 1 }],
        addedScenarios: [{ index: 24 }, { index: 25 }],
        notes: [],
        unmapped: [{ issue: "left behind" }],
        implementQueue: [{ index: 3 }, { index: 4 }, { index: 24 }],
      }),
    ).toEqual({ moved: 5, unmapped: 1, queued: 3 });
  });

  it("ignores unrelated command output", () => {
    expect(reviseTransfer({ decision: "block" })).toBeNull();
  });
});
