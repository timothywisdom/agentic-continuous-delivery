export interface Scenario {
  index: number;
  title: string;
  body: string;
}

const SCENARIO_HEADING = /^\s*Scenario(?: Outline)?:/m;
const NUMBER_PREFIX = /^(\d+)[.):]\s*(.*)$/;

export function parseScenarios(featureText: string): Scenario[] {
  const chunks = featureText.split(SCENARIO_HEADING).slice(1);
  return chunks.map((chunk, i) => {
    const lines = chunk.split("\n");
    const rawTitle = (lines[0] ?? "untitled").trim();
    const numbered = rawTitle.match(NUMBER_PREFIX);
    const title = (numbered?.[2] ?? rawTitle).trim() || "untitled";
    const index = numbered ? Number(numbered[1]) : i + 1;
    return {
      index,
      title,
      body: `Scenario: ${chunk.trim()}`,
    };
  });
}

/** Rewrite each scenario heading to `Scenario: N. title` so `--scenario N` matches the file. */
export function numberScenarios(featureText: string): string {
  let n = 0;
  return featureText.replace(
    /^(\s*)(Scenario(?: Outline)?:)[ \t]*(.*)$/gm,
    (_match, indent: string, keyword: string, title: string) => {
      n += 1;
      const bare = title.replace(NUMBER_PREFIX, "$2").trim();
      return `${indent}${keyword} ${n}. ${bare}`;
    },
  );
}

export function selectImplementScenarios(
  scenarios: Scenario[],
  requested: number | undefined,
  currentScenario: number | null,
): Scenario[] {
  if (scenarios.length === 0) {
    throw new Error("No Gherkin scenarios found. Run `acd specify` first.");
  }
  if (requested != null) {
    const found = scenarios.find((s) => s.index === requested);
    if (!found) {
      throw new Error(
        `Scenario ${requested} not found. Numbered scenarios are 1–${scenarios.length}.`,
      );
    }
    return [found];
  }
  const start = (currentScenario ?? 0) + 1;
  const remaining = scenarios.filter((s) => s.index >= start);
  if (remaining.length === 0) {
    throw new Error(
      `All ${scenarios.length} scenarios are already implemented. Pass --scenario N to re-run one.`,
    );
  }
  return remaining;
}

export function countScenarios(featureText: string): number {
  return parseScenarios(featureText).length;
}

export function isSpecTooLarge(intent: string, scenarioCount: number): boolean {
  const words = intent.trim().split(/\s+/).filter(Boolean).length;
  return scenarioCount > 8 || words > 800;
}
