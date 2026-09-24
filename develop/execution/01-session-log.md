# Execution log — 2026-09-24

What was actually changed, in order, with the verification for each.

## Research, then plan

Four searches and a set of live API queries, all recorded in `../research/`. The two findings
that changed the plan:

1. The pain is validated far more strongly than assumed, and the most-complained-about cost
   (MCP tool schemas) is the one thing this project does not measure.
2. `agentlens` collides with eight GitHub repos, three in the same positioning, and the npm
   name is taken. That is a growth blocker, not a cosmetic issue.

Calibration that kept the plan honest: the seven existing "Claude Code context" repos all sit
at 0–5 stars. The topic is hot and the framing those repos chose does not work.

## Phase 0 blockers — executed

| # | Change | Verification |
|---|---|---|
| 0.1 | `git init`, first commit | `git log` shows `d6563cb`, 43 tracked files |
| 0.2 | `LICENSE` (MIT) and `license` field in `package.json` | committed |
| 0.3 | `bin` entry + bare-command default so `npx agentlens` works with no arguments | `node src/cli.js` with no args prints the audit |
| 0.4 | README rewritten pain-first; old content preserved at `docs/reference.md` via `git mv` | reads as pain → proof → install → three use cases |
| 0.5 | Audit output written in English | the shareable surface is now global; dashboard strings remain Korean |
| 0.6 | Rename | **not executed** — recorded as the owner's decision in `../decisions/02-naming.md` |

## The audit command — the shareable artifact

New `src/audit.js`, 3 tests, wired as the default CLI command.

TDD: wrote the three tests first, confirmed RED (3 failures), implemented, GREEN. One test
expectation was wrong — I had omitted 400 rule bytes ÷ 4 from an expected total, so 27,100
should have been 27,200. The implementation was correct; I fixed the test, not the code.

Design constraints it honours:

- Findings are ranked largest-first, so the biggest win is the first line read.
- MCP servers and hooks appear under `not measured` with an explicit reason, never as an
  estimate. This is the difference between an audit that survives scrutiny and one that does not.
- Kiro contributes steering and skill bytes but no observed token total, so no percentage is
  fabricated for it.
- The empty case prints a useful message rather than zeros.

Real output on this machine: 15,581 tokens of measured startup cost across three harnesses,
with the largest single item being 5,728 tokens of Claude skill metadata across 35 skills.

## Also added

`.github/workflows/ci.yml` — Node tests on Ubuntu plus a run against an empty `--home` to catch
crashes on a machine with no agent installed, and Swift build and tests on macOS.

## Verification at the end of the session

- `npm test` — 55 passed
- `swift test` — 21 passed
- `node src/cli.js` — audit prints correctly with no arguments
- `node src/cli.js scan` and `telemetry` — still work, no regression

## Not done, and why

**Rename** (`../decisions/02-naming.md`) — branding identity belongs to the owner, and it
touches the bundle ID, env var, snapshot directory, and every document.

**MCP measurement** (`../decisions/03-mcp-measurement.md`) — requires launching configured
server processes, which breaks the read-only promise the project advertises. That tradeoff is
the owner's to accept and should not be slipped in beside unrelated work. It is the highest-value
remaining item.

**Demo GIF** — the research names a GIF or screenshot as part of the required README order. The
README currently embeds real terminal output as a code block, which proves the behaviour but is
weaker than a recording. No screen-recording tool is available in this environment.

**Dashboard i18n** — the web UI is still Korean. The audit is the front door and is English, so
this is no longer blocking, but it will limit the dashboard's reach.
