#!/usr/bin/env node
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const compiled = join(root, "dist", "cli", "index.js");
const source = join(root, "src", "cli", "index.ts");
const args = process.argv.slice(2);
const require = createRequire(join(root, "package.json"));

function run(nodeArgs) {
  return spawnSync(process.execPath, nodeArgs, {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });
}

let result;
if (existsSync(compiled)) {
  result = run([compiled, ...args]);
} else {
  // Resolve tsx from this package, not from the consumer's cwd.
  let tsxLoader;
  try {
    tsxLoader = require.resolve("tsx/esm");
  } catch {
    try {
      tsxLoader = require.resolve("tsx");
    } catch {
      process.stderr.write(
        "acd: dist/ is missing and package 'tsx' is not installed in @acd/kit.\n" +
          "From the kit repo run: npm install && npm run build\n" +
          "Then re-run your command in the consumer project.\n",
      );
      process.exit(1);
    }
  }
  result = run(["--import", tsxLoader, source, ...args]);
}

process.exit(result.status ?? 1);
