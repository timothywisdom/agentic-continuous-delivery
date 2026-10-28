import { describe, expect, it } from "vitest";
import { summarizeEvent } from "../src/work/event-summary.js";

describe("summarizeEvent", () => {
  it("describes a review and an implement session", () => {
    expect(
      summarizeEvent({
        type: "review.complete",
        stage: "review",
        data: { decision: "block", findingCount: 20 },
      }),
    ).toBe("block (20 findings)");
    expect(
      summarizeEvent({
        type: "implement.session",
        stage: "implement",
        data: { scenario: 3, title: "divide by zero", testsOk: true, skipped: true },
      }),
    ).toBe("scenario 3 divide by zero: existing test passed");
  });

  it("reads the decision from a completed stage output", () => {
    expect(
      summarizeEvent({
        type: "stage.complete",
        stage: "specify",
        data: { output: { scenarioCount: 4, tooLarge: false } },
      }),
    ).toBe("specified 4 numbered scenarios");
    expect(
      summarizeEvent({
        type: "stage.rejected",
        stage: "review",
        data: { reason: "needs another pass" },
      }),
    ).toBe("rejected review: needs another pass");
  });
});
