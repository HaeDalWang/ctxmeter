# 11. Deferred MCP and the observed session start (BACKLOG P0-1, P0-2)

2026-09-28. Both items came out of `research/04`: Claude Code and Codex keep MCP tools behind a tool search by default, so ctxmeter was counting schemas that are not in the startup prompt.

## P0-1 — loaded or deferred

`src/tool-loading.js` decides per server, at read time, from the settings in force now (not stored in `.ctxmeter/mcp-cost.json`):

- Claude: deferred by default. Upfront for `alwaysLoad: true`, `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`, `ENABLE_TOOL_SEARCH=false`, a non-`api.anthropic.com` `ANTHROPIC_BASE_URL`, or `auto[:N]` under its threshold. Env is the shell overlaid by `env` in the three Claude settings files. Source: https://code.claude.com/docs/en/agent-sdk/tool-search.
- Codex: always deferred. Source: `codex-rs/features/src/lib.rs` (`tool_search` always enabled; MCP tools deferred when it is). **Read from source, not checked against a live Codex session.**
- Kiro: counted as loaded. Deferral is **unknown** — nothing documents it either way.

Effects: audit counts only loaded schemas and prints one "N tokens of MCP schemas … load only on use" line per agent; `mcp-scan` splits its headline and marks rows `— deferred`; `fix` does not offer deferred servers; `details` gives them `tokens: null` and `deferredTokens`; the menu bar shows "on use" and the switch prompt says turning it off changes little at startup.

## P0-2 — observed start

`startupBaselines` in `src/session-history.js` takes the first request of each of the last 10 sessions per agent and workspace, skipping sessions that open after a compaction, and keeps lowest, median, and latest. The audit leads with the lowest; the setup estimate follows as "your setup is X of those tokens".

The backlog said median. Lowest was chosen because every value includes the first user message, and the lowest is the one with the least of it — the closest to "before you type". That is a judgment, not a measurement; median is in the JSON for anyone who disagrees.

## Numbers on this machine (confirmed, 2026-09-28)

| | before | after |
|---|---|---|
| audit estimate | 33,458 | 25,855 (Kiro 13,130 · Claude 9,419 · Codex 3,306) |
| MCP in the startup estimate | 17,877 | 8,914 (Kiro only); Codex 8,963 deferred |
| `fix` | 20,747 / 12 switches | 13,262 / 11 switches |
| observed start | — | Claude 69,435 (4 sessions) · Codex 17,268 (2) · Kiro 4.6% (2) |

The gap (Claude 69,435 vs 9,419 setup; Codex 17,268 vs 3,306) is the built-in system prompt and tools plus the first message. ctxmeter does not split those two, and does not try.

## Tests

Node 175 pass (new: `tool-loading`, `deferred-mcp`, `baseline`). Swift 50 pass (new: `DeferredItemTests`). Demo GIF re-recorded with `scripts/build-demo.sh`; last frame checked — new headline, the Codex deferred line, the per-agent session-start lines.

## Not verified

- Codex deferral against a running Codex (source reading only).
- Kiro deferral (unknown).
- Claude's `auto:N` threshold is compared against Claude's MCP total only; whether Claude counts anything else toward it is unknown.


## Release v0.1.2 (2026-10-01)

- `package.json` and `Info.plist` 0.1.2; `RELEASE_TAG=v0.1.2 node --test` 176/176 (the version test no longer skips); `verify-package` ok, 136 KB.
- Tag `v0.1.2` pushed. First run of the CI publish path: tag check, tests, package check, then `npm publish` with trusted publishing — `+ ctxmeter@0.1.2`, provenance signed and logged to sigstore (logIndex 3028417855). No token involved (confirmed from the workflow log).
- The registry showed 0.1.2 about 4 minutes after publish ("being processed"). Then: `dist-tags.latest` 0.1.2, SLSA provenance attestation present, `npx -y ctxmeter@latest --version` → 0.1.2 from an empty dir (confirmed).
- GitHub release v0.1.2 created; `releases/latest` → v0.1.2, not draft, not prerelease (confirmed).
- Update banner: the installed app was 0.1.0; relaunched to trigger the launch check. Whether the banner appears is for the owner to look at — not seen by the agent.
