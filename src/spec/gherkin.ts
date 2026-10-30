export interface Scenario {
  /** Value stored in the implement queue and `currentScenario`. An explicit integer on the heading wins; otherwise this is the 1-based position in the file. */
  index: number;
  /** Author's id, shared with acceptance evaluation rows. Examples: `1`, `E1`, `E10a`. */
  label: string;
  title: string;
  /** Full heading line, including indent, without a trailing newline. */
  heading: string;
  body: string;
}

const HEADING =
  /^[ \t]*Scenario(?![A-Za-z])(?:[ \t]+Outline)?(?::|[ \t]+)[ \t]*(.*)$/gm;
const LABEL = /^(E\d+[A-Za-z]*|\d+)[ \t]*[.:)][ \t]*(.*)$/i;

export function canonicalLabel(raw: string): string {
  const token = raw.trim();
  const evalId = token.match(/^E(\d+)([A-Za-z]*)$/i);
  if (evalId) return `E${evalId[1]}${(evalId[2] ?? "").toLowerCase()}`;
  const digits = token.match(/^(\d+)$/);
  if (digits) return String(Number(digits[1]));
  return token;
}

export function parseScenarios(featureText: string): Scenario[] {
  const hits = [...featureText.matchAll(HEADING)];
  return hits.map((hit, i) => {
    const start = hit.index ?? 0;
    const end = hits[i + 1]?.index ?? featureText.length;
    const rest = hit[1] ?? "";
    const labeled = rest.match(LABEL);
    const position = i + 1;
    const explicitNumber =
      labeled && !/^e/i.test(labeled[1] ?? "") ? Number(labeled[1]) : null;
    const index = explicitNumber ?? position;
    const label = labeled ? canonicalLabel(labeled[1] ?? "") : String(index);
    const title = (labeled ? labeled[2] : rest).trim() || "untitled";
    return {
      index,
      label,
      title,
      heading: hit[0],
      body: featureText.slice(start, end).trim(),
    };
  });
}

export function findScenario(
  scenarios: Scenario[],
  requested: number | string,
): Scenario | undefined {
  const token = canonicalLabel(String(requested).trim());
  const byLabel = scenarios.find((scenario) => scenario.label.toLowerCase() === token.toLowerCase());
  if (byLabel) return byLabel;
  if (/^\d+$/.test(token)) {
    return scenarios.find((scenario) => scenario.index === Number(token));
  }
  return undefined;
}

export function selectImplementScenarios(
  scenarios: Scenario[],
  requested: number | string | undefined,
  currentScenario: number | null,
  queuedIndexes?: number[] | null,
): Scenario[] {
  if (scenarios.length === 0) {
    throw new Error(
      "No Gherkin scenarios found. A heading can be `Scenario: 1. title`, `Scenario 1: title`, `Scenario: E1. title`, or `Scenario E1: title`.",
    );
  }
  if (requested != null && String(requested).trim() !== "") {
    const found = findScenario(scenarios, requested);
    if (!found) {
      const labels = scenarios.map((scenario) => scenario.label).join(", ");
      throw new Error(`Scenario ${requested} not found. Headings in this file: ${labels}.`);
    }
    return [found];
  }
  if (queuedIndexes) {
    if (queuedIndexes.length === 0) {
      throw new Error(
        "No scenarios left in the review follow-up queue. Pass --scenario <id> to re-run one.",
      );
    }
    return queuedIndexes.map((index) => {
      const found = scenarios.find((scenario) => scenario.index === index);
      if (!found) {
        throw new Error(`Queued scenario ${index} is not in behavior.feature.`);
      }
      return found;
    });
  }
  const start = (currentScenario ?? 0) + 1;
  const remaining = scenarios.filter((scenario) => scenario.index >= start);
  if (remaining.length === 0) {
    throw new Error(
      `All ${scenarios.length} scenarios are already implemented. Pass --scenario <id> to re-run one.`,
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

/** Next evaluation id (E15) when the file already labels scenarios that way. */
export function nextEvaluationLabel(scenarios: Scenario[]): string | null {
  const numbers = scenarios
    .map((scenario) => scenario.label.match(/^E(\d+)/i))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => Number(match[1]));
  if (numbers.length === 0) return null;
  return `E${Math.max(...numbers) + 1}`;
}
