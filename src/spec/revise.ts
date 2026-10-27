import { createHash } from "node:crypto";
import type { ImplementJob, ReviewFinding } from "../types/work.js";
import { parseScenarios, type Scenario } from "./gherkin.js";
import { slugsMatch } from "./scenario-tests.js";
import { slugify } from "../work/store.js";

const OBSERVABLE =
  /\b(display|user|error|page|button|keyboard|layout|visible|message|screen)\b/i;
const MUST_NOT = /\bmust not\b|\bdo not\b|\bshould not\b/i;
const SCENARIO_REF = /Scenario(?: Outline)?:?\s*(\d+)/i;

export interface RevisePlan {
  behavior: string;
  feature: string;
  acceptance: string;
  implementQueue: ImplementJob[];
  absorbedKeys: string[];
  reopened: { index: number; title: string; mode: "fidelity"; count: number }[];
  addedScenarios: { index: number; title: string; agent: string }[];
  constraints: { section: "must" | "must-not"; issue: string }[];
  acceptanceRows: number;
  notes: { agent: string; issue: string }[];
  unmapped: { agent: string; file: string; issue: string }[];
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
  const behaviorAdds: ReviewFinding[] = [];
  const constraintAdds: ReviewFinding[] = [];

  for (const finding of input.findings) {
    if (finding.decision !== "block") continue;
    const key = findingKey(finding);
    if (applied(key)) continue;
    const kind = classify(finding.agent);
    if (kind === "fidelity") {
      const index = matchScenario(finding, parseScenarios(behavior));
      if (index == null) {
        unmapped.push({
          agent: finding.agent,
          file: finding.file,
          issue: finding.issue,
        });
        continue;
      }
      const group = fidelityGroups.get(index) ?? [];
      group.push(finding);
      fidelityGroups.set(index, group);
      continue;
    }
    if (kind === "quality" && !observable(finding)) {
      notes.push({ agent: finding.agent, issue: finding.issue });
      remember(key);
      continue;
    }
    if (kind === "other") {
      notes.push({ agent: finding.agent, issue: finding.issue });
      remember(key);
      continue;
    }
    if (kind === "behavior") {
      behaviorAdds.push(finding);
      continue;
    }
    constraintAdds.push(finding);
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

  let next = nextScenarioIndex(behavior);
  for (const finding of [...behaviorAdds, ...constraintAdds]) {
    const key = findingKey(finding);
    const title = scenarioTitle(finding.issue);
    behavior = `${behavior.trimEnd()}\n\n${scenarioBlock(next, title, key, finding.issue)}\n`;
    acceptance = appendAcceptance(
      acceptance,
      `- [ ] Scenario ${next}: ${title} <!-- acd-review:${key} -->`,
    );
    acceptanceRows += 1;
    if (constraintAdds.includes(finding)) {
      const section = sectionFor(finding);
      feature = insertBullet(
        feature,
        section,
        `- ${oneLine(finding.issue, 400)} <!-- acd-review:${key} -->`,
      );
      constraints.push({ section, issue: finding.issue });
    }
    jobs.push({ index: next, mode: "new", brief: newBrief(finding) });
    addedScenarios.push({ index: next, title, agent: finding.agent });
    remember(key);
    next += 1;
  }

  jobs.sort((a, b) => a.index - b.index);

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
  };
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
  return OBSERVABLE.test(`${finding.issue}\n${finding.why}`);
}

function sectionFor(finding: ReviewFinding): "must" | "must-not" {
  if (finding.agent === "security") return "must-not";
  if (MUST_NOT.test(`${finding.issue}\n${finding.why}`)) return "must-not";
  return "must";
}

export function matchScenario(
  finding: ReviewFinding,
  scenarios: Scenario[],
): number | null {
  const text = `${finding.issue}\n${finding.why}`;
  const numbered = text.match(SCENARIO_REF);
  if (numbered) {
    const index = Number(numbered[1]);
    if (scenarios.some((s) => s.index === index)) return index;
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

function nextScenarioIndex(behavior: string): number {
  const scenarios = parseScenarios(behavior);
  const max = scenarios.reduce((n, s) => Math.max(n, s.index), 0);
  return max + 1;
}

function markScenario(behavior: string, index: number, key: string): string {
  const marker = `# acd-review:${key}`;
  if (behavior.includes(marker)) return behavior;
  const re = new RegExp(
    `^(\\s*Scenario(?: Outline)?:\\s*${index}[.):].*)$`,
    "m",
  );
  if (!re.test(behavior)) return behavior;
  return behavior.replace(re, `$1\n    ${marker}`);
}

function scenarioBlock(
  index: number,
  title: string,
  key: string,
  issue: string,
): string {
  return [
    `  # acd-review:${key}`,
    `  Scenario: ${index}. ${title}`,
    "    Given the behavior recorded for this work item",
    "    When the reviewed condition is exercised",
    `    Then the issue does not recur: ${oneLine(issue, 240)}`,
  ].join("\n");
}

function scenarioTitle(issue: string): string {
  const title = oneLine(issue, 72).replace(/#/g, "");
  return title || "Review follow-up";
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

function newBrief(finding: ReviewFinding): string {
  return [
    `This scenario was added from a ${finding.agent} review finding. Write the acceptance test first, then the product code.`,
    `Issue: ${oneLine(finding.issue, 400)}`,
    finding.why ? `Why: ${oneLine(finding.why, 300)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

function insertBullet(
  markdown: string,
  section: "must" | "must-not",
  bullet: string,
): string {
  const re =
    section === "must"
      ? /^#{2,3} musts\s*$/im
      : /^#{2,3} must[- ]?nots\s*$/im;
  const match = re.exec(markdown);
  if (!match) {
    const heading = section === "must" ? "## Musts" : "## Must nots";
    return `${markdown.trimEnd()}\n\n${heading}\n\n${bullet}\n`;
  }
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = rest.search(/\n#{2,3} /);
  const insertAt = next === -1 ? markdown.length : start + next;
  const before = markdown.slice(0, insertAt).trimEnd();
  const after = markdown.slice(insertAt);
  return `${before}\n${bullet}\n${after.startsWith("\n") ? after : `\n${after}`}`;
}

function appendAcceptance(markdown: string, row: string): string {
  if (!/^#{2,3} Review follow-ups\s*$/im.test(markdown)) {
    return `${markdown.trimEnd()}\n\n## Review follow-ups\n\n${row}\n`;
  }
  return `${markdown.trimEnd()}\n${row}\n`;
}
