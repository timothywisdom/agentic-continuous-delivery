"use client";

import { useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import Markdown from "react-markdown";
import {
  artifactKind,
  editorFileHref,
  tokenizeJson,
  tokenizeYaml,
  type SyntaxToken,
} from "../../dist/ui/artifacts.js";

export type Artifact = { name: string; path?: string; contents: string };

export function ArtifactPane({
  artifact,
  fallbackPath,
  onSave,
  saving,
}: {
  artifact: Artifact;
  fallbackPath: string;
  onSave: (name: string, contents: string) => Promise<void>;
  saving?: boolean;
}) {
  const path = artifact.path || fallbackPath;
  const kind = artifactKind(artifact.name);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [draft, setDraft] = useState(artifact.contents);
  const [error, setError] = useState<string | null>(null);
  const dirty = draft !== artifact.contents;

  useEffect(() => {
    setDraft(artifact.contents);
    setError(null);
  }, [artifact.name, artifact.contents]);

  const previewLabel = kind === "markdown" ? "Markdown" : "Preview";
  const editLabel = kind === "markdown" ? "Text" : "Edit";

  const save = async () => {
    if (!dirty) return;
    setError(null);
    try {
      await onSave(artifact.name, draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onEditorKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      void save();
    }
  };

  return (
    <details className="artifact-pane">
      <summary className="artifact-summary">
        <a
          className="artifact-file-link"
          href={editorFileHref(path)}
          title={path}
          onClick={stopToggle}
        >
          {artifact.name}
        </a>
        {dirty ? <span className="unsaved">unsaved</span> : null}
        <span className="view-toggle" role="group" aria-label="Artifact view">
          <button
            type="button"
            aria-pressed={mode === "preview"}
            onClick={(e) => {
              stopToggle(e);
              setMode("preview");
            }}
          >
            {previewLabel}
          </button>
          <button
            type="button"
            aria-pressed={mode === "edit"}
            onClick={(e) => {
              stopToggle(e);
              setMode("edit");
            }}
          >
            {editLabel}
          </button>
        </span>
        <button
          type="button"
          className="artifact-save"
          disabled={!dirty || saving}
          onClick={(e) => {
            stopToggle(e);
            void save();
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </summary>
      <div className={`artifact-body kind-${kind} ${mode === "edit" ? "editing" : ""}`}>
        {mode === "edit" ? (
          <textarea
            className="artifact-editor"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onEditorKey}
            spellCheck={false}
            aria-label={`Edit ${artifact.name}`}
          />
        ) : kind === "markdown" ? (
          <div className="md-body">
            <Markdown>{draft}</Markdown>
          </div>
        ) : kind === "json" ? (
          <Highlighted tokens={tokenizeJson(draft)} />
        ) : kind === "yaml" ? (
          <Highlighted tokens={tokenizeYaml(draft)} />
        ) : (
          <pre>{draft}</pre>
        )}
      </div>
      {error ? <div className="error-line">{error}</div> : null}
    </details>
  );
}

function Highlighted({ tokens }: { tokens: SyntaxToken[] }): ReactNode {
  return (
    <pre className="syntax">
      {tokens.map((t, i) =>
        t.cls ? (
          <span key={i} className={t.cls}>
            {t.text}
          </span>
        ) : (
          <span key={i}>{t.text}</span>
        ),
      )}
    </pre>
  );
}

function stopToggle(e: MouseEvent): void {
  e.stopPropagation();
}
