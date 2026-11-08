import { z } from "zod";
import { nextEvaluationLabel, parseScenarios } from "./gherkin.js";
import { findingKey } from "./revise.js";
import type { ReviewFinding } from "../types/work.js";

const OBSERVABLE =
  /\b(display|user|error|page|button|keyboard|layout|visible|message|screen)\b/i;
const BANNED_THEN = /does not recur|\bissue\b/i;
const IDENTIFIER = /\w+\(\)|\b[a-z]+[A-Z]\w+\b/;

const draftSchema = z.object({
  scenarios: z
    .array(
      z.object({
        title: z.string().optional().default(""),
        gherkin: z.string(),
        findingKeys: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  musts: z
    .array(
      z.object({
        section: z.enum(["must", "must-not"]),
        text: z.string(),
        findingKeys: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  rejected: z
    .array(
      z.object({
        findingKey: z.string(),
        reason: z.string().default(""),
      }),
    )
    .default([]),
});

export interface AcceptedScenario {
  index: number;
  label: string;
  title: string;
  findingKeys: string[];
}

export interface AcceptedMust {
  section: "must" | "must-not";
  text: string;
  findingKeys: string[];
}

export interface DraftRejection {
  findingKey: string;
  reason: string;
}

export interface AppliedDraft {
  behavior: string;
  feature: string;
  acceptance: string;
  scenarios: AcceptedScenario[];
  musts: AcceptedMust[];
  rejected: DraftRejection[];
  absorbedKeys: string[];
}

/** Insert model-written scenarios and musts. Rejects defect-shaped text. */
export function applyBehaviorDraft(input: {
  behavior: string;
  feature: string;
  acceptance: string;
  raw: unknown;
  findings: ReviewFinding[];
}): AppliedDraft {
  const parsed = draftSchema.safeParse(input.raw);
  if (!parsed.success) {
    return {
      behavior: input.behavior,
      feature: input.feature,
      acceptance: input.acceptance,
      scenarios: [],
      musts: [],
      rejected: input.findings.map((finding) => ({
        findingKey: findingKey(finding),
        reason: "revise-behavior returned JSON that does not match the draft schema.",
      })),
      absorbedKeys: [],
    };
  }

  const byKey = new Map(input.findings.map((finding) => [findingKey(finding), finding]));
  let behavior = input.behavior;
  let feature = input.feature;
  let acceptance = input.acceptance;
  const scenarios: AcceptedScenario[] = [];
  const musts: AcceptedMust[] = [];
  const rejected: DraftRejection[] = [...parsed.data.rejected];
  const absorbed = new Set<string>();

  for (const scenario of parsed.data.scenarios) {
    const reason = rejectGherkin(scenario.gherkin);
    const keys = scenario.findingKeys.filter((key) => byKey.has(key));
    if (reason || keys.length === 0) {
      for (const key of keys.length > 0 ? keys : scenario.findingKeys) {
        rejected.push({ findingKey: key, reason: reason ?? "Scenario cited no routed finding." });
      }
      continue;
    }
    const pasted = keys.some((key) => pastesIssue(scenario.gherkin, byKey.get(key)?.issue ?? ""));
    if (pasted) {
      for (const key of keys) {
        rejected.push({ findingKey: key, reason: "Draft repeats the review finding instead of the desired behavior." });
      }
      continue;
    }
    const existing = parseScenarios(behavior);
    const next = existing.reduce((n, item) => Math.max(n, item.index), 0) + 1;
    const label = nextEvaluationLabel(existing) ?? String(next);
    const title = oneLine(scenario.title || titleFromGherkin(scenario.gherkin), 72);
    const body = retitle(scenario.gherkin, label, title);
    const markerKeys = keys.map((key) => `# acd-review:${key}`).join("\n  ");
    behavior = `${behavior.trimEnd()}\n\n  ${markerKeys}\n${body.trimEnd()}\n`;
    acceptance = appendAcceptance(
      acceptance,
      `- [ ] Scenario ${label}: ${title} <!-- acd-review:${keys[0]} -->`,
    );
    for (const key of keys) absorbed.add(key);
    scenarios.push({ index: next, label, title, findingKeys: keys });
  }

  for (const must of parsed.data.musts) {
    const text = oneLine(must.text, 400);
    const keys = must.findingKeys.filter((key) => byKey.has(key));
    if (!text || keys.length === 0 || BANNED_THEN.test(text)) {
      for (const key of keys) {
        rejected.push({ findingKey: key, reason: "Must text is empty or restates the defect." });
      }
      continue;
    }
    if (keys.some((key) => pastesIssue(text, byKey.get(key)?.issue ?? ""))) {
      for (const key of keys) {
        rejected.push({ findingKey: key, reason: "Must repeats the review finding." });
      }
      continue;
    }
    feature = insertBullet(
      feature,
      must.section,
      `- ${text} <!-- acd-review:${keys[0]} -->`,
    );
    for (const key of keys) absorbed.add(key);
    musts.push({ section: must.section, text, findingKeys: keys });
  }

  const covered = new Set([...absorbed, ...rejected.map((item) => item.findingKey)]);
  for (const finding of input.findings) {
    const key = findingKey(finding);
    if (!covered.has(key)) {
      rejected.push({ findingKey: key, reason: "revise-behavior did not draft this finding." });
    }
  }

  return {
    behavior,
    feature,
    acceptance,
    scenarios,
    musts,
    rejected,
    absorbedKeys: [...absorbed],
  };
}

export function rejectGherkin(gherkin: string): string | null {
  const scenarios = parseScenarios(gherkin);
  if (scenarios.length === 0) return "Draft has no Scenario heading.";
  const lines = gherkin.split("\n");
  const thenLines = lines.filter((line) => /^\s*Then\b/i.test(line));
  const stepLines = lines.filter((line) => /^\s*(When|Then|And|But)\b/i.test(line));
  if (thenLines.length === 0) return "Draft has no Then step.";
  if (thenLines.some((line) => BANNED_THEN.test(line))) {
    return "Then restates the defect instead of an observable outcome.";
  }
  if (!thenLines.some((line) => OBSERVABLE.test(line))) {
    return "Then has no observable outcome.";
  }
  if (stepLines.some((line) => IDENTIFIER.test(line))) {
    return "Steps name a function or code identifier.";
  }
  return null;
}

function pastesIssue(text: string, issue: string): boolean {
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const needle = norm(issue);
  if (needle.length < 24) return false;
  return norm(text).includes(needle.slice(0, 48));
}

function titleFromGherkin(gherkin: string): string {
  return parseScenarios(gherkin)[0]?.title || "Review follow-up";
}

function retitle(gherkin: string, label: string, title: string): string {
  const lines = gherkin.trim().split("\n");
  const headingAt = lines.findIndex((line) => /^\s*Scenario(?![A-Za-z])/i.test(line));
  if (headingAt < 0) return `  Scenario: ${label}. ${title}\n${gherkin.trim()}`;
  lines[headingAt] = `  Scenario: ${label}. ${title}`;
  return lines.join("\n");
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

function insertBullet(markdown: string, section: "must" | "must-not", bullet: string): string {
  const re =
    section === "must" ? /^#{2,3} musts\s*$/im : /^#{2,3} must[- ]?nots\s*$/im;
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
