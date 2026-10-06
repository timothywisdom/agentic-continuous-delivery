const SKIP_ARTIFACT_NAMES = new Set([
  "state.json",
  "events.jsonl",
  "telemetry.jsonl",
]);
const ARTIFACT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isReservedArtifactName(name: string): boolean {
  return SKIP_ARTIFACT_NAMES.has(name);
}

export function isSafeArtifactName(name: string): boolean {
  return ARTIFACT_NAME_RE.test(name) && !SKIP_ARTIFACT_NAMES.has(name);
}
