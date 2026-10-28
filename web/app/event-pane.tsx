"use client";

import { useMemo, useState } from "react";
import { summarizeEvent } from "../../dist/work/event-summary.js";

export type SessionEvent = {
  at: string;
  workId: string;
  type: string;
  stage?: string;
  data?: Record<string, unknown>;
};

export function EventPane({ events }: { events: SessionEvent[] }) {
  const [type, setType] = useState("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  const types = useMemo(
    () => [...new Set(events.map((event) => event.type))].sort(),
    [events],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => {
        if (type !== "all" && event.type !== type) return false;
        if (!q) return true;
        const summary = summarizeEvent(event);
        return `${event.type} ${event.stage ?? ""} ${summary}`.toLowerCase().includes(q);
      });
  }, [events, type, query]);

  if (events.length === 0) {
    return (
      <p className="review-empty">
        No events yet. Run <code>acd intake</code> and the session log shows up here.
      </p>
    );
  }

  return (
    <div className="event-log">
      <div className="review-toolbar">
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">All events</option>
            {types.map((name) => (
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
            placeholder="Type, stage, or decision"
          />
        </label>
        <span className="event-count">
          {visible.length} of {events.length}
        </span>
      </div>
      <ol className="event-list">
        {visible.map(({ event, index }) => {
          const expanded = open === index;
          return (
            <li key={`${event.at}-${index}`} className={expanded ? "open" : ""}>
              <button
                type="button"
                className="event-row"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : index)}
              >
                <span className="event-index">{index + 1}</span>
                <time dateTime={event.at}>{formatWhen(event.at)}</time>
                <span className="event-type">{event.type}</span>
                {event.stage ? <span className="event-stage">{event.stage}</span> : null}
                <span className="event-summary">{summarizeEvent(event)}</span>
              </button>
              {expanded ? (
                <pre className="event-json">{JSON.stringify(event.data ?? {}, null, 2)}</pre>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function formatWhen(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
