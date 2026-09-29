export interface Scenario {
  index: number;
  title: string;
  body: string;
}

export function parseScenarios(featureText: string): Scenario[] {
  const chunks = featureText.split(/^\s*Scenario:/m).slice(1);
  return chunks.map((chunk, i) => {
    const lines = chunk.split("\n");
    const title = (lines[0] ?? "untitled").trim();
    return {
      index: i + 1,
      title,
      body: `Scenario: ${chunk.trim()}`,
    };
  });
}

export function countScenarios(featureText: string): number {
  return parseScenarios(featureText).length;
}

export function isSpecTooLarge(intent: string, scenarioCount: number): boolean {
  const words = intent.trim().split(/\s+/).filter(Boolean).length;
  return scenarioCount > 8 || words > 800;
}
