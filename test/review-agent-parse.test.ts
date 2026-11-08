import { describe, expect, it } from "vitest";
import { parseReviewAgent } from "../src/stages/review.js";

describe("parseReviewAgent", () => {
  it("keeps a decision field", () => {
    expect(parseReviewAgent({ decision: "pass", findings: [] }).decision).toBe("pass");
  });

  it("accepts verdict when decision is missing", () => {
    const parsed = parseReviewAgent({
      agent: "implementation_coupling",
      verdict: "block",
      findings: [
        {
          file: "tests/acceptance/example.test.js",
          line: 12,
          issue: "Test reaches a private helper.",
          why: "A rename would fail the suite.",
          decision: "block",
        },
      ],
    });
    expect(parsed.decision).toBe("block");
    expect(parsed.findings).toEqual([
      {
        file: "tests/acceptance/example.test.js",
        line: 12,
        issue: "Test reaches a private helper.",
        why: "A rename would fail the suite.",
      },
    ]);
  });

  it("treats fail as block", () => {
    expect(parseReviewAgent({ verdict: "fail", findings: [] }).decision).toBe("block");
  });
});
