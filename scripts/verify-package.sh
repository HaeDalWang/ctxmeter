#!/usr/bin/env bash
# Pack the npm tarball, install it into a throwaway prefix, and run the
# installed `ctxmeter` the way `npx ctxmeter` would. Catches a missing file in
# `files`, a broken bin, or a path that only resolves inside the repo.
#
#   scripts/verify-package.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

VERSION="$(node -p "require('$REPO/package.json').version")"
TARBALL="$(cd "$REPO" && npm pack --silent --pack-destination "$WORK")"
npm install --silent --global --prefix "$WORK/prefix" "$WORK/$TARBALL"
BIN="$WORK/prefix/bin/ctxmeter"

fail() { echo "verify-package: $*" >&2; exit 1; }

[ -x "$BIN" ] || fail "bin not installed"
[ "$("$BIN" --version)" = "$VERSION" ] || fail "--version is not $VERSION"
"$BIN" --help | grep -q "Usage: ctxmeter" || fail "--help missing usage"

# An empty home: every agent absent. Must not crash, must not touch the repo.
HOME_DIR="$WORK/home"; mkdir -p "$HOME_DIR"
(cd "$WORK" && "$BIN" audit --home "$HOME_DIR" --workspace "$WORK") > "$WORK/audit.txt" || fail "audit exited non-zero"
(cd "$WORK" && "$BIN" details --home "$HOME_DIR" --workspace "$WORK") | node -e \
  'JSON.parse(require("fs").readFileSync(0,"utf8"))' || fail "details is not JSON"
(cd "$WORK" && "$BIN" fix --json --home "$HOME_DIR" --workspace "$WORK") | node -e \
  'JSON.parse(require("fs").readFileSync(0,"utf8"))' || fail "fix --json is not JSON"

# Nothing outside src/, config/, docs, and the manifest should ship.
tar -tzf "$WORK/$TARBALL" | grep -v -E '^package/(src/|config/|docs/demo\.gif$|README(\.ko)?\.md$|LICENSE$|package\.json$)' \
  && fail "unexpected file in tarball" || true

echo "verify-package: ok ($TARBALL, $(du -k "$WORK/$TARBALL" | cut -f1) KB)"
