import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeKitJsonSchemas } from "../schemas/write-json.js";
import { acdHome } from "../paths.js";

const kitAcD = join(dirname(fileURLToPath(import.meta.url)), "../../acd");

const ACD_GITIGNORE = `work/
acd.config.local.yaml
.env
.env.local
`;

const ROOT_IGNORE_LINES = [
  ".acd/work/",
  ".acd/acd.config.local.yaml",
  ".acd/.env",
  ".acd/.env.local",
];

export function initRepo(targetRoot: string, options?: { cursorIde?: boolean }): void {
  const home = acdHome(targetRoot);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, ".gitignore"), ACD_GITIGNORE);
  ensureRootGitignore(targetRoot);

  cpSync(join(kitAcD, "config"), join(home, "config"), { recursive: true });
  cpSync(join(kitAcD, "skills"), join(home, "skills"), { recursive: true });
  cpSync(join(kitAcD, "agents"), join(home, "agents"), { recursive: true });
  cpSync(join(kitAcD, "templates"), join(home, "templates"), { recursive: true });
  cpSync(
    join(kitAcD, "system-constraints.yaml"),
    join(home, "system-constraints.yaml"),
  );
  writeKitJsonSchemas(join(home, "schemas"));

  const configDest = join(home, "acd.config.yaml");
  if (!existsSync(configDest) && !existsSync(join(targetRoot, "acd.config.yaml"))) {
    cpSync(join(kitAcD, "config", "acd.config.default.yaml"), configDest);
  }

  const workflowDir = join(targetRoot, ".github", "workflows");
  mkdirSync(workflowDir, { recursive: true });
  cpSync(
    join(kitAcD, "adapters", "github", "acd-ci-review.yml"),
    join(workflowDir, "acd-ci-review.yml"),
  );

  if (options?.cursorIde !== false) {
    copyCursorAdapter(targetRoot);
    const agents = join(kitAcD, "adapters", "cursor-ide", "AGENTS.md");
    if (!existsSync(join(targetRoot, "AGENTS.md"))) {
      cpSync(agents, join(targetRoot, "AGENTS.md"));
    }
  }

  const localExampleSrc = join(kitAcD, "config", "acd.config.local.yaml.example");
  const localExampleDest = join(home, "acd.config.local.yaml.example");
  if (existsSync(localExampleSrc)) {
    cpSync(localExampleSrc, localExampleDest);
  } else {
    writeFileSync(
      localExampleDest,
      "# Copy to .acd/acd.config.local.yaml\n# Set defaults.harness; put API keys in .acd/.env.local.\n",
    );
  }

  const envExampleSrc = join(kitAcD, "config", ".env.local.example");
  const envExampleDest = join(home, ".env.local.example");
  if (existsSync(envExampleSrc) && !existsSync(envExampleDest)) {
    cpSync(envExampleSrc, envExampleDest);
  }
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

function ensureRootGitignore(targetRoot: string): void {
  const path = join(targetRoot, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const have = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const toAdd = ROOT_IGNORE_LINES.filter((line) => !have.has(line));
  if (toAdd.length === 0) return;
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(path, `${existing}${prefix}${toAdd.join("\n")}\n`);
}
