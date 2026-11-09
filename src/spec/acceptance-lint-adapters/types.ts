export interface AcceptanceLintHit {
  /** Import path, module name, or filesystem path literal. */
  target: string;
  /** Character offset in the source text for line mapping. */
  index: number;
}

/**
 * Language-specific static smells for acceptance tests.
 * Core lint (scenario binding, step comments, path roots) stays shared;
 * each adapter owns import / source-read / console-spy detection for one stack.
 */
export interface AcceptanceLintAdapter {
  /** Stable id used in messages and config docs (e.g. javascript, python). */
  id: string;
  /** True when this adapter should lint the given repo-relative path. */
  matchesFile(relPath: string): boolean;
  /** True when the path looks like an acceptance test file for this language. */
  isTestFile(relPath: string): boolean;
  extractImports(text: string): AcceptanceLintHit[];
  extractSourceReads(text: string): AcceptanceLintHit[];
  hasConsoleSpy(text: string): boolean;
  /** Package / stdlib / third-party import that should not be treated as product code. */
  isExternalImport(spec: string): boolean;
}
