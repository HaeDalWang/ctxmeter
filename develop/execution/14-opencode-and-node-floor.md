# 14. v0.3.0 — OpenCode, Node 22.13 floor

2026-10-16. The owner picked option 1: raise the Node floor rather than shell out to `sqlite3` or add a native dependency.

## Node floor

- Node 20 has been EOL since 2026-03-24 (confirmed, https://nodejs.org/en/about/previous-releases). `node:sqlite` loads without a flag from 22.13.0 (confirmed, Node release notes and API docs).
- `engines` is now `>=22.13`. CI runs a matrix of 22.13 and 24. The README badge and text were updated.
- Ran locally on Node 22.13.0 through `npx node@22.13.0`: 228 pass, 1 skip. On 22.13, node:sqlite prints an ExperimentalWarning. The CLI drops that one warning around `require('node:sqlite')`, and its output was checked to be clean.
- On older Node, everything except OpenCode keeps working: the require fails and is caught.

## OpenCode (`src/opencode-scan.js`)

The sources are the OpenCode docs listed in `docs/reference.md`, checked against the local install (1.14.48, schema 1.3.2 sessions).

- Rules: the nearest `AGENTS.md`, else `CLAUDE.md`. The global file is `~/.config/opencode/AGENTS.md`, else `~/.claude/CLAUDE.md`. Literal `instructions` paths are read; URLs and globs are counted as unmeasured.
- Skills come from six folders. Project and global folders are deduplicated when the workspace is the home directory.
- MCP has two config shapes:
  - V1: `mcp.<name>` with `enabled`, counted as upfront.
  - V2: `mcp.servers.<name>` with `disabled` and `codemode` (default true), counted as deferred.
- `fix` gives OpenCode a manual step. Its configs are often JSONC, and config-edit refuses to rewrite comments.
- Sessions are read from `opencode.db`, top-level only. Context per message is `input + cache.read + cache.write`. A `summary` message marks a compaction.

Live check (confirmed): workspace `~`, 2 sessions, observed start 11,826 tokens. Telemetry is the newest session with a response, 12,030 tokens. The newest session overall was aborted with 0 tokens and is skipped.

## Not done

- Menu bar tab. The Swift `Harness` enum has three cases, and OpenCode has no app to take an icon from. The JSON already carries `opencode`, and Swift ignores unknown keys.
- The walk up to the git worktree for project skills.
- Glob `instructions`.
- `XDG_CONFIG_HOME`, `OPENCODE_CONFIG*`, and remote or managed config.
