# 06 — Details becomes the management surface; the web dashboard goes

Decided by the owner on 2026-09-28, after comparing the menu bar app with CodexBar.
The complaint: the app shows numbers in a table, with no trend, no composition, and
no way to act on what it measures.

## Decisions

1. **Visualise context over time, not spend.** The popover gets the current
   session's per-turn context as a chart with compaction marks, and the largest
   sessions of the last 7 days. Quota, cost, and weekly spend stay out — that is
   CodexBar's axis (`04-menubar-scope.md`), and the owner confirmed it.
2. **Details shows what the context is made of and switches it.** Per-item cost
   (instructions, skills, MCP per server) with a switch on every item that has a
   native off flag. Every switch asks for confirmation first, every write keeps
   `fix`'s backup-and-rollback rule, and the UI says the agent must restart.
3. **Claude plugins become switchable** through `enabledPlugins` in
   `~/.claude/settings.json`. The owner accepted the small risk that Claude's own
   `/plugin` rewrites the same file; the confirmation dialog is the mitigation.
   Claude MCP servers stay manual (`/mcp`), as decided in `execution/07`.
4. **The web dashboard is removed.** `04` said to revisit once Details grows; this
   is that point. Three surfaces diluted a pitch whose hook is one command.

## Data sources (checked on this machine)

- Claude: every assistant row carries `usage`; `system/compact_boundary` marks a
  compaction. 4 sessions here, the largest 330 turns peaking at 274k.
- Codex: `token_usage_record.payload.usage.input_tokens` per request; `compacted`
  rows mark compaction. 128 records in the latest session.
- Kiro: percentage only (`contextUsage` in IDE sessions, per-turn
  `context_usage_percentage` in CLI sessions). Its chart is in percent.

History reads more files than `telemetry`, so it is a separate `ctxmeter history`
command the app refreshes less often, keeping the 30-second telemetry path cheap.
