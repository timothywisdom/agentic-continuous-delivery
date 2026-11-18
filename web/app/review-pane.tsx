"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReviewRun } from "../../dist/work/reviews.js";
import type { WaivedFinding, WaiveReason } from "../../dist/types/work.js";
import { WAIVE_REASONS } from "../../dist/types/work.js";
import { formatAcDCliPreview } from "../../dist/ui/cli-args.js";
import {
  openReviewFindings,
  resolvedReviewFindings,
  reviewFileCounts,
  reviewToolbarCounts,
} from "../../dist/ui/review-view.js";

type Finding = ReviewRun["findings"][number] & { key?: string };
type Disposition = "new" | "persistent" | "resolved" | "unchanged";

export function ReviewPane({
  reviews,
  waivers = [],
  repo,
  workId,
  onWaive,
  onOpenFile,
}: {
  reviews: ReviewRun[];
  waivers?: WaivedFinding[];
  repo: string;
  workId?: string;
  onWaive?: (
    key: string,
    reason: WaiveReason,
    explanation: string | null,
  ) => Promise<void> | void;
  onOpenFile?: (file: string, line: number | null) => Promise<void> | void;
}) {
  const latest = reviews.at(-1) ?? null;
  const [picked, setPicked] = useState<number | null>(null);
  const selected =
    reviews.find((r) => r.index === picked) ?? latest;
  const [agent, setAgent] = useState("all");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [file, setFile] = useState("all");
  const [waiveTarget, setWaiveTarget] = useState<Finding | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const openFindings = useMemo(
    () => (selected ? openReviewFindings(selected.findings, waivers) : []),
    [selected, waivers],
  );

  const resolvedFindings = useMemo(
    () =>
      selected
        ? resolvedReviewFindings(
            selected.findings,
            waivers,
            selected.delta?.resolved ?? [],
          )
        : [],
    [selected, waivers],
  );

  const agents = useMemo(() => {
    return [...new Set(openFindings.map((f) => f.agent))].sort();
  }, [openFindings]);

  const categories = useMemo(() => {
    return [...new Set(openFindings.map((f) => f.category ?? "code"))].sort();
  }, [openFindings]);

  const files = useMemo(() => reviewFileCounts(openFindings), [openFindings]);

  useEffect(() => {
    if (file === "all") return;
    if (!files.some(([path]) => path === file)) setFile("all");
  }, [file, files]);

  const waivedKeys = useMemo(
    () => new Set(waivers.map((item) => item.key)),
    [waivers],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return openFindings.filter((finding) => {
      if (agent !== "all" && finding.agent !== agent) return false;
      if (category !== "all" && (finding.category ?? "code") !== category) {
        return false;
      }
      const path = finding.file || "(no file)";
      if (file !== "all" && path !== file) return false;
      if (!q) return true;
      return `${finding.file} ${finding.issue} ${finding.why} ${finding.agent} ${finding.severity ?? ""} ${finding.category ?? ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [openFindings, agent, category, file, query]);

  const grouped = useMemo(() => groupByCategoryThenFile(visible), [visible]);

  const counts = useMemo(
    () =>
      selected
        ? reviewToolbarCounts(selected.findings, waivers)
        : { open: 0, blocking: 0, files: 0, waived: 0 },
    [selected, waivers],
  );

  if (!selected) {
    return (
      <p className="review-empty">
        No reviews yet. Run <code>acd review</code> and the findings show up here.
      </p>
    );
  }

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
              setCategory("all");
              setFile("all");
              setQuery("");
            }}
          >
            {[...reviews].reverse().map((run) => (
              <option key={run.index} value={run.index}>
                {`${run.index === latest?.index ? "Latest · " : ""}#${run.index} · ${formatWhen(run.at)} · ${run.decision} · ${
                  run === selected
                    ? counts.open
                    : openReviewFindings(run.findings, waivers).length
                } open`}
              </option>
            ))}
          </select>
        </label>
        <span className={`review-decision ${counts.blocking > 0 ? "block" : "pass"}`}>
          {counts.blocking > 0 ? "Changes requested" : "No blocking comments"}
        </span>
        <span className="review-meta">
          {counts.blocking} blocking · {counts.open} open · {counts.files} file
          {counts.files === 1 ? "" : "s"}
          {counts.waived > 0 ? ` · ${counts.waived} waived` : ""}
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
            <span
              key={check.name}
              className={check.skipped ? "skipped" : check.ok ? "ok" : "bad"}
              title={check.detail}
            >
              {check.name} {check.skipped ? "skipped" : check.ok ? "passed" : "failed"}
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
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All categories</option>
            {categories.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="review-search">
          Search
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="File, issue, severity, or why"
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
            <span>{openFindings.length}</span>
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
              <section key={`${group.category}:${group.file}`} className="review-file">
                <header>
                  <code>
                    <span className={`tag category-${group.category}`}>{group.category}</span>{" "}
                    {group.file}
                  </code>
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
                      pathLabel={commentPath(repo, finding)}
                      onOpen={
                        onOpenFile && finding.file
                          ? () => onOpenFile(finding.file, finding.line)
                          : undefined
                      }
                      onWaive={
                        onWaive && finding.key && !waivedKeys.has(finding.key)
                          ? () => {
                              setFormError(null);
                              setWaiveTarget(finding);
                            }
                          : undefined
                      }
                    />
                  ))}
                </ol>
              </section>
            ))
          )}
          {resolvedFindings.length > 0 &&
          file === "all" &&
          agent === "all" &&
          category === "all" &&
          !query ? (
            <section className="review-file resolved-file">
              <header>
                <code>Resolved</code>
                <span>{resolvedFindings.length}</span>
              </header>
              <ol>
                {resolvedFindings.map((finding, i) => (
                  <Comment
                    key={`resolved-${finding.key ?? finding.agent}-${i}`}
                    finding={finding}
                    disposition="resolved"
                    pathLabel={commentPath(repo, finding)}
                    waived={finding.waived}
                    onOpen={
                      onOpenFile && finding.file
                        ? () => onOpenFile(finding.file, finding.line)
                        : undefined
                    }
                  />
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      </div>

      {waiveTarget?.key && onWaive ? (
        <WaiveOverlay
          finding={waiveTarget}
          workId={workId ?? ""}
          busy={busy}
          error={formError}
          onCancel={() => {
            if (busy) return;
            setWaiveTarget(null);
            setFormError(null);
          }}
          onSubmit={async (reason, explanation) => {
            setBusy(true);
            setFormError(null);
            try {
              await onWaive(waiveTarget.key!, reason, explanation);
              setWaiveTarget(null);
            } catch (err) {
              setFormError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function WaiveOverlay({
  finding,
  workId,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  finding: Finding;
  workId: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (reason: WaiveReason, explanation: string | null) => Promise<void>;
}) {
  const [reason, setReason] = useState<WaiveReason>("accepted-risk");
  const [explanation, setExplanation] = useState("");
  const reasonRef = useRef<HTMLSelectElement>(null);
  const key = finding.key ?? "";

  useEffect(() => {
    reasonRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const preview = formatAcDCliPreview({
    command: "waive",
    args: [key],
    flags: {
      reason,
      ...(explanation.trim() ? { explanation: explanation.trim() } : {}),
      ...(workId ? { "work-id": workId } : {}),
    },
  });

  return (
    <div
      className="waive-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <form
        className="waive-form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="waive-form-title"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(reason, explanation.trim() || null);
        }}
      >
        <header>
          <h3 id="waive-form-title">Drive CLI · waive</h3>
          <button type="button" className="waive-close" disabled={busy} onClick={onCancel}>
            Esc
          </button>
        </header>

        <p className="waive-issue">{finding.issue}</p>
        <p className="waive-meta">
          {agentLabel(finding.agent)}
          {finding.file ? ` · ${finding.file}` : ""}
          {finding.line != null ? `:${finding.line}` : ""}
        </p>

        <label>
          Finding key
          <input value={key} readOnly spellCheck={false} />
        </label>

        <label>
          --reason
          <select
            ref={reasonRef}
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value as WaiveReason)}
          >
            {WAIVE_REASONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label>
          --explanation (optional)
          <textarea
            value={explanation}
            disabled={busy}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder="Why this finding is waived"
            rows={3}
          />
        </label>

        {workId ? (
          <label>
            --work-id
            <input value={workId} readOnly spellCheck={false} />
          </label>
        ) : null}

        <div className="cli-preview" aria-live="polite">
          <div className="cli-preview-label">CLI command</div>
          <pre className="cli-preview-cmd">{preview}</pre>
        </div>

        {error ? <div className="error-line">{error}</div> : null}

        <div className="actions">
          <button type="submit" className="run-btn" disabled={busy || !key}>
            {busy ? "Running…" : "Run acd waive"}
          </button>
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function Comment({
  finding,
  disposition: kind,
  pathLabel,
  waived,
  onOpen,
  onWaive,
}: {
  finding: Finding;
  disposition: Disposition;
  pathLabel: string | null;
  waived?: boolean;
  onOpen?: () => void;
  onWaive?: () => void;
}) {
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  return (
    <li className={`review-comment ${finding.decision}`}>
      <div className="review-comment-top">
        <span className={`agent-pill agent-${slug(finding.agent)}`}>{agentLabel(finding.agent)}</span>
        <span className={`tag severity-${finding.severity ?? "major"}`}>
          {finding.severity ?? "major"}
        </span>
        <span className={`tag category-${finding.category ?? "code"}`}>
          {finding.category ?? "code"}
        </span>
        <span className={`tag ${finding.decision}`}>{finding.decision}</span>
        {waived ? <span className="tag advisory">waived</span> : null}
        {kind !== "unchanged" ? <span className={`tag ${kind}`}>{kind}</span> : null}
        <span className="review-loc">
          {finding.line != null ? `line ${finding.line}` : "file"}
          {finding.scenario ? ` · ${finding.scenario}` : ""}
          {finding.key ? ` · ${finding.key}` : ""}
        </span>
        {onOpen ? (
          <button
            type="button"
            className="review-open"
            title={pathLabel ?? finding.file}
            disabled={opening}
            onClick={() => {
              setOpening(true);
              setOpenError(null);
              void Promise.resolve(onOpen())
                .catch((err) => {
                  setOpenError(err instanceof Error ? err.message : String(err));
                })
                .finally(() => setOpening(false));
            }}
          >
            {opening ? "Opening…" : "Open"}
          </button>
        ) : null}
        {onWaive ? (
          <button type="button" className="review-waive" onClick={onWaive}>
            Waive
          </button>
        ) : null}
      </div>
      {openError ? <p className="review-why error-line">{openError}</p> : null}
      <p className="review-issue">{finding.issue}</p>
      {finding.why ? <p className="review-why">{finding.why}</p> : null}
      {finding.evidence?.spec || finding.evidence?.code ? (
        <p className="review-why">
          {finding.evidence.spec ? `spec: ${finding.evidence.spec}` : null}
          {finding.evidence.spec && finding.evidence.code ? " · " : null}
          {finding.evidence.code ? `code: ${finding.evidence.code}` : null}
        </p>
      ) : null}
    </li>
  );
}

function groupByCategoryThenFile(
  findings: Finding[],
): { category: string; file: string; findings: Finding[] }[] {
  const order: string[] = [];
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const category = finding.category ?? "code";
    const file = finding.file || "(no file)";
    const key = `${category}\0${file}`;
    const list = groups.get(key);
    if (list) list.push(finding);
    else {
      order.push(key);
      groups.set(key, [finding]);
    }
  }
  return order.map((key) => {
    const [category, file] = key.split("\0");
    return { category: category ?? "code", file: file ?? "(no file)", findings: groups.get(key) ?? [] };
  });
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

function commentPath(repo: string, finding: Finding): string | null {
  if (!finding.file) return null;
  if (!repo) return finding.file;
  const abs = `${repo.replace(/\\/g, "/").replace(/\/$/, "")}/${finding.file.replace(/^\/+/, "")}`;
  return finding.line != null ? `${abs}:${finding.line}` : abs;
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
