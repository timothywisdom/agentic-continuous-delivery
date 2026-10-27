import { graphNodeEmphasis } from "../../dist/ui/cli-args.js";

const NW = 112;
const NH = 32;

type Side = "n" | "e" | "s" | "w";
type Kind = "pipeline" | "loop" | "fix" | "stub";

type GNode = {
  id: string;
  command: string;
  label: string;
  kind: Kind;
  x: number;
  y: number;
};

type Edge = {
  from: string;
  to: string;
  fromSide: Side;
  toSide: Side;
  kind: "flow" | "return";
  fromBend?: number;
  toBend?: number;
  /** Keep a long return arrow above the nodes it would otherwise cross. */
  lift?: number;
};

type Point = { x: number; y: number };

const NODES: GNode[] = [
  { id: "intake", command: "intake", label: "intake", kind: "pipeline", x: 24, y: 16 },
  { id: "specify", command: "specify", label: "specify", kind: "pipeline", x: 206, y: 16 },
  { id: "implement", command: "implement", label: "implement", kind: "pipeline", x: 388, y: 16 },
  { id: "review", command: "review", label: "review", kind: "pipeline", x: 570, y: 16 },
  { id: "pr", command: "pr", label: "pr", kind: "pipeline", x: 752, y: 84 },
  { id: "ci_review", command: "ci-review", label: "ci-review", kind: "pipeline", x: 752, y: 160 },
  { id: "deploy", command: "deploy", label: "deploy", kind: "stub", x: 570, y: 244 },
  { id: "canary", command: "canary", label: "canary", kind: "stub", x: 388, y: 244 },
  { id: "hypothesis", command: "hypothesis", label: "hypothesis", kind: "stub", x: 24, y: 244 },
  { id: "revise", command: "revise", label: "revise", kind: "loop", x: 206, y: 104 },
  { id: "fix", command: "fix", label: "fix", kind: "fix", x: 388, y: 104 },
  { id: "rollback", command: "rollback", label: "rollback", kind: "stub", x: 206, y: 176 },
];

const EDGES: Edge[] = [
  { from: "intake", to: "specify", fromSide: "e", toSide: "w", kind: "flow" },
  { from: "specify", to: "implement", fromSide: "e", toSide: "w", kind: "flow" },
  { from: "implement", to: "review", fromSide: "e", toSide: "w", kind: "flow" },
  { from: "review", to: "pr", fromSide: "e", toSide: "w", kind: "flow" },
  { from: "pr", to: "ci_review", fromSide: "s", toSide: "n", kind: "flow" },
  { from: "ci_review", to: "deploy", fromSide: "s", toSide: "e", kind: "flow" },
  { from: "deploy", to: "canary", fromSide: "w", toSide: "e", kind: "flow" },
  { from: "canary", to: "hypothesis", fromSide: "w", toSide: "e", kind: "flow" },
  { from: "hypothesis", to: "intake", fromSide: "n", toSide: "s", kind: "flow", fromBend: -22, toBend: -22 },
  { from: "review", to: "revise", fromSide: "s", toSide: "e", kind: "return", fromBend: -40, lift: 68 },
  { from: "revise", to: "specify", fromSide: "n", toSide: "s", kind: "return" },
  { from: "implement", to: "fix", fromSide: "s", toSide: "n", kind: "return", fromBend: -18, toBend: -18 },
  { from: "fix", to: "implement", fromSide: "n", toSide: "s", kind: "return", fromBend: 18, toBend: 18 },
  { from: "canary", to: "rollback", fromSide: "n", toSide: "e", kind: "return" },
  { from: "rollback", to: "hypothesis", fromSide: "s", toSide: "n", kind: "return", toBend: 22 },
];

const GATES: { stage: string; x: number; y: number }[] = [
  { stage: "specify", x: 353, y: 68 },
  { stage: "review", x: 717, y: 66 },
];

const GATE_COMMANDS = ["approve", "reject", "amend"] as const;

const ANYTIME = ["status", "list", "artifacts", "test", "config"] as const;

