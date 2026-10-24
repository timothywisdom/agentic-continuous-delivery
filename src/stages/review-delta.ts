import type { ReviewFinding, ReviewDelta, ReviewDeltaSummary } from "../types/work.js";

function normalize(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSameFinding(a: ReviewFinding, b: ReviewFinding): boolean {
  if (a.agent !== b.agent) return false;

  const fileA = a.file.trim().toLowerCase();
  const fileB = b.file.trim().toLowerCase();
  if (fileA !== fileB) return false;

  const normA = normalize(a.issue);
  const normB = normalize(b.issue);
  if (normA === normB) return true;

  // Check word token overlap for slight phrasing differences
  const wordsA = new Set(a.issue.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  const wordsB = new Set(b.issue.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  if (wordsA.size > 0 && wordsB.size > 0) {
    let intersection = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++;
    }
    const union = new Set([...wordsA, ...wordsB]).size;
    if (union > 0 && intersection / union >= 0.6) {
      return true;
    }
  }

  return false;
}

export function computeReviewDelta(
  previousFindings: ReviewFinding[],
  currentFindings: ReviewFinding[],
  cycle: number,
): ReviewDelta {
  const matchedCurrentIndices = new Set<number>();
  const persistent: ReviewFinding[] = [];
  const resolved: ReviewFinding[] = [];

  for (const prev of previousFindings) {
    let foundMatch = false;
    for (let i = 0; i < currentFindings.length; i++) {
      if (matchedCurrentIndices.has(i)) continue;
      const curr = currentFindings[i];
      if (isSameFinding(prev, curr)) {
        matchedCurrentIndices.add(i);
        persistent.push(curr);
        foundMatch = true;
        break;
      }
    }
    if (!foundMatch) {
      resolved.push(prev);
    }
  }

  const newFindings: ReviewFinding[] = [];
  for (let i = 0; i < currentFindings.length; i++) {
    if (!matchedCurrentIndices.has(i)) {
      newFindings.push(currentFindings[i]);
    }
  }

  const summary: ReviewDeltaSummary = {
    resolvedCount: resolved.length,
    persistentCount: persistent.length,
    newCount: newFindings.length,
    totalCurrent: currentFindings.length,
    totalPrevious: previousFindings.length,
  };

  return {
    cycle,
    resolved,
    persistent,
    new: newFindings,
    summary,
  };
}
