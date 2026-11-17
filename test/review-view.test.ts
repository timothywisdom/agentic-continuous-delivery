import { describe, expect, it } from "vitest";
import { findingKey } from "../src/spec/revise.js";
import type { ReviewFinding, WaivedFinding } from "../src/types/work.js";
import {
  openReviewFindings,
  resolvedReviewFindings,
  reviewFileCounts,
  reviewToolbarCounts,
} from "../src/ui/review-view.js";

function finding(
  over: Partial<ReviewFinding> & Pick<ReviewFinding, "agent" | "issue" | "file">,
): ReviewFinding {
  return {
    line: 1,
    why: "because",
    severity: "major",
    category: "code",
    scenario: null,
    evidence: { code: "x" },
    decision: "block",
    ...over,
  };
}

function waiver(item: ReviewFinding, over: Partial<WaivedFinding> = {}): WaivedFinding {
  return {
    key: findingKey(item),
    reason: "accepted-risk",
    explanation: null,
    actor: "tim",
    at: new Date().toISOString(),
    file: item.file,
    issue: item.issue,
    agent: item.agent,
    line: item.line,
    ...over,
  };
}

describe("review view after waive", () => {
  const playwright = finding({
    agent: "constraint_compliance",
    file: "package.json",
    issue: "playwright has no approval",
  });
  const blank = finding({
    agent: "semantic",
    file: "src/app.js",
    issue: "divide by zero shows blank",
    category: "product",
    evidence: { spec: "Then fails safely" },
  });
  const fixed = finding({
    agent: "security",
    file: "src/old.js",
    issue: "was fixed already",
  });

  it("drops waived findings from open lists and file counts", () => {
    const findings = [playwright, blank];
    const waivers = [waiver(playwright)];

    const open = openReviewFindings(findings, waivers);
    expect(open).toEqual([blank]);

    expect(reviewFileCounts(open)).toEqual([["src/app.js", 1]]);
    expect(reviewFileCounts(open).some(([path]) => path === "package.json")).toBe(
      false,
    );

    expect(reviewToolbarCounts(findings, waivers)).toEqual({
      open: 1,
      blocking: 1,
      files: 1,
      waived: 1,
    });
  });

  it("moves waived findings into the Resolved section alongside delta-resolved", () => {
    const findings = [playwright, blank];
    const waivers = [waiver(playwright)];
    const resolved = resolvedReviewFindings(findings, waivers, [fixed]);

    expect(resolved.map((item) => item.issue)).toEqual([
      "playwright has no approval",
      "was fixed already",
    ]);
    expect(resolved[0]?.waived).toBe(true);
    expect(resolved[0]?.key).toBe(findingKey(playwright));
    expect(resolved[1]?.waived).toBe(false);
  });

  it("removes a file from the sidebar when every finding on it is waived", () => {
    const onlyOnPkg = [playwright];
    const open = openReviewFindings(onlyOnPkg, [waiver(playwright)]);
    expect(open).toEqual([]);
    expect(reviewFileCounts(open)).toEqual([]);
    expect(reviewToolbarCounts(onlyOnPkg, [waiver(playwright)]).files).toBe(0);
  });

  it("treats file+issue matches from another agent as waived", () => {
    const dupe = finding({
      agent: "architectural_conformance",
      file: playwright.file,
      issue: playwright.issue,
    });
    const open = openReviewFindings([playwright, dupe, blank], [waiver(playwright)]);
    expect(open).toEqual([blank]);
  });
});
