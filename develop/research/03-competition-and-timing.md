# Competitive landscape and timing

Measured 2026-09-24. All figures pulled live from the GitHub and npm APIs on that date.

## The proven star magnet in the adjacent space

`steipete/CodexBar`:

| Metric | Value |
|---|---|
| Stars | 21,863 |
| Created | 2025-11-16 (312 days) |
| Velocity | ~70 stars/day |
| Releases | 100 |
| Contributors | 30 |
| Forks | 1,999 |
| Homepage | codex.bar |

Two honest readings of this number:

1. **The category is hot.** A menu bar app about AI coding limits earned 21.9K in ten months.
2. **The author is a confound.** steipete has a large pre-existing following. Velocity
   attributable to the idea alone is unknown and is certainly lower. Any plan that assumes
   "build something comparable, get comparable stars" is wrong.

What is transferable and not audience-dependent: **100 releases in 312 days.** Near-daily
shipping is visible, and it is the one CodexBar behaviour reproducible without fame.

CodexBar answers quota/limits/spend. It supports Kiro among 84 providers. It does **not**
attribute context composition. The overlap is the surface (menu bar, AI, macOS), not the question.

## The direct category is empty — and that cuts both ways

Searching `claude code context tokens`:

| Stars | Velocity | Age | Repo |
|---|---|---|---|
| 5 | 0.1/day | 79d | shehab267/ccbrief |
| 3 | 0.0/day | 167d | millenniumbismay/minimal-claude-status |
| 0 | 0.0/day | 157d | falconerdean/claude-context-notes |
| 0 | 0.0/day | 178d | mikekoka/claude-statusline |
| 0 | 0.0/day | 45d | Criptso/claude-code-statusline |
| 0 | 0.0/day | 72d | lbonnaireYellowtail/claude-statusline |
| 0 | 0.0/day | 185d | tylyp/YetAnotherCCStatusLine |

Nobody owns this. But seven attempts at ~0 stars is evidence that **"a status line that
shows context %" does not earn stars.** The framing is the failure, not the topic — the
pain in `01-pain-validation.md` is enormous, so demand exists and these tools are not
meeting it. They display a number; they do not tell you what to remove.

## Name collision — a hard blocker

`agentlens` is saturated. GitHub exact and near matches:

| Stars | Repo | Overlap with us |
|---|---|---|
| 1,029 | ZhangJinHaHaHa/AgentLens | none (agent trading) |
| 59 | nguyenphutrong/agentlens | adjacent (codebase symbol maps for AI) |
| 36 | RobertTLange/agentlens | **direct** — "Local in-depth observability for coding-agent sessions" |
| 23 | agentkitai/agentlens | direct (agent observability platform) |
| 23 | PacemakerG/CCWhat | **direct** — local observability for Claude Code, Codex, OpenCode |
| 13 | msrivastav13/AgentLens | unknown |
| 11 | kim-jeong-hyeon/AgentLens | unknown |
| 10 | agenticloops-ai/agentlens | **direct** — profiles prompts, tools, MCP, token usage |

`npm i agentlens` is already taken.

Three of these occupy our exact positioning. Search traffic for the name splits eight ways
and the npm entry point is gone. Keeping the name forfeits discoverability, which the
research in `02-viral-mechanics.md` shows is a primary growth channel (awesome lists and
search both depend on a unique, findable name).

## Availability scan for replacements

| Candidate | npm | Exact-name repos |
|---|---|---|
| ctxmeter | free | 1 |
| ctxaudit | free | 1 |
| ctxbudget | free | 3 |
| contextmeter | free | 4 |
| ctxwatch | free | 4 |
| contextbudget | free | 8 |
| agentctx | free | 15 |
| tokenscope | free | 25 |
| tokenlens | taken | 16 |
| primer | taken | 7 |

Only `ctxmeter` and `ctxaudit` are clean on both axes.

## Timing — why the window is now and narrow

The user's constraint is explicit: the target is 10K measured against *today's* market,
and AI tooling moves fast. That makes timing a first-class risk, not a footnote.

**Why now is favourable:**

- The pain is peaking. MCP proliferation is recent and the complaint volume is current.
- Anthropic has shipped `/context` and lazy tool loading but has *not* shipped
  per-server attribution; claude-code#21966 and #50133 are open feature requests.
- No incumbent owns the framing.

**What closes the window:**

- Anthropic shipping a full `/context` breakdown with per-MCP attribution ends the
  single-harness value instantly. Our cross-harness story (Claude + Codex + Kiro in one
  view) survives that; the single-harness story does not.
- Lazy-loading MCP schemas by default would shrink the pain itself.
- CodexBar adding context composition would take the category with an existing audience.

**Conclusion:** the differentiated, durable asset is *cross-harness* attribution plus
*actionable* output. Anything that only reports Claude's numbers is living on borrowed
time measured in weeks.
