import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { acdHome } from "../paths.js";

const kitAcD = join(dirname(fileURLToPath(import.meta.url)), "../../acd");

const ACD_GITIGNORE = `work/
acd.config.local.yaml
.env
.env.local
`;

export interface InitOptions {
  /** Copy Cursor rules/skills + AGENTS.md at the repo root (Cursor requires those paths). */
  cursorIde?: boolean;
  /** Copy `.github/workflows/acd-ci-review.yml` (GitHub requires `.github/`). */
  github?: boolean;
}

export function initRepo(targetRoot: string, options: InitOptions = {}): void {
  const home = acdHome(targetRoot);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, ".gitignore"), ACD_GITIGNORE);

  const configDest = join(home, "acd.config.yaml");
  if (!existsSync(configDest) && !existsSync(join(targetRoot, "acd.config.yaml"))) {
    const consumer = join(kitAcD, "config", "acd.config.consumer.yaml");
    const fallback = join(kitAcD, "config", "acd.config.default.yaml");
    cpSync(existsSync(consumer) ? consumer : fallback, configDest);
  }

  const constraintsSrc = join(kitAcD, "system-constraints.yaml");
  const constraintsDest = join(home, "system-constraints.yaml");
  if (existsSync(constraintsSrc) && !existsSync(constraintsDest)) {
    cpSync(constraintsSrc, constraintsDest);
  }

  copyIfPresent(
    join(kitAcD, "config", "acd.config.local.yaml.example"),
    join(home, "acd.config.local.yaml.example"),
  );
  copyIfPresent(
    join(kitAcD, "config", ".env.local.example"),
    join(home, ".env.local.example"),
  );

  if (options.github) {
    const workflowDir = join(targetRoot, ".github", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    cpSync(
      join(kitAcD, "adapters", "github", "acd-ci-review.yml"),
      join(workflowDir, "acd-ci-review.yml"),
    );
  }

  if (options.cursorIde) {
    copyCursorAdapter(targetRoot);
    const agents = join(kitAcD, "adapters", "cursor-ide", "AGENTS.md");
    if (existsSync(agents) && !existsSync(join(targetRoot, "AGENTS.md"))) {
      cpSync(agents, join(targetRoot, "AGENTS.md"));
    }
  }
}

function copyIfPresent(src: string, dest: string): void {
  if (existsSync(src) && !existsSync(dest)) cpSync(src, dest);
}

function copyCursorAdapter(targetRoot: string): void {
  const src = join(kitAcD, "adapters", "cursor-ide");
  if (!existsSync(src)) return;
  const dest = join(targetRoot, ".cursor");
  mkdirSync(dest, { recursive: true });
  for (const name of ["rules", "skills"]) {
    const from = join(src, name);
    if (existsSync(from)) {
      cpSync(from, join(dest, name), { recursive: true });
    }
  }
}
