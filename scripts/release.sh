#!/usr/bin/env bash
#
# DailyRecap release script.
#   1. shows the current version and asks you for the new one
#   2. GATE: `npm run compile` and `npm test` must pass (aborts otherwise)
#   3. bumps the version in package.json (+ package-lock.json)
#   4. packages a single .vsix and publishes it to BOTH
#      the VS Code Marketplace (vsce) and Open VSX (ovsx)
#
# Auth (set before running):
#   export VSCE_PAT=...   # Azure DevOps PAT for the VS Code Marketplace
#   export OVSX_PAT=...   # Open VSX access token
#
# Usage: npm run release   (bash only — macOS / Linux / Git-Bash)

set -euo pipefail

red()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }
cyan() { printf '\033[36m%s\033[0m\n' "$*"; }
green(){ printf '\033[32m%s\033[0m\n' "$*"; }

# always run from the repo root (parent of this script's dir)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NEW=""
trap 'red "Release failed."; [ -n "$NEW" ] && red "Note: version may already be bumped to v${NEW}. Fix the issue, then re-run, or publish the built .vsix manually."' ERR

# ── 1. current version + prompt ─────────────────────────────
CURRENT="$(node -p "require('./package.json').version")"
cyan "Current version: v${CURRENT}"
printf "Enter the new version (e.g. 0.1.0): "
read -r NEW
NEW="${NEW#v}"   # tolerate a leading "v"

# validate: semver x.y.z with optional -prerelease
if ! printf '%s' "$NEW" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([-][0-9A-Za-z.-]+)?$'; then
  red "Invalid version: '${NEW}' (expected semver like 1.2.3)"
  exit 1
fi
SKIP_BUMP=0
if [ "$NEW" = "$CURRENT" ]; then
  cyan "v${NEW} already matches package.json — will publish as-is without bumping."
  cyan "(works only if v${NEW} hasn't been published yet; the marketplace rejects duplicate versions.)"
  SKIP_BUMP=1
fi

# soft auth check (vsce may also use a stored login)
if [ -z "${VSCE_PAT:-}" ]; then cyan "warning: VSCE_PAT is not set — vsce will need a stored login (vsce login)."; fi
if [ -z "${OVSX_PAT:-}" ]; then cyan "warning: OVSX_PAT is not set — ovsx publish will likely fail."; fi

printf "Publish v%s to VS Code Marketplace + Open VSX? [y/N] " "$NEW"
read -r CONFIRM
case "$CONFIRM" in
  y|Y) ;;
  *) red "Aborted."; exit 1 ;;
esac

# ── 2. gate: build + tests must pass (before any bump) ──────
cyan "→ npm run compile"
npm run compile
cyan "→ npm test"
npm test
green "Build & tests passed."

# ── 3. bump version in package.json (+ package-lock.json) ───
if [ "$SKIP_BUMP" = 0 ]; then
  node - "$NEW" <<'NODE'
const fs = require('fs');
const v = process.argv[2];
for (const f of ['package.json', 'package-lock.json']) {
  if (!fs.existsSync(f)) continue;
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.version = v;
  if (j.packages && j.packages[""]) j.packages[""].version = v; // npm lockfile v2/v3
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
  console.log(`updated ${f} -> ${v}`);
}
NODE
  green "Version set to v${NEW}."
else
  cyan "Skipping bump — version stays at v${NEW}."
fi

# ── 4. package once, publish to both registries ────────────
VSIX="dailyrecap-${NEW}.vsix"
cyan "→ packaging ${VSIX}"
npx vsce package -o "$VSIX"

cyan "→ publishing to VS Code Marketplace (vsce)"
npx vsce publish --packagePath "$VSIX"

cyan "→ publishing to Open VSX (ovsx)"
npx ovsx publish "$VSIX"

green "Published v${NEW} to VS Code Marketplace and Open VSX."
echo
echo "Next (commit the version bump + tag):"
echo "  git add package.json package-lock.json && git commit -m \"release: v${NEW}\" && git tag v${NEW} && git push --follow-tags"
