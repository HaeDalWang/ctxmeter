# Reference

Detailed behaviour, data sources, and measurement limits. For the short version see the [README](../README.md).

# ctxmeter

Local, read-only observability for Claude Code, Codex, and Kiro configuration.

ctxmeter answers three questions without copying prompt or secret contents:

1. Which rules, skills, hooks, plugins, and steering assets exist?
2. Which assets are active candidates versus backups, marketplace sources, or staging files?
3. How much context did the latest local session use, and which configuration files may contribute?

## Run a scan

```bash
npm test
npx ctxmeter                 # audit
npx ctxmeter scan            # JSON snapshot
npx ctxmeter telemetry       # session usage only
npx ctxmeter dashboard       # local web view
```

The default scan writes a timestamped JSON snapshot under `.ctxmeter/snapshots/`.
`ctxmeter telemetry` prints current session usage for all three harnesses as JSON on stdout and runs no inventory scan, which makes it the cheap path for an external status display. It takes about 0.2s including Node startup, against seconds for a full scan.
The dashboard listens only on `http://127.0.0.1:4318`, lists local snapshots, and does not start unless you ask for it.
To choose the target paths explicitly:

```bash
npx ctxmeter scan --home /path/to/home --workspace /path/to/project --output ./scan.json
```

## Disable flags and why they matter

Each harness declares MCP servers in its own file and each supports switching one off in place:

| Harness | File | Flag | Default when absent |
|---|---|---|---|
| Claude Code | `~/.claude/mcp.json` | `"disabled": true` | enabled |
| Codex | `~/.codex/config.toml` | `enabled = false` under `[mcp_servers.<name>]` | enabled |
| Kiro | `~/.kiro/settings/mcp.json` | `"disabled": true` | enabled |

Codex plugin groups use `[plugins."<name>@<marketplace>"]` with `enabled = true`, and there the default when absent is **off** — the opposite of MCP servers, which is why the two are read by separate functions rather than one shared one.

A server that is switched off is never started by `mcp-scan`, never counted toward the configured total, and never offered by `fix`. It contributes nothing to the prompt, so reporting it as unmeasured would overstate how much of the setup is unknown.

## fix

`ctxmeter fix` lists switches that would free measured tokens, ranked by saving. It writes nothing. `--apply <target>` flips exactly one, after copying the file to `<name>.ctxmeter-<timestamp>.bak` in the same directory and printing a `cp` command that restores it.

- A proposal requires the item to be currently on **and** to have a measured token count. Anything unmeasured is never offered, because there would be no saving to promise.
- TOML is edited line by line: the section's line range is located, an existing `enabled` line is replaced, or `enabled = false` is inserted after the header. The file is never reserialized, so comments and unrelated sections keep their bytes. A section that is missing, or that appears twice, is refused.
- JSON is parsed and reserialized at two-space indent. Key order and the trailing newline are preserved, and the result is reparsed to confirm the edit and the ordering survived before anything is written. A file that will not parse — JSONC with comments, a trailing comma — is refused rather than repaired.
- Applying the same target twice is refused rather than rewriting.
- There is no undo log. The printed `cp` is the undo, and it works after ctxmeter is uninstalled.
- `CLAUDE.md`, `AGENTS.md`, rule files, steering documents, and skills you wrote are reported but never edited. Those are content; an MCP server is a setting.

`scripts/verify-fix-sandbox.sh` copies the real configs into a temporary home and checks the whole path: one added TOML line, one added JSON key, the untouched file byte-identical, a second apply refused with exit 1, and every file restored byte-for-byte by the printed rollback.

## What the snapshot contains

- Claude Code: enabled plugin IDs, registered hook count, `CLAUDE.md` and rules sizes, skill metadata estimates
- Claude Code model catalog: locally offered model IDs, display names, and the currently selected model
- Claude Code workspace session telemetry: first/latest input tokens, cache reads, output tokens, model IDs, and timestamps from the newest local project JSONL
- Codex: registered hook count, configured/enabled plugin and MCP counts, `AGENTS.md` size, skill metadata estimates including enabled plugin skills
- Codex model and session telemetry: visible local models, effective/max context windows, first/latest input context, cache/output/reasoning totals, and compaction count
- Kiro: custom agent, Power, steering, regular skill, separate Crew-skill counts, and v2 hook definitions from `~/.kiro/hooks` plus the workspace's `.kiro/hooks`
- Kiro session telemetry: observed context **percentage** only. Kiro does not record absolute token counts locally, so ctxmeter reports first/latest `context_usage_percentage`, the sample count, and credits, and leaves token totals unmeasured rather than deriving them from the percentage. Both stores are supported — `~/.kiro/sessions/<workspace>/sess_*/messages.jsonl` (IDE/ACP) and `~/.kiro/sessions/cli/*.json` (CLI) — and the newest matching session wins. Prompt-history files (`*.history`) are never read.
- Kiro Crew usage: credits total, record count, and date range, flagged `workspaceAttributable: false` because Crew records are aggregated per day and surface rather than per workspace

When the winning Kiro store records no context window, ctxmeter reuses a window observed for the same model in another local Kiro CLI session and marks it `contextWindowSource: "peer-session"`. That value is read from Kiro's own `model_info`, not guessed.
- Workspace instruction candidates
- Non-loadable asset counts: backups, marketplace sources, and temporary staging files

Every discovered skill is also emitted as an asset record under its `skillGroups[].assets` array:

