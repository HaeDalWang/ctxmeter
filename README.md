# AgentLens

**Your AI coding agent burns thousands of tokens before you type a single character. This tells you how many, and what to delete.**

Skills, rule files, steering docs, hooks, and MCP servers all load at session start. You find out when compaction hits. One command, no account, nothing leaves your machine.

```bash
npx agentlens
```

```
Your agent setup costs 15,581 tokens before you type anything.

Claude Code: 8,680 tokens — 0.9% of 1,000,000
      5,728  Skill metadata listed at startup
             35 skills; largest group user-skills at 3,268 tokens
      2,952  Global instructions and rules
             CLAUDE.md + 6 rule files
  observed latest input: 188,381 tokens
  not measured: 2 MCP servers, 16 hooks

Kiro: 4,070 tokens — 0.4% of 1,000,000
      2,275  Steering documents
             6 steering files
      1,795  Skill metadata listed at startup
             13 skills; largest group user-skills at 1,795 tokens

Codex: 2,831 tokens — 1.1% of 258,400
      2,245  Skill metadata listed at startup
             18 skills; largest group user-and-system-skills at 1,340 tokens
        586  Global instructions
             AGENTS.md
  observed latest input: 69,784 tokens
  not measured: 5 MCP servers, 10 hooks
```

Works with **Claude Code**, **Codex**, and **Kiro** in one view. No configuration.

## Why you might want this

**You keep hitting compaction earlier than expected.** Reported cases include [20% of the window gone before the first message](https://github.com/anthropics/claude-code/issues/50133), [50k+ tokens for a fresh "hello"](https://github.com/anthropics/claude-code/issues/84490), and [83.3k tokens immediately after `/clear`](https://www.reddit.com/r/ClaudeCode/comments/1mwxfit/). If that is you, the first step is finding out which files are responsible.

**You installed a plugin bundle and forgot.** A single skill group can list hundreds of skills, and every one of them contributes frontmatter at startup. AgentLens ranks them so the biggest one is the first line you read.

**You run more than one agent.** Claude Code, Codex, and Kiro each keep their own skills, rules, hooks, and MCP config in their own layout. This reads all three and puts them side by side.

## Also included

**Web dashboard** — `npm run dashboard`, serves on `127.0.0.1:4318` only. Per-harness context maps, a collapsible per-file cost list, and live session numbers polled while the tab is visible.

**macOS menu bar app** — `cd menubar && make run`. Shows current occupancy per agent with vendor icons read from your installed apps. See [menubar/README.md](menubar/README.md).

## What it reads, and what it never does

It reads local configuration and session files under `~/.claude`, `~/.codex`, and `~/.kiro`.

It does not copy prompt text, rule text, skill bodies, or credentials. It does not open a network connection, run a background watcher, or use a database. Prompt-history files are never opened. Snapshots contain paths, counts, byte estimates, and numeric token totals only — the test suite asserts this.

## What it cannot tell you

**MCP tool schemas are not measured.** They are the largest cost reported in the wild — [one server measured at 125,964 tokens](https://github.com/anthropics/claude-code/issues/12241) — and they are injected at runtime and never written to disk. Measuring them would mean launching your configured servers, which contradicts the read-only promise. It is deliberately left as `not measured` rather than guessed.

**Static figures are bytes ÷ 4.** A heuristic, not a tokenizer. Session totals for Claude and Codex are observed exactly; Kiro records only a percentage, so no token count is derived from it.

**A model with no known capacity stays unknown.** No context window is ever guessed.

## Commands

| Command | What it does |
|---|---|
| `npx agentlens` | audit; prints the ranked startup cost |
| `npx agentlens scan` | writes a full inventory snapshot as JSON |
| `npx agentlens telemetry` | current session usage as JSON, ~0.2s, no inventory scan |
| `npm run dashboard` | local web dashboard |

`--home` and `--workspace` override the paths for any command.

## Requirements

Node 20+. The menu bar app needs macOS 14+ and the Swift toolchain; full Xcode is not required.

## License

MIT. See [LICENSE](LICENSE). Detailed behaviour in [docs/reference.md](docs/reference.md).
