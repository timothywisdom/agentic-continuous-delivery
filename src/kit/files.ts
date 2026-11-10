import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewFindingSchemaMarkdown } from "../spec/review-finding-schema.js";

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), "../..", "acd");

export function loadSkill(name: string): string {
  const skill = readFileSync(join(kitRoot, "skills", name, "SKILL.md"), "utf8");
  if (!name.startsWith("review-")) return skill;
  const rubricPath = join(kitRoot, "skills", "_review-rubric.md");
  try {
    const rubric = readFileSync(rubricPath, "utf8")
      .replaceAll("{{REVIEW_FINDING_SCHEMA}}", reviewFindingSchemaMarkdown())
      .trim();
    return `${skill.trimEnd()}\n\n${rubric}\n`;
  } catch {
    return skill;
  }
}

export function loadAgentRules(name: string): string {
  return readFileSync(join(kitRoot, "agents", `${name}.md`), "utf8");
}

export function loadTemplate(name: string): string {
  return readFileSync(join(kitRoot, "templates", name), "utf8");
}

export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}
