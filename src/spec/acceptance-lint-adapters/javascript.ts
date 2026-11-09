import type { AcceptanceLintAdapter, AcceptanceLintHit } from "./types.js";

const IMPORT_RE =
  /(?:^|\n)\s*(?:import\s+[\s\S]*?\s+from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g;
const READ_FILE_RE =
  /\b(?:readFile(?:Sync)?|openSync|createReadStream)\s*\(\s*['"`]([^'"`]+)['"`]/g;
const CONSOLE_SPY_RE =
  /\b(?:spyOn\s*\(\s*console|console\.(?:log|info|warn|error|debug)\s*=|mock\.method\s*\(\s*console)/i;

export const javascriptAdapter: AcceptanceLintAdapter = {
  id: "javascript",

  matchesFile(relPath) {
    return /\.[cm]?[jt]sx?$/i.test(relPath);
  },

  isTestFile(relPath) {
    return /\.(test|spec)\.[cm]?[jt]sx?$/i.test(relPath);
  },

  extractImports(text) {
    return collect(text, IMPORT_RE);
  },

  extractSourceReads(text) {
    return collect(text, READ_FILE_RE);
  },

  hasConsoleSpy(text) {
    return CONSOLE_SPY_RE.test(text);
  },

  isExternalImport(spec) {
    if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("file:")) {
      return false;
    }
    return true;
  },
};

function collect(text: string, pattern: RegExp): AcceptanceLintHit[] {
  const hits: AcceptanceLintHit[] = [];
  for (const match of text.matchAll(pattern)) {
    const target = match[1] ?? "";
    if (!target) continue;
    hits.push({ target, index: match.index ?? 0 });
  }
  return hits;
}
