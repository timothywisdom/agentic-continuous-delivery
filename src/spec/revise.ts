import { createHash } from "node:crypto";
import type { ImplementJob, ReviewFinding } from "../types/work.js";
import { categoryFromAgent } from "./findings.js";
import { parseScenarios, type Scenario } from "./gherkin.js";
import { slugsMatch } from "./scenario-tests.js";
import { slugify } from "../work/store.js";

const OBSERVABLE =
  /\b(display|user|error|page|button|keyboard|layout|visible|message|screen)\b/i;
const SCENARIO_REF = /Scenario(?:\s+Outline)?\s*:?\s*(E\d+[A-Za-z]*|\d+)/i;

export interface RevisePlan {
  behavior: string;
  feature: string;
  acceptance: string;
  implementQueue: ImplementJob[];
  absorbedKeys: string[];
  reopened: { index: number; title: string; mode: "fidelity"; count: number }[];
  /** Filled by the stage after revise-behavior drafts observable scenarios. */
  addedScenarios: { index: number; title: string; agent: string }[];
  constraints: { section: "must" | "must-not"; issue: string }[];
  acceptanceRows: number;
  notes: { agent: string; issue: string }[];
  unmapped: { agent: string; file: string; issue: string }[];
  /** Product findings a model may draft as observable scenarios. Not written here. */
  behaviorDrafts: ReviewFinding[];
  /** Dependency approval, logging policy, coverage process. A human decides. */
  policyQuestions: ReviewFinding[];
  /** Would remove or contradict behavior already in the spec. A human decides. */
  guidanceQuestions: ReviewFinding[];
}

export function findingKey(finding: ReviewFinding): string {
  return createHash("sha256")
    .update(`${finding.agent}\0${finding.file}\0${finding.line ?? ""}\0${finding.issue}`)
    .digest("hex")
    .slice(0, 12);
}

