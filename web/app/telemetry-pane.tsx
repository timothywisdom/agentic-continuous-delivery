"use client";

import { useMemo, useState } from "react";
import type { TelemetrySpanRecord } from "../../dist/telemetry/record.js";

export function TelemetryPane({
  spans,
  running,
}: {
  spans: TelemetrySpanRecord[];
  running: boolean;
}) {
  const tree = useMemo(() => nestSpans(spans), [spans]);
  const totals = useMemo(() => summarize(spans), [spans]);

  return (
    <section className="panel tel-panel">
      <h2>Telemetry</h2>
      <div className="panel-body tel-body">
        <div className="tel-totals">
          <span>
            {running ? "Live" : spans.length ? "Last run" : "Idle"} · {spans.length}{" "}
            span{spans.length === 1 ? "" : "s"}
          </span>
          <span>{formatDuration(totals.durationMs)}</span>
          <span>{formatUsd(totals.costUsd)}</span>
        </div>
        {tree.length === 0 ? (
          <p className="tel-empty">
            Duration, cost, the step decision, and structured output appear here while
            a command runs.
          </p>
        ) : (
          <ol className="tel-tree">
            {tree.map((node) => (
              <SpanNode key={node.span.spanId} node={node} depth={0} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

type TreeNode = { span: TelemetrySpanRecord; children: TreeNode[] };

function nestSpans(spans: TelemetrySpanRecord[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const span of spans) {
    byId.set(span.spanId, { span, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.span.parentSpanId
      ? byId.get(node.span.parentSpanId)
      : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function summarize(spans: TelemetrySpanRecord[]): {
  durationMs: number;
  costUsd: number;
} {
  const command = spans.find((s) => s.name.startsWith("acd.command."));
  if (command) {
    return { durationMs: command.durationMs, costUsd: command.costUsd };
  }
  return {
    durationMs: Math.max(0, ...spans.map((s) => s.durationMs), 0),
    costUsd: spans.reduce((sum, s) => sum + (s.costUsd || 0), 0),
  };
}

function SpanNode({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(false);
  const s = node.span;
  const kind = s.name.startsWith("acd.harness.")
    ? "harness"
    : s.name.startsWith("acd.stage.")
      ? "stage"
      : "command";
  return (
    <li className={`tel-node ${kind} ${s.status}`}>
      <button
        type="button"
        className="tel-row"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="tel-name">{shortName(s.name)}</span>
        <span className="tel-decision" title={s.decision}>
          {s.decision || "—"}
        </span>
        <span className="tel-dur">{formatDuration(s.durationMs)}</span>
        <span className="tel-cost">{formatUsd(s.costUsd)}</span>
      </button>
      {open && s.output !== undefined ? (
        <pre className="tel-json">{JSON.stringify(s.output, null, 2)}</pre>
      ) : null}
      {node.children.length > 0 ? (
        <ol className="tel-tree">
          {node.children.map((child) => (
            <SpanNode key={child.span.spanId} node={child} depth={depth + 1} />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

function shortName(name: string): string {
  return name.replace(/^acd\.(command|stage|harness)\./, "");
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
}
