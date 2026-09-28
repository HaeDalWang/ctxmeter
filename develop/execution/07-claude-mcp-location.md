# 07 — Claude MCP read from where Claude reads it, and the numbers it corrected

Owner chose option A from `06-review-and-fixes.md`: read Claude's MCP servers
from the documented locations, stop writing Claude config from `fix`, re-measure.

## Evidence that `~/.claude/mcp.json` was wrong

- confirmed: code.claude.com/docs/en/mcp lists only `~/.claude.json` (user and
  local scope) and `<workspace>/.mcp.json` (project scope, approval required).
- confirmed: the installed Claude Code 2.1.281 binary contains no path to
  `~/.claude/mcp.json`. Its one bare `"mcp.json"` constant belongs to dispatched
  remote sessions, which pass it through `--mcp-config`.
- confirmed: no shell alias passes `--mcp-config` on this machine.
- not run: `claude mcp list`, since it starts the servers. It remains the direct
  check if anyone doubts the above.

## What changed

- `src/claude-mcp.js` (new) decides which servers Claude loads for a workspace:
  user scope, local scope for that exact workspace path, and approved project
  servers. Approval comes from `~/.claude.json` or settings; the repo's committed
  `.claude/settings.json` counts only when `hasTrustDialogAccepted` is true, as the
  docs describe. `projects[<workspace>].disabledMcpServers` removes a server.
  Local over project over user when a name repeats.
- `scanner.js` and `mcp-cost.js` both use it, so the configured count and the
  launch list cannot disagree. `mcpServerEntries` now takes the workspace.
- `fix` lists Claude servers with the `/mcp` step and refuses `--apply` for them.
  `~/.claude.json` is ~130 KB and rewritten by Claude while it runs.
- `verify-fix-sandbox.sh` uses a stand-in `.claude.json` rather than copying the
  real one, which holds account state, into a sandbox kept on disk.

Tests 128 → 140, all passing; `claude-mcp.js` 100%, overall 95.2%. Sandbox check
passed; the sandbox was deleted afterwards because it held a copy of
`config.toml`.

## Re-measured 2026-09-28

`mcp-scan --i-understand-this-launches-servers --allow-remote --timeout 20000`

| | before (05) | after | why |
|---|---|---|---|
| total | 36,657 | **33,458** | net |
| Claude Code | 12,420 | **8,680** | 3,740 of schemas from two servers Claude never loads |
| Codex | 11,253 | 11,794 | `node_repl` now measured (541) |
| Kiro | 12,984 | 12,984 | unchanged |
| `mcp-scan` | 21,076 / 81 tools | 17,877 / 78 tools | |
| `fix` | 21,486 / 10 switches | 18,287 / 9 switches | |

`node_repl` answered with a 20 s timeout where 05 recorded "exited before
answering". Unknown whether the timeout or something else made the difference; the
default 5 s timeout was not re-run.

On this machine Claude Code has no MCP servers at all, so the Claude line now
shows none. README samples and `docs/demo.gif` were regenerated from these runs.
The dashboard and menu bar screenshots show live session usage, not MCP, and were
left as they are.