export function planRevision(input: {
  behavior: string;
  feature: string;
  acceptance: string;
  findings: ReviewFinding[];
  absorbedKeys: string[];
}): RevisePlan {
  let behavior = input.behavior;
  let feature = input.feature;
  let acceptance = input.acceptance;
  const absorbed = new Set(input.absorbedKeys);
  const absorbedKeys: string[] = [];
  const reopened: RevisePlan["reopened"] = [];
  const addedScenarios: RevisePlan["addedScenarios"] = [];
  const constraints: RevisePlan["constraints"] = [];
  const notes: RevisePlan["notes"] = [];
  const unmapped: RevisePlan["unmapped"] = [];
  const jobs: ImplementJob[] = [];
  let acceptanceRows = 0;

  const applied = (key: string) =>
    absorbed.has(key) ||
    `${behavior}\n${feature}\n${acceptance}`.includes(`acd-review:${key}`);

  const remember = (key: string) => {
    absorbed.add(key);
    absorbedKeys.push(key);
  };

  const fidelityGroups = new Map<number, ReviewFinding[]>();
  const behaviorDrafts: ReviewFinding[] = [];
  const policyQuestions: ReviewFinding[] = [];
  const guidanceQuestions: ReviewFinding[] = [];

  for (const raw of input.findings) {
    const finding = withFindingDefaults(raw);
    const key = findingKey(finding);
    if (finding.severity === "minor" || finding.decision === "advisory") {
      notes.push({ agent: finding.agent, issue: finding.issue });
      continue;
    }
    if (finding.decision !== "block") continue;
    if (applied(key)) continue;
    const route = routeFinding(finding, parseScenarios(behavior));
    if (route.kind === "fidelity") {
      const group = fidelityGroups.get(route.index) ?? [];
      group.push(finding);
      fidelityGroups.set(route.index, group);
      continue;
    }
    if (route.kind === "cleanup") {
      jobs.push({
        index: 0,
        mode: "cleanup",
        file: finding.file,
        brief: cleanupBrief(finding),
      });
      remember(key);
      continue;
    }
    if (route.kind === "policy") {
      policyQuestions.push(finding);
      remember(key);
      continue;
    }
    if (route.kind === "guidance") {
      guidanceQuestions.push(finding);
      remember(key);
      continue;
    }
    if (route.kind === "draft") {
      behaviorDrafts.push(finding);
      continue;
    }
    if (route.kind === "fix") {
      jobs.push({
        index: route.index,
        mode: "fix",
        ...(route.index === 0 ? { file: finding.file } : {}),
        brief: fixBrief(finding),
      });
      remember(key);
      continue;
    }
    notes.push({ agent: finding.agent, issue: finding.issue });
    remember(key);
  }

  for (const [index, group] of [...fidelityGroups.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    const scenario = parseScenarios(behavior).find((s) => s.index === index);
    if (!scenario) continue;
    for (const finding of group) {
      const key = findingKey(finding);
      behavior = markScenario(behavior, index, key);
      remember(key);
    }
    reopened.push({
      index,
      title: scenario.title,
      mode: "fidelity",
      count: group.length,
    });
    jobs.push({
      index,
      mode: "fidelity",
      brief: fidelityBrief(group),
    });
  }

  jobs.sort((a, b) => a.index - b.index || a.brief.localeCompare(b.brief));

  return {
    behavior,
    feature,
    acceptance,
    implementQueue: jobs,
    absorbedKeys,
    reopened,
    addedScenarios,
    constraints,
    acceptanceRows,
    notes,
    unmapped,
    behaviorDrafts,
    policyQuestions,
    guidanceQuestions,
  };
}

const POLICY =
  /\b(team approval|devdependency|new dependenc)/i;
const LOGGING_POLICY = /\bstructured (operational )?log/i;
const COVERAGE_PROCESS = /\bno acceptance test\b|\bcoverage\b/i;
const UNSPECIFIED =
  /\bnot defined in\b|\bnot specified\b|\bnot in the (spec|intent|behavior)\b|\babsent from the\b/i;

type Route =
  | { kind: "fidelity"; index: number }
  | { kind: "cleanup" }
  | { kind: "policy" }
  | { kind: "guidance" }
  | { kind: "draft" }
  | { kind: "fix"; index: number }
  | { kind: "note" };

function withFindingDefaults(finding: ReviewFinding): ReviewFinding {
  return {
    ...finding,
    severity: finding.severity ?? "major",
    category: finding.category ?? categoryFromAgent(finding.agent),
    scenario: finding.scenario ?? null,
    evidence: finding.evidence ?? {},
  };
}

function routeFinding(finding: ReviewFinding, scenarios: Scenario[]): Route {
  const category = finding.category;
  if (category === "test") {
    const index = matchScenario(finding, scenarios);
    return index == null ? { kind: "cleanup" } : { kind: "fidelity", index };
  }
  if (category === "policy" || isPolicy(finding)) return { kind: "policy" };
  if (UNSPECIFIED.test(finding.issue)) return { kind: "guidance" };
  if (category === "product") return { kind: "draft" };
  if (category === "code") {
    // Agents often leave category=code on user-visible defects; treat those as product drafts.
    if (observable(finding)) return { kind: "draft" };
    if (classify(finding.agent) === "quality") return { kind: "note" };
    const index = matchScenario(finding, scenarios);
    return { kind: "fix", index: index ?? 0 };
  }
  const kind = classify(finding.agent);
  if (kind === "fidelity") {
    const index = matchScenario(finding, scenarios);
    return index == null ? { kind: "cleanup" } : { kind: "fidelity", index };
  }
  if (kind === "quality" && !observable(finding)) return { kind: "note" };
  if (kind === "other") return { kind: "note" };
  if (kind === "behavior" || observable(finding)) return { kind: "draft" };
  const index = matchScenario(finding, scenarios);
  return { kind: "fix", index: index ?? 0 };
}

function isPolicy(finding: ReviewFinding): boolean {
  const text = `${finding.issue}\n${finding.why}`;
  return POLICY.test(text) || LOGGING_POLICY.test(text) || COVERAGE_PROCESS.test(text);
}

function classify(
  agent: string,
): "fidelity" | "behavior" | "constraint" | "quality" | "other" {
  switch (agent) {
    case "test_fidelity":
    case "implementation_coupling":
      return "fidelity";
    case "semantic":
    case "intent_alignment":
      return "behavior";
    case "architectural_conformance":
    case "constraint_compliance":
    case "security":
      return "constraint";
    case "performance":
    case "concurrency":
      return "quality";
    default:
      return "other";
  }
}

function observable(finding: ReviewFinding): boolean {
  return OBSERVABLE.test(finding.issue);
}

export function matchScenario(
  finding: ReviewFinding,
  scenarios: Scenario[],
): number | null {
  if (finding.scenario) {
    const token = finding.scenario.trim();
    const byLabel = scenarios.find(
      (scenario) => scenario.label.toLowerCase() === token.toLowerCase(),
    );
    if (byLabel) return byLabel.index;
    if (/^\d+$/.test(token)) {
      const index = Number(token);
      if (scenarios.some((scenario) => scenario.index === index)) return index;
    }
  }
  const text = `${finding.issue}\n${finding.why}`;
  const numbered = text.match(SCENARIO_REF);
  if (numbered) {
    const token = numbered[1] ?? "";
    const byLabel = scenarios.find(
      (scenario) => scenario.label.toLowerCase() === token.toLowerCase(),
    );
    if (byLabel) return byLabel.index;
    if (/^\d+$/.test(token)) {
      const index = Number(token);
      if (scenarios.some((scenario) => scenario.index === index)) return index;
    }
  }
  const base = (finding.file.split(/[/\\]/).pop() ?? finding.file).replace(
    /\.(test|spec)\.[^.]+$/i,
    "",
  );
  const fileSlug = slugify(base.replace(/\.[^.]+$/, ""));
  let best: { index: number; score: number } | null = null;
  for (const scenario of scenarios) {
    const titleSlug = slugify(scenario.title);
    if (titleSlug.length < 3) continue;
    if (
      slugsMatch(fileSlug, titleSlug)
    ) {
      if (!best || titleSlug.length > best.score) {
        best = { index: scenario.index, score: titleSlug.length };
      }
    }
  }
  return best?.index ?? null;
}

function markScenario(behavior: string, index: number, key: string): string {
  const marker = `# acd-review:${key}`;
  if (behavior.includes(marker)) return behavior;
  const scenario = parseScenarios(behavior).find((item) => item.index === index);
  if (!scenario) return behavior;
  const at = behavior.indexOf(scenario.heading);
  if (at < 0) return behavior;
  const indent = scenario.heading.match(/^\s*/)?.[0] ?? "  ";
  return (
    behavior.slice(0, at) + `${indent}${marker}\n` + behavior.slice(at)
  );
}

function cleanupBrief(finding: ReviewFinding): string {
  return [
    "Delete this orphan test file. Do not change product code.",
    `File: ${finding.file}`,
    `Issue: ${oneLine(finding.issue, 400)}`,
  ].join("\n");
}

function fixBrief(finding: ReviewFinding): string {
  return [
    "Fix this in product code. Do not weaken or delete tests. Existing scenario tests must stay green.",
    `Issue: ${oneLine(finding.issue, 400)}`,
    finding.why ? `Why: ${oneLine(finding.why, 300)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function fidelityBrief(findings: ReviewFinding[]): string {
  const lines = findings.map((finding) => {
    const where =
      finding.line != null ? `${finding.file}:${finding.line}` : finding.file;
    const why = finding.why ? ` — ${oneLine(finding.why, 300)}` : "";
    return `- ${where}: ${oneLine(finding.issue, 400)}${why}`;
  });
  return [
    "Rewrite the acceptance test so it performs the Gherkin steps. Do not weaken assertions.",
    "Findings:",
    ...lines,
  ].join("\n");
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