export function CycleGraph({
  state,
  selected,
  selectedStage,
  onPick,
}: {
  state: {
    currentStage: string;
    completedStages: string[];
    awaitingApproval: string | null;
    awaitingGuidance: string | null;
  } | null;
  selected: string;
  selectedStage: string;
  onPick: (pick: { command: string; stage?: string }) => void;
}) {
  const byId = new Map(NODES.map((node) => [node.id, node]));
  return (
    <svg className="graph" viewBox="0 0 900 344" role="group" aria-label="ACD cycle">
      <defs>
        <marker id="cycle-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 Z" fill="#7d8b9c" />
        </marker>
        <marker id="cycle-arrow-return" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 Z" fill="#e3b341" />
        </marker>
      </defs>
      {EDGES.map((edge) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) return null;
        const start = port(from, edge.fromSide, edge.fromBend ?? 0);
        const end = port(to, edge.toSide, edge.toBend ?? 0);
        return (
          <path
            key={`${edge.from}-${edge.to}`}
            d={curve(start, end, edge.fromSide, edge.toSide, edge.lift)}
            className={edge.kind === "return" ? "edge return" : "edge flow"}
            markerEnd={edge.kind === "return" ? "url(#cycle-arrow-return)" : "url(#cycle-arrow)"}
          />
        );
      })}
      <text className="cycle-note" x="78" y="156">
        new cycle
      </text>
      {GATES.map((gate) =>
        GATE_COMMANDS.map((command, index) => {
          const active = selected === command && selectedStage === gate.stage;
          return (
            <g
              key={`${gate.stage}-${command}`}
              className={active ? "gate selected" : "gate"}
              role="button"
              tabIndex={0}
              aria-label={`${command} ${gate.stage}`}
              onClick={() => onPick({ command, stage: gate.stage })}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onPick({ command, stage: gate.stage });
                }
              }}
            >
              <rect x={gate.x - 30} y={gate.y + index * 13 - 10} width="60" height="13" />
              <text x={gate.x} y={gate.y + index * 13} textAnchor="middle">
                {command}
              </text>
            </g>
          );
        }),
      )}
      {NODES.map((node) => {
        const emphasis = graphNodeEmphasis(node.id, state);
        const classes = ["node", node.kind];
        if (emphasis) classes.push(emphasis);
        if (selected === node.command) classes.push("selected");
        return (
          <g
            key={node.id}
            className={classes.join(" ")}
            transform={`translate(${node.x},${node.y})`}
            role="button"
            tabIndex={0}
            aria-label={node.label}
            onClick={() => onPick({ command: node.command })}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onPick({ command: node.command });
              }
            }}
          >
            <rect width={NW} height={NH} rx="6" />
            <text x={NW / 2} y="21" textAnchor="middle">
              {node.label}
            </text>
          </g>
        );
      })}
      {ANYTIME.map((command, index) => {
        const width = 84;
        const x = 248 + index * (width + 10);
        const y = 304;
        return (
          <g
            key={command}
            className={selected === command ? "chip selected" : "chip"}
            role="button"
            tabIndex={0}
            aria-label={command}
            onClick={() => onPick({ command })}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onPick({ command });
              }
            }}
          >
            <rect x={x} y={y} width={width} height="24" rx="12" />
            <text x={x + width / 2} y={y + 16} textAnchor="middle">
              {command}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function port(node: GNode, side: Side, bend: number): Point {
  const cx = node.x + NW / 2 + (side === "n" || side === "s" ? bend : 0);
  const cy = node.y + NH / 2 + (side === "e" || side === "w" ? bend : 0);
  switch (side) {
    case "n":
      return { x: cx, y: node.y };
    case "s":
      return { x: cx, y: node.y + NH };
    case "w":
      return { x: node.x, y: cy };
    case "e":
      return { x: node.x + NW, y: cy };
  }
}

function curve(start: Point, end: Point, from: Side, to: Side, lift?: number): string {
  if (lift != null) {
    const c1 = { x: start.x + (end.x - start.x) * 0.28, y: lift };
    const c2 = { x: start.x + (end.x - start.x) * 0.82, y: lift };
    return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
  }
  const span = Math.hypot(end.x - start.x, end.y - start.y);
  const dist = Math.max(16, Math.min(42, span * 0.45));
  const c1 = shift(start, from, dist);
  const c2 = shift(end, to, dist);
  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
}

function shift(point: Point, side: Side, dist: number): Point {
  switch (side) {
    case "n":
      return { x: point.x, y: point.y - dist };
    case "s":
      return { x: point.x, y: point.y + dist };
    case "w":
      return { x: point.x - dist, y: point.y };
    case "e":
      return { x: point.x + dist, y: point.y };
  }
}
