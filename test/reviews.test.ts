import { describe, expect, it } from "vitest";
import { listReviewRuns } from "../src/work/reviews.js";
import type { WorkEvent } from "../src/types/work.js";

function event(
  type: string,
  at: string,
  data?: Record<string, unknown>,
  stage?: WorkEvent["stage"],
): WorkEvent {
  return { at, workId: "w1", type, stage, data };
}

const finding = {
  agent: "security",
  file: "src/app.js",
  line: 12,
  issue: "Query string is interpolated into SQL.",
  why: "Untrusted input reaches the query.",
  decision: "block" as const,
};

describe("listReviewRuns", () => {
  it("keeps each review.complete in order and attaches mechanical checks", () => {
    const runs = listReviewRuns([
      event("stage.start", "2026-10-27T20:00:00.000Z", {}, "review"),
      event(
        "review.complete",
        "2026-10-27T20:01:00.000Z",
        { decision: "pass", findingCount: 0, findings: [] },
        "review",
      ),
      event(
        "stage.complete",
        "2026-10-27T20:01:01.000Z",
        { output: { mechanical: [{ name: "lint", ok: true }] } },
        "review",
      ),
      event(
        "review.complete",
        "2026-10-27T20:53:29.000Z",
        {
          decision: "block",
          findingCount: 1,
          findings: [finding],
          delta: {
            cycle: 2,
            resolved: [],
            persistent: [],
            new: [finding],
            summary: {
              resolvedCount: 0,
              persistentCount: 0,
              newCount: 1,
              totalCurrent: 1,
              totalPrevious: 0,
            },
          },
        },
        "review",
      ),
      event(
        "stage.awaiting_approval",
        "2026-10-27T20:53:29.100Z",
        { output: { mechanical: [{ name: "lint", ok: false, detail: "no-unused" }] } },
        "review",
      ),
    ]);

    expect(runs.map((r) => r.index)).toEqual([1, 2]);
    expect(runs[0]?.decision).toBe("pass");
    expect(runs[0]?.mechanical).toEqual([{ name: "lint", ok: true }]);
    expect(runs[1]?.decision).toBe("block");
    expect(runs[1]?.findings).toEqual([finding]);
    expect(runs[1]?.mechanical[0]?.ok).toBe(false);
    expect(runs[1]?.delta?.summary.newCount).toBe(1);
  });

  it("reads findings from the following approval event when the summary omits them", () => {
    const runs = listReviewRuns([
      event(
        "review.complete",
        "2026-10-27T20:53:29.000Z",
        { decision: "block", findingCount: 1 },
        "review",
      ),
      event(
        "stage.awaiting_approval",
        "2026-10-27T20:53:29.100Z",
        { output: { decision: "block", findings: [finding], mechanical: [] } },
        "review",
      ),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.findings).toEqual([finding]);
    expect(runs[0]?.decision).toBe("block");
  });

  it("drops findings that are missing an agent or issue", () => {
    const runs = listReviewRuns([
      event("review.complete", "2026-10-27T21:00:00.000Z", {
        findings: [{ file: "x" }, finding],
      }),
    ]);
    expect(runs[0]?.findings).toEqual([finding]);
    expect(runs[0]?.decision).toBe("block");
  });
});
