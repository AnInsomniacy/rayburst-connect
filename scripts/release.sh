#!/usr/bin/env bash
# ==============================================================================
# release.sh — Commit, tag, and push a release
#
# Usage:
#   ./scripts/release.sh
#
# Reads the version from package.json, formats code, runs all quality gates,
# stages all changes, commits, creates an annotated tag, and pushes to origin.
#
# Run this ONLY when all code changes are final and you are ready to publish.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Read version from package.json
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"

if [ -z "$VERSION" ]; then
  echo "Error: Could not read version from $PACKAGE_JSON"
  exit 1
fi

# Check if tag already exists
if git tag -l "$TAG" | grep -q "$TAG"; then
  echo "Error: Tag $TAG already exists. Delete it first if re-releasing:"
  echo "  git tag -d $TAG && git push origin --delete $TAG"
  exit 1
fi

echo "Releasing $TAG..."

# Format code (best-effort auto-fix, then verify below)
pnpm format --log-level warn 2>/dev/null || true

# ── Pre-release verification gate ────────────────────────────────
# Every check must pass before we commit, tag, or push.
# Run source checks locally; GitHub Actions owns release packaging.
echo "Running pre-release checks..."

pnpm compile || { echo "❌ TypeScript type check failed."; exit 1; }
pnpm test || { echo "❌ Tests failed."; exit 1; }
pnpm lint || { echo "❌ ESLint check failed."; exit 1; }
pnpm lint:i18n || { echo "❌ i18n lint failed."; exit 1; }
pnpm media:contract:check
pnpm format:check || { echo "❌ Format check failed. Run 'pnpm format' first."; exit 1; }

echo "✓ All pre-release checks passed"

# Stage everything, commit, tag
git add -A

if git diff --cached --quiet; then
  echo "No changes to commit. Creating tag on current HEAD."
else
  git commit -m "release: $TAG"
fi

git tag -a "$TAG" -m "$TAG"

# Push commit and tag
git push && git push origin "$TAG"

echo ""
echo "✓ Released $TAG"
echo "  → Commit and tag pushed to origin"
echo ""
echo "Next: Go to GitHub → Releases → Create new release"
echo "  Select tag: $TAG"
