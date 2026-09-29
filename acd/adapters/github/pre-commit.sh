# Pre-commit mechanical gates (no model).
# Copy into .husky/pre-commit or invoke from your git hook runner.
# Only run commands that exist in .acd/acd.config.yaml repo.* 

set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if command -v npx >/dev/null 2>&1; then
  npx acd review --work-id "$(ls -1 .acd/work 2>/dev/null | tail -n 1)" || true
fi
