import { spawn } from "node:child_process";
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
      `Web UI not found at ${dir}. Reinstall @acd/kit or run from the kit repo.`,
    );
  }

  const port = opts.port ?? defaultUiPort();
  const nextBin = resolveNextBin(dir);
  const production = hasProductionUiBuild(dir);
  const args = production
    ? ["start", "-H", "127.0.0.1", "-p", String(port)]
    : ["dev", "-H", "127.0.0.1", "-p", String(port)];

  process.stderr.write(
    `acd: UI on http://127.0.0.1:${port} (bound to 127.0.0.1; drives CLI in ${opts.repoRoot}` +
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
      },
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`UI exited with code ${code}`));
    });
  });
}

function resolveNextBin(webDir: string): string {
  const candidates = [
    join(kitRoot, "node_modules", "next", "dist", "bin", "next"),
    join(webDir, "node_modules", "next", "dist", "bin", "next"),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      "next is not installed. From the kit repo run: npm install",
    );
  }
  return found;
}