- declared skill name and group-relative path
- discovery status
- full file size and frontmatter-only metadata estimate
- modification timestamp and SHA-256 fingerprint for future snapshot diffs

Asset records intentionally omit the skill description and body text. This keeps the inventory useful for analysis while avoiding prompt-content replication.

Symlinked assets are followed. Sharing one skill or rule file across harnesses by symlink is common, and the harness loads it, so ctxmeter counts it. Directory symlinks are followed with realpath-based cycle and duplicate detection, and broken symlinks are skipped rather than aborting the scan. Tracking begins only after a symlink is followed, so link-free trees keep their original walk cost.

Skill bodies are not counted as baseline context. ctxmeter estimates only YAML frontmatter bytes for skill metadata, because full skill bodies are typically loaded on demand.

## Context budget and calibration

The first dashboard panel is model-aware and separates three kinds of numbers:

- **Observed input:** numeric usage from the latest local Claude or Codex session JSONL
- **Cross-model proxy:** a recorded session's input projected onto another selected model's context window
- **File estimate:** static byte-based fallback when no local session usage exists

Choose `Claude Code` or `Codex` above the model row. Claude reads numeric usage from the newest JSONL for the scanned workspace; Codex reads numeric telemetry from the newest local session JSONL belonging to that workspace and model metadata from `models_cache.json`. Prompt, response, and compaction text are never copied into a snapshot.

The checked-in [`config/context-profiles.json`](config/context-profiles.json) retains a `/context` sample observed on 2026-09-21 for Claude Opus 5 as a fallback when no local session usage exists. The dashboard does not require `/context` for observed totals.

That fallback calibration records the inventory observed at the time. If the inventory changes, ctxmeter does not present its old category totals as current. Live session totals remain available independently.

The default view shows the latest input context. The first-response toggle includes the first user prompt for both harnesses. If the first response used a different model, its value is labeled as a proxy. Claude's context map reserves the configured autocompact buffer as an estimate of available working space.

Known model capacities are sourced from Anthropic documentation. A locally discovered model without an exact matching profile remains visible with `용량 미확인`; ctxmeter does not guess a capacity.

Codex's budget denominator is the active session's reported context window when available, otherwise the installed CLI catalog's `context_window × effective_context_window_percent`. The catalog's `max_context_window` is shown separately as a local catalog ceiling. These are not the model's published API limit: the official API model pages currently list 1,050,000 tokens for GPT-6 Astra, GPT-5.6 Sol/Terra/Luna, and GPT-5.5. The dashboard displays that API specification separately with a source link. Codex configuration also supports model-context and auto-compaction overrides.

## Important limits

`metadataTokenEstimate` is a byte-based heuristic, not the model's exact token count. Claude and Codex JSONL totals are observed, but neither attributes input tokens to system prompt, tools, skills, and messages separately; ctxmeter subtracts static instruction/skill estimates and labels the remainder as unclassified. A Claude workspace without a local JSONL keeps the fallback file estimate or calibration. Historical snapshots update when `ctxmeter scan` runs, while an open dashboard refreshes current numeric telemetry separately.

## Dashboard

The dashboard is intentionally local and dependency-free. It provides:

- model tabs populated from Claude's local model catalog
- agent tabs for Claude Code, Codex, and Kiro, each enabled only when a local session for the scanned workspace exists
- Codex model tabs populated from `models_cache.json`, separating the active local context, catalog base/ceiling, and published API model capacity
- Codex first/latest context, cached input, output, reasoning, thread cumulative usage, and compaction count
- Claude first/latest context, cached input, and output from the scanned workspace's latest local session
- low-overhead live mode: 10-second polling only while the Claude, Codex, or Kiro panel is selected and the browser tab is visible
- a five-second server cache that avoids duplicate JSONL parsing across closely spaced requests
- first-session and observed-session modes
- a 100-cell context map with used categories, free space, and autocompact reserve
- category rows for system prompt, system tools, MCP tools, custom agents, memory files, skills, and messages
- a collapsible configuration-cost list for global/workspace instructions, individual Claude rule files, agent definitions, skill groups, hooks, MCP servers, and Codex plugins
- counts, token totals, percentages, and confidence labels for every category
- a three-harness overview for skills, hooks, and estimated skill metadata
- snapshot selector that refreshes every ten seconds while the page is visible; it follows new scans only if the viewer was already on the newest snapshot
- harness filter and inventory search
- collapsible inventory groups: large groups such as ECC stay closed until selected, while search results expand automatically
- asset detail: source group, relative path, status, metadata estimate, and body size

It does not use a background watcher, database, Docker container, or external network request.

Live mode is demand-driven rather than a background watcher. Hiding the browser tab stops polling; returning to a visible Claude or Codex panel refreshes immediately. The `LIVE` badge shows the timestamp of the most recent local token record.

Snapshots contain paths, counts, IDs, byte estimates, and numeric session usage only. They do not persist settings values, prompt text, rule text, skill text, or credentials.

Configuration-cost rows use file bytes divided by four as a rough estimate. `세션 시작` marks global instruction files, `목록 메타데이터` marks discovered skill metadata, and `조건부 / 호출 시` marks files that may be loaded for particular work. Hooks, MCP servers, and plugins are listed with counts but show `미측정` because their configuration file sizes do not reveal prompt tokens or later tool output. These rows overlap the context budget categories and must not be added to the observed input total.
