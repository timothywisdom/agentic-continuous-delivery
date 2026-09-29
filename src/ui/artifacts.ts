export type ArtifactKind = "markdown" | "json" | "yaml" | "text";

export function artifactKind(name: string): ArtifactKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  return "text";
}

/** Open a local file in VS Code / Cursor from the UI (http pages cannot use file://). */
export function editorFileHref(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/");
  const path = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `vscode://file${path}`;
}

export type SyntaxToken = { cls?: string; text: string };

export function tokenizeJson(input: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  const re =
    /("(?:\\.|[^"\\])*")(\s*)(:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|(\s+)|([{}[\]:,])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    if (m.index > last) tokens.push({ text: input.slice(last, m.index) });
    if (m[1] !== undefined) {
      tokens.push({ cls: m[3] ? "tok-key" : "tok-str", text: m[1] });
      if (m[2]) tokens.push({ text: m[2] });
      if (m[3]) tokens.push({ cls: "tok-punct", text: m[3] });
    } else if (m[4]) tokens.push({ cls: "tok-num", text: m[4] });
    else if (m[5]) tokens.push({ cls: "tok-kw", text: m[5] });
    else if (m[6]) tokens.push({ text: m[6] });
    else if (m[7]) tokens.push({ cls: "tok-punct", text: m[7] });
    last = re.lastIndex;
  }
  if (last < input.length) tokens.push({ text: input.slice(last) });
  return mergePlain(tokens);
}

export function tokenizeYaml(input: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  for (const line of input.split(/(?<=\n)/)) {
    highlightYamlLine(line, tokens);
  }
  return mergePlain(tokens);
}

function highlightYamlLine(line: string, tokens: SyntaxToken[]): void {
  const hash = yamlCommentIndex(line);
  const code = hash >= 0 ? line.slice(0, hash) : line;
  const comment = hash >= 0 ? line.slice(hash) : "";
  const m = code.match(/^([\t ]*)(-[\t ]+)?([^:#\n]+?)([\t ]*:)([\t ]*)([\s\S]*)$/);
  if (m && m[3].trim() !== "") {
    if (m[1]) tokens.push({ text: m[1] });
    if (m[2]) tokens.push({ cls: "tok-punct", text: m[2] });
    tokens.push({ cls: "tok-key", text: m[3] });
    tokens.push({ cls: "tok-punct", text: m[4] });
    if (m[5]) tokens.push({ text: m[5] });
    pushYamlValue(m[6], tokens);
  } else if (code) {
    tokens.push({ text: code });
  }
  if (comment) tokens.push({ cls: "tok-comment", text: comment });
}

function yamlCommentIndex(line: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const prev = i > 0 ? line[i - 1] : "";
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle && prev !== "\\") inDouble = !inDouble;
    else if (c === "#" && !inSingle && !inDouble) return i;
  }
  return -1;
}

function pushYamlValue(value: string, tokens: SyntaxToken[]): void {
  if (!value) return;
  const nl = value.match(/\r?\n$/)?.[0] ?? "";
  const core = nl ? value.slice(0, -nl.length) : value;
  const trimmed = core.trimStart();
  const lead = core.slice(0, core.length - trimmed.length);
  if (lead) tokens.push({ text: lead });
  if (/^(true|false|null|yes|no|on|off)$/i.test(trimmed)) {
    tokens.push({ cls: "tok-kw", text: trimmed });
  } else if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    tokens.push({ cls: "tok-num", text: trimmed });
  } else if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    tokens.push({ cls: "tok-str", text: trimmed });
  } else if (trimmed) {
    tokens.push({ cls: "tok-str", text: trimmed });
  }
  if (nl) tokens.push({ text: nl });
}

function mergePlain(tokens: SyntaxToken[]): SyntaxToken[] {
  const out: SyntaxToken[] = [];
  for (const t of tokens) {
    if (!t.text) continue;
    const prev = out.at(-1);
    if (prev && prev.cls === t.cls) prev.text += t.text;
    else out.push({ ...t });
  }
  return out;
}
