import type { AcceptanceLintAdapter, AcceptanceLintHit } from "./types.js";

/** `from package.module import x` / `import package.module` / relative `from ..support import steps`. */
const IMPORT_RE =
  /(?:^|\n)\s*(?:from\s+(\.[\w.]*)\s+import\b|from\s+([\w.]+)\s+import\b|import\s+([\w.]+))/g;
const OPEN_RE = /\bopen\s*\(\s*['"]([^'"]+)['"]/g;
const PATH_READ_RE =
  /\bPath\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\.\s*(?:read_text|read_bytes|open)\s*\(/g;
const CONSOLE_SPY_RE =
  /\b(?:patch\s*\(\s*['"]builtins\.print['"]|monkeypatch\.setattr\s*\(\s*(?:builtins\.)?print\b|unittest\.mock\.patch\s*\(\s*['"]builtins\.print['"])/i;

export const pythonAdapter: AcceptanceLintAdapter = {
  id: "python",

  matchesFile(relPath) {
    return /\.py$/i.test(relPath);
  },

  isTestFile(relPath) {
    const base = relPath.split("/").pop() ?? relPath;
    if (!/\.py$/i.test(base)) return false;
    if (base === "__init__.py") return false;
    return /^test_.+\.py$/i.test(base) || /_test\.py$/i.test(base);
  },

  extractImports(text) {
    const hits: AcceptanceLintHit[] = [];
    for (const match of text.matchAll(IMPORT_RE)) {
      const target = match[1] ?? match[2] ?? match[3] ?? "";
      if (!target) continue;
      hits.push({ target, index: match.index ?? 0 });
    }
    return hits;
  },

  extractSourceReads(text) {
    return [...collect(text, OPEN_RE), ...collect(text, PATH_READ_RE)];
  },

  hasConsoleSpy(text) {
    return CONSOLE_SPY_RE.test(text);
  },

  isExternalImport(spec) {
    // Relative imports are always project-local.
    if (spec.startsWith(".")) return false;
    // Common stdlib / tooling — treat as external. Local absolute packages
    // (e.g. `import calculator`) are still flagged as product imports.
    const root = spec.split(".")[0] ?? spec;
    return PYTHON_EXTERNAL.has(root);
  },
};

const PYTHON_EXTERNAL = new Set([
  "abc",
  "asyncio",
  "builtins",
  "collections",
  "contextlib",
  "dataclasses",
  "datetime",
  "functools",
  "importlib",
  "io",
  "json",
  "logging",
  "math",
  "os",
  "pathlib",
  "pytest",
  "re",
  "sys",
  "tempfile",
  "typing",
  "unittest",
  "uuid",
]);

function collect(text: string, pattern: RegExp): AcceptanceLintHit[] {
  const hits: AcceptanceLintHit[] = [];
  for (const match of text.matchAll(pattern)) {
    const target = match[1] ?? "";
    if (!target) continue;
    hits.push({ target, index: match.index ?? 0 });
  }
  return hits;
}
