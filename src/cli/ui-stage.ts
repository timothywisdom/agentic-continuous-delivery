import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";

/** Next skips transpiling files under node_modules (npx unpacks there). */
export function uiAppNeedsStaging(webDir: string): boolean {
  return webDir.split(/[/\\]/).includes("node_modules");
}

/** Directory that contains the hoisted `next` package (`…/node_modules`). */
export function hoistedNodeModules(kitRoot: string): string {
  const require = createRequire(join(kitRoot, "package.json"));
  return dirname(dirname(require.resolve("next/package.json")));
}

/** Parent of that `node_modules` (npx cache prefix, or the kit repo). */
export function installPrefix(kitRoot: string): string {
  return dirname(hoistedNodeModules(kitRoot));
}

/**
 * Copy web + src out of node_modules and point Next at that tree.
 * Kit-repo checkouts are used in place.
 *
 * Staging lives beside the hoisted node_modules so Turbopack's project root
 * can include both the app and a relative `node_modules` symlink.
 */
export function stageUiApp(kitRoot: string, stagingParent?: string): string {
  const webSrc = join(kitRoot, "web");
  if (!uiAppNeedsStaging(webSrc)) return webSrc;

  const prefix = installPrefix(kitRoot);
  const parent = stagingParent ?? join(prefix, ".acd-kit-ui");
  const version = readKitVersion(kitRoot);
  const root = join(parent, version);
  const webDest = join(root, "web");
  mkdirSync(root, { recursive: true });
  rmSync(webDest, { recursive: true, force: true });
  rmSync(join(root, "src"), { recursive: true, force: true });
  rmSync(join(root, "dist"), { recursive: true, force: true });
  copyTree(webSrc, webDest);
  copyTree(join(kitRoot, "src"), join(root, "src"));
  const distSrc = join(kitRoot, "dist");
  if (!existsSync(distSrc)) {
    throw new Error("acd-kit dist/ is missing. From the kit repo run: npm run build");
  }
  copyTree(distSrc, join(root, "dist"));
  mkdirSync(webDest, { recursive: true });
  linkNodeModules(kitRoot, webDest);
  return webDest;
}

function copyTree(from: string, to: string): void {
  cpSync(from, to, {
    recursive: true,
    filter: (src) => {
      const rel = src.startsWith(from) ? src.slice(from.length) : src;
      return !rel.split(sep).includes("node_modules") && !rel.split(sep).includes(".next");
    },
  });
}

function readKitVersion(kitRoot: string): string {
  try {
    const raw = JSON.parse(readFileSync(join(kitRoot, "package.json"), "utf8")) as {
      version?: string;
    };
    return raw.version?.trim() || "dev";
  } catch {
    return "dev";
  }
}

function linkNodeModules(kitRoot: string, webDest: string): void {
  const nodeModules = hoistedNodeModules(kitRoot);
  const link = join(webDest, "node_modules");
  rmSync(link, { recursive: true, force: true });
  if (!existsSync(nodeModules)) {
    throw new Error(`acd-kit UI could not find node_modules next to 'next' (${nodeModules})`);
  }
  symlinkSync(relative(webDest, nodeModules), link, "dir");
}
