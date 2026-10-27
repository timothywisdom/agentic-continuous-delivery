"use client";

import { useMemo, useState } from "react";
import { editorFileHref } from "../../dist/ui/artifacts.js";
import type { ReviewRun } from "../../dist/work/reviews.js";

type Finding = ReviewRun["findings"][number];
type Disposition = "new" | "persistent" | "resolved" | "unchanged";

export function ReviewPane({
  reviews,
  repo,
}: {
  reviews: ReviewRun[];
  repo: string;
}) {
  const latest = reviews.at(-1) ?? null;
  const [picked, setPicked] = useState<number | null>(null);
  const selected =
    reviews.find((r) => r.index === picked) ?? latest;
  const [agent, setAgent] = useState("all");
  const [query, setQuery] = useState("");
  const [file, setFile] = useState("all");

  const agents = useMemo(() => {
    if (!selected) return [];
    return [...new Set(selected.findings.map((f) => f.agent))].sort();
  }, [selected]);

  const files = useMemo(() => {
    if (!selected) return [];
    const counts = new Map<string, number>();
    for (const finding of selected.findings) {
      const key = finding.file || "(no file)";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [selected]);

  const visible = useMemo(() => {
    if (!selected) return [];
    const q = query.trim().toLowerCase();
    return selected.findings.filter((finding) => {
      if (agent !== "all" && finding.agent !== agent) return false;
      const path = finding.file || "(no file)";
      if (file !== "all" && path !== file) return false;
      if (!q) return true;
      return `${finding.file} ${finding.issue} ${finding.why} ${finding.agent}`
        .toLowerCase()
        .includes(q);
    });
  }, [selected, agent, file, query]);

  const grouped = useMemo(() => groupByFile(visible), [visible]);

  if (!selected) {
    return (
      <p className="review-empty">
        No reviews yet. Run <code>acd review</code> and the findings show up here.
      </p>
    );
  }

  const blockCount = selected.findings.filter((f) => f.decision === "block").length;

  return (
    <div className="review">
      <div className="review-toolbar">
        <label>
          Review
          <select
            value={selected.index}
            onChange={(e) => {
              setPicked(Number(e.target.value));
              setAgent("all");
              setFile("all");
              setQuery("");
            }}
          >
            {[...reviews].reverse().map((run) => (
              <option key={run.index} value={run.index}>
                {`${run.index === latest?.index ? "Latest · " : ""}#${run.index} · ${formatWhen(run.at)} · ${run.decision} · ${run.findings.length} comment${run.findings.length === 1 ? "" : "s"}`}
              </option>
            ))}
          </select>
        </label>
        <span className={`review-decision ${selected.decision}`}>
          {selected.decision === "block" ? "Changes requested" : "No blocking comments"}
        </span>
        <span className="review-meta">
          {blockCount} blocking · {selected.findings.length} total · {files.length} file
          {files.length === 1 ? "" : "s"}
        </span>
      </div>

      {selected.delta && selected.delta.cycle > 1 ? (
        <div className="review-delta">
          <span>Since review #{selected.index - 1}</span>
          <span className="tag new">{selected.delta.summary.newCount} new</span>
          <span className="tag persistent">
            {selected.delta.summary.persistentCount} still open
          </span>
          <span className="tag resolved">
            {selected.delta.summary.resolvedCount} resolved
          </span>
        </div>
      ) : null}

      {selected.mechanical.length > 0 ? (
        <div className="review-checks">
          {selected.mechanical.map((check) => (
            <span key={check.name} className={check.ok ? "ok" : "bad"} title={check.detail}>
              {check.name} {check.ok ? "passed" : "failed"}
            </span>
          ))}
        </div>
      ) : null}

      <div className="review-filters">
        <label>
          Agent
          <select value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="all">All agents</option>
            {agents.map((name) => (
              <option key={name} value={name}>
                {agentLabel(name)}
              </option>
            ))}
          </select>
        </label>
        <label className="review-search">
          Search
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="File, issue, or why"
            spellCheck={false}
          />
        </label>
      </div>

      <div className="review-body">
        <aside className="review-files">
          <button
            type="button"
            className={file === "all" ? "on" : ""}
            onClick={() => setFile("all")}
          >
            <span>All files</span>
            <span>{selected.findings.length}</span>
          </button>
          {files.map(([path, count]) => (
            <button
              key={path}
              type="button"
              className={file === path ? "on" : ""}
              onClick={() => setFile(path)}
              title={path}
            >
              <span>{fileName(path)}</span>
              <span>{count}</span>
            </button>
          ))}
        </aside>

        <div className="review-threads">
          {grouped.length === 0 ? (
            <p className="review-empty">No comments match this filter.</p>
          ) : (
            grouped.map((group) => (
              <section key={group.file} className="review-file">
                <header>
                  <code>{group.file}</code>
                  <span>
                    {group.findings.length} comment{group.findings.length === 1 ? "" : "s"}
                  </span>
                </header>
                <ol>
                  {group.findings.map((finding, i) => (
                    <Comment
                      key={`${finding.agent}-${finding.line ?? "x"}-${i}`}
                      finding={finding}
                      disposition={disposition(selected, finding)}
                      href={commentHref(repo, finding)}
                    />
                  ))}
                </ol>
              </section>
            ))
          )}
          {selected.delta && selected.delta.resolved.length > 0 && file === "all" && agent === "all" && !query ? (
            <section className="review-file resolved-file">
              <header>
                <code>Resolved</code>
                <span>{selected.delta.resolved.length}</span>
              </header>
              <ol>
                {selected.delta.resolved.map((finding, i) => (
                  <Comment
                    key={`resolved-${finding.agent}-${i}`}
                    finding={finding}
                    disposition="resolved"
                    href={commentHref(repo, finding)}
                  />
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Comment({
  finding,
  disposition: kind,
  href,
}: {
  finding: Finding;
  disposition: Disposition;
  href: string | null;
}) {
  return (
    <li className={`review-comment ${finding.decision}`}>
      <div className="review-comment-top">
        <span className={`agent-pill agent-${slug(finding.agent)}`}>{agentLabel(finding.agent)}</span>
        <span className={`tag ${finding.decision}`}>{finding.decision}</span>
        {kind !== "unchanged" ? <span className={`tag ${kind}`}>{kind}</span> : null}
        <span className="review-loc">
          {finding.line != null ? `line ${finding.line}` : "file"}
        </span>
        {href ? (
          <a className="review-open" href={href}>
            Open
          </a>
        ) : null}
      </div>
      <p className="review-issue">{finding.issue}</p>
      {finding.why ? <p className="review-why">{finding.why}</p> : null}
    </li>
  );
}

function groupByFile(findings: Finding[]): { file: string; findings: Finding[] }[] {
  const order: string[] = [];
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key = finding.file || "(no file)";
    const list = groups.get(key);
    if (list) list.push(finding);
    else {
      order.push(key);
      groups.set(key, [finding]);
    }
  }
  return order.map((file) => ({ file, findings: groups.get(file) ?? [] }));
}

function disposition(run: ReviewRun, finding: Finding): Disposition {
  const delta = run.delta;
  if (!delta || delta.cycle <= 1) return "unchanged";
  if (delta.new.some((item) => sameFinding(item, finding))) return "new";
  if (delta.persistent.some((item) => sameFinding(item, finding))) return "persistent";
  return "unchanged";
}

function sameFinding(a: Finding, b: Finding): boolean {
  return a.agent === b.agent && a.file === b.file && a.issue === b.issue && a.line === b.line;
}

function commentHref(repo: string, finding: Finding): string | null {
  if (!repo || !finding.file) return null;
  const abs = `${repo.replace(/\\/g, "/").replace(/\/$/, "")}/${finding.file.replace(/^\/+/, "")}`;
  const href = editorFileHref(abs);
  return finding.line != null ? `${href}:${finding.line}` : href;
}

function agentLabel(agent: string): string {
  return agent.replace(/_/g, " ");
}

function slug(agent: string): string {
  return agent.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

function fileName(path: string): string {
  const parts = path.split("/");
  return parts.at(-1) || path;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
