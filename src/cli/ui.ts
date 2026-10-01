import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

export function webAppDir(): string {
  return join(kitRoot, "web");
}

export function defaultUiPort(): number {
  const raw = process.env.ACD_UI_PORT?.trim();
  const n = raw ? Number(raw) : 4173;
  return Number.isFinite(n) && n > 0 ? n : 4173;
}

/** True only after `next build`. `next dev` also creates `.next/server` without BUILD_ID. */
export function hasProductionUiBuild(webDir: string): boolean {
  const idPath = join(webDir, ".next", "BUILD_ID");
  if (!existsSync(idPath)) return false;
  try {
    return readFileSync(idPath, "utf8").trim().length > 0;
  } catch {
    return false;
  }
}

export async function startUi(opts: {
  repoRoot: string;
  port?: number;
}): Promise<void> {
  const dir = webAppDir();
  if (!existsSync(join(dir, "package.json"))) {
    throw new Error(
      `Web UI not found at ${dir}. Reinstall acd-kit or run from the kit repo.`,
    );
  }

  const port = opts.port ?? defaultUiPort();
  const nextBin = resolveNextBin(kitRoot);
  const production = hasProductionUiBuild(dir);
  const args = production
    ? ["start", "-H", "127.0.0.1", "-p", String(port)]
    : ["dev", "-H", "127.0.0.1", "-p", String(port)];

  process.stderr.write(
    `acd-kit: UI on http://127.0.0.1:${port} (bound to 127.0.0.1; drives CLI in ${opts.repoRoot}` +
      `${production ? "" : "; next dev"})\n`,
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [nextBin, ...args], {
      cwd: dir,
      stdio: "inherit",
      env: {
        ...process.env,
        ACD_REPO_ROOT: opts.repoRoot,
        ACD_KIT_ROOT: kitRoot,
        ACD_UI_PORT: String(port),
        HOSTNAME: "127.0.0.1",
        // Next auto-installs TypeScript for next.config.ts; prefer npm so a
        // global yarn CLI cannot trip over acd-kit's package.json.
        npm_config_user_agent: process.env.npm_config_user_agent ?? "npm",
      },
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`UI exited with code ${code}`));
    });
  });
}

/** Resolve `next` from acd-kit's package, including hoisted node_modules (npx cache). */
export function resolveNextBin(fromKitRoot: string = kitRoot): string {
  const require = createRequire(join(fromKitRoot, "package.json"));
  try {
    return require.resolve("next/dist/bin/next");
  } catch {
    throw new Error(
      "acd-kit could not find the 'next' package (it is a dependency of acd-kit). " +
        "Upgrade with `npx acd-kit@latest ui` — do not npm-install acd-kit into your app.",
    );
  }
}
