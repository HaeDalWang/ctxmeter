#!/usr/bin/env bash
# End-to-end check of `ctxmeter fix --apply` against a COPY of the real config
# files. The live ~/.codex, ~/.claude and ~/.kiro are only ever read.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="$(mktemp -d /tmp/ctxmeter-sandbox-XXXXXX)"
trap 'echo; echo "sandbox kept at $SANDBOX"' EXIT

mkdir -p "$SANDBOX/.codex" "$SANDBOX/.claude" "$SANDBOX/.kiro/settings"
cp ~/.codex/config.toml "$SANDBOX/.codex/config.toml"
cp ~/.claude/mcp.json   "$SANDBOX/.claude/mcp.json"
cp ~/.kiro/settings/mcp.json "$SANDBOX/.kiro/settings/mcp.json"

# The proposal list needs the measurement cache, which is keyed to the home it was
# taken in. Retarget a copy at the sandbox so the guard passes honestly.
mkdir -p "$SANDBOX/ws/.ctxmeter"
node -e "
const fs=require('fs');
const c=JSON.parse(fs.readFileSync('$REPO/.ctxmeter/mcp-cost.json','utf8'));
c.home='$SANDBOX';
fs.writeFileSync('$SANDBOX/ws/.ctxmeter/mcp-cost.json', JSON.stringify(c,null,2)+'\n');
"

for f in .codex/config.toml .claude/mcp.json .kiro/settings/mcp.json; do
  shasum -a 256 "$SANDBOX/$f" | awk '{print $1}' > "$SANDBOX/hash-$(echo "$f" | tr "/" "_").before"
done

run() { node "$REPO/src/cli.js" "$@" --home "$SANDBOX" --workspace "$SANDBOX/ws"; }

echo "=== targets available in the sandbox ==="
run fix | head -8

echo
echo "=== applying one TOML target and one JSON target ==="
run fix --apply codex/code-review-graph
echo
run fix --apply kiro/playwright

echo
echo "=== TOML diff (expect exactly one added line) ==="
diff <(cat ~/.codex/config.toml) "$SANDBOX/.codex/config.toml" || true

echo
echo "=== JSON diff (expect one added key) ==="
diff <(cat ~/.kiro/settings/mcp.json) "$SANDBOX/.kiro/settings/mcp.json" || true

echo
echo "=== the untouched file must be byte-identical ==="
if [ "$(shasum -a 256 "$SANDBOX/.claude/mcp.json" | awk '{print $1}')" = "$(cat "$SANDBOX/hash-.claude_mcp.json.before")" ]; then
  echo "claude/mcp.json unchanged: OK"
else
  echo "claude/mcp.json CHANGED: FAIL"; exit 1
fi

echo
echo "=== reapplying the same target must be refused ==="
# pipefail makes a piped grep report the failing producer, so capture first.
set +e
second_output="$(run fix --apply codex/code-review-graph 2>&1)"
second_status=$?
set -e
if [ "$second_status" -ne 0 ] && printf '%s' "$second_output" | grep -qi "already"; then
  echo "refused with exit $second_status: OK"
  printf '  %s\n' "$second_output"
else
  echo "second apply was NOT refused (exit $second_status): FAIL"
  printf '  %s\n' "$second_output"
  exit 1
fi

echo
echo "=== rolling back with the printed commands ==="
for bak in "$SANDBOX"/.codex/*.bak "$SANDBOX"/.kiro/settings/*.bak; do
  original="${bak%%.ctxmeter-*}"
  cp "$bak" "$original"
  echo "restored $(basename "$original")"
done

echo
echo "=== after rollback, every file must match the original byte for byte ==="
fail=0
for f in .codex/config.toml .claude/mcp.json .kiro/settings/mcp.json; do
  now="$(shasum -a 256 "$SANDBOX/$f" | awk '{print $1}')"
  want="$(cat "$SANDBOX/hash-$(echo "$f" | tr "/" "_").before")"
  if [ "$now" = "$want" ]; then echo "  $f OK"; else echo "  $f MISMATCH"; fail=1; fi
done
[ "$fail" -eq 0 ] || exit 1
echo
echo "ALL SANDBOX CHECKS PASSED"
