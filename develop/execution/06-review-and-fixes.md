# 06 — Review pass: nine defects fixed, one open question for the owner

Goal: review the whole project, fix what is clearly broken, and list what should
improve. Every fix below started as a failing test (RED), then the change (GREEN).
Node tests 119 → 128, all passing. Coverage 93.6% → 95.0%. No Swift code changed.

Real-data check: `audit`, `fix`, and `mcp-scan --dry-run` produce byte-identical
output before and after on this machine (36,657 tokens, same 9 servers). None of the
inputs that trigger these defects exist here, so the published numbers still hold.

## Fixed

| # | Where | Defect | Severity |
|---|---|---|---|
| 1 | `mcp-cost.js` codexEntries | `enabled = false # note` read as on, so `mcp-scan` started a server the user had switched off (the `cua_repl` / ChatGPT.app defect from 05, returning through a comment). `command = "node" # x` became `node" # x`. The scanner already handled comments; the two readers disagreed. | HIGH |
| 2 | `mcp-cost.js` measureHttpServer | `Mcp-Session-Id` and `MCP-Protocol-Version` were never sent after initialize. The 2025-06-18 spec makes both MUST, so every stateful remote server read as `failed`. | HIGH |
| 3 | `dashboard-server.js` | `/api/snapshots/%E0.json` threw `URIError` inside the handler and killed the dashboard process. Now 400. | MEDIUM |
| 4 | `dashboard-server.js` | No `Host` check, so a web page using DNS rebinding could read snapshots and live session telemetry from 127.0.0.1. Non-loopback hosts now get 403. | MEDIUM |
| 5 | `scanner.js` walkFiles | One unreadable directory anywhere under `~/.claude` threw `EACCES` and aborted the entire audit. | MEDIUM |
| 6 | `scanner.js` walkFiles | Duplicate tracking only began after a symlink, so a link back to an already-walked directory counted its skills twice. Now keyed by inode from the stat the existence check already did. | MEDIUM |
| 7 | `scanner.js` pluginCacheDirectory | Picked the lexically last version directory (`1.9.0` over `1.10.0`; arbitrary for hash names). Now reads `installPath` from `installed_plugins.json`, restricted to that plugin's cache root, and falls back to the old rule. | MEDIUM |
| 8 | `scanner.js` frontmatter | CRLF or BOM `SKILL.md` measured 0 metadata bytes; an empty `---\n---` block swallowed the body up to the next `---`. | MEDIUM |
| 9 | `fix.js` / `scanner.js` | A Codex server name needing quotes (`"docs.search"`) was offered by `fix` but `--apply` failed; Kiro hooks were counted twice when workspace = home. | LOW |

## Open — owner's decision, not implemented

**Claude Code's MCP servers are read from a file Claude Code does not document.**

- confirmed (code.claude.com/docs/en/mcp): user and local scope live in
  `~/.claude.json` (top-level `mcpServers` and `projects[<path>].mcpServers`),
  project scope in `<workspace>/.mcp.json`. Per-project off switches are
  `disabledMcpServers` in `~/.claude.json`. The docs never mention
  `~/.claude/mcp.json` or a `"disabled": true` field.
- ctxmeter reads, measures, and `fix` edits only `~/.claude/mcp.json`.
- unknown: whether Claude Code silently reads that file anyway. Settles it:
  `claude mcp list` (note: it health-checks, i.e. starts, the servers).

If it does not, then for a typical Claude Code user the Claude MCP line is always
empty, and on this machine the 12,420 Claude figure includes servers Claude never
loads. Worse, `fix --apply claude/...` would report tokens freed by a key Claude
ignores. This contradicts the audit's core promise and should be settled before the
launch in PLAN.md. Supporting `~/.claude.json` is a design change — that file is
~130 KB and rewritten by Claude constantly, so editing it is riskier than any file
`fix` touches today — which is why it is left for the owner.

## Improvements, not done (ordered by value)

1. Settle the Claude location question above; then `docs/reference.md` and
   `decisions/05` need the same correction.
2. Remote MCP config `headers` (e.g. `Authorization`) are not passed, so
   authenticated HTTP servers always read as failed. Deprecated `type: "sse"`
   servers are POSTed to as if Streamable HTTP.
3. Three hand-written TOML readers (`scanner.js` ×2, `mcp-cost.js`) plus the
   editor in `config-edit.js` each re-derive section and value rules. Defect 1 was
   exactly their disagreement. One shared line reader would remove that class.
4. `setTomlSectionKey` treats any line beginning with `[` as a section header, so a
   nested array line (`  ["a", "b"],`) or a multi-line string ends the section early
   and could insert a duplicate `enabled` key. Rare, but it is the one path that
   writes.
5. `cli.js` coverage is still 77%; `mcp-scan` and `fix --apply` end-to-end paths
   are not exercised through `run()`.
6. LOW: `compact()` in `public/app.js` prints `1000k` for 999,950 and `100.0k` for
   99,960; unquoted skill names containing an apostrophe read as null.
