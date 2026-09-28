<h1 align="center">ctxmeter</h1>

<p align="center"><b>Your AI coding agent burns tens of thousands of tokens before you type a single character.<br/>This tells you how many, where they went, and switches off the ones you pick.</b></p>

<p align="center">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-6e5aff?style=flat-square"></a>
  <img alt="Node 20+" src="https://img.shields.io/badge/node-20%2B-1f9d55?style=flat-square">
  <img alt="no network" src="https://img.shields.io/badge/network-none-0a0a0c?style=flat-square">
  <img alt="Claude Code, Codex, Kiro" src="https://img.shields.io/badge/agents-Claude%20Code%20%7C%20Codex%20%7C%20Kiro-2ec7b6?style=flat-square">
</p>

```bash
npx ctxmeter
```

<p align="center"><img src="docs/demo.gif" alt="ctxmeter audit output showing 33,458 tokens of startup cost across Kiro, Claude Code, and Codex" width="760"></p>

Skills, rule files, steering docs, hooks, and MCP servers all load at session start. You find out when compaction hits. One command, no config, no account, nothing leaves your machine.

## Quickstart

```bash
# 1. What does my setup cost right now?
npx ctxmeter

# 2. Include MCP tool schemas, the biggest and least visible cost.
#    This one starts your servers, so it is opt-in. See what it would run first:
npx ctxmeter mcp-scan --dry-run
npx ctxmeter mcp-scan --i-understand-this-launches-servers

# 3. Switch the expensive ones off. Dry run first; --disable backs up and prints the undo.
npx ctxmeter fix
npx ctxmeter fix --disable codex/code-review-graph   # --enable turns it back on

# 4. Watch context per turn, and switch items from the macOS menu bar.
git clone https://github.com/HaeDalWang/ctxmeter && cd ctxmeter/menubar
make install     # then launch CtxmeterBar from /Applications

# Everything else
npx ctxmeter --help
```

Measure, then act. Two surfaces over the same numbers: the CLI for a one-shot audit and fix, and a menu bar app that charts context per turn and switches items on and off.

## Why you might want this

**You keep hitting compaction earlier than expected.** Reported in the wild: [20% of the window gone before the first message](https://github.com/anthropics/claude-code/issues/50133), [50k+ tokens for a fresh "hello"](https://github.com/anthropics/claude-code/issues/84490), [83.3k tokens immediately after `/clear`](https://www.reddit.com/r/ClaudeCode/comments/1mwxfit/), [one MCP server measured at 125,964 tokens](https://github.com/anthropics/claude-code/issues/12241). Step one is finding out which files and servers are responsible.

**You installed a plugin bundle and forgot.** One skill group can list hundreds of skills, and every one contributes frontmatter at startup. ctxmeter ranks them so the biggest is the first line you read.

**You run more than one agent.** Claude Code, Codex, and Kiro each keep their own skills, rules, hooks, and MCP config in their own layout. This reads all three and puts them side by side — the only tool that does.

## Measuring MCP, the part nobody else measures

MCP tool schemas are the largest reported cost, and they exist **only in the live prompt** — no local file contains them. So measuring honestly means starting each server and asking it.

That contradicts a read-only promise, so it is a separate command behind an explicit flag:

```bash
ctxmeter mcp-scan --dry-run     # exactly what would be started, env names only
ctxmeter mcp-scan --i-understand-this-launches-servers
```

```
MCP tool schemas cost 17,877 tokens across 78 tools.

  codex/code-review-graph: 7,298 tokens, 30 tools
  kiro/playwright: 4,352 tokens, 25 tools
  kiro/aws-mcp: 2,892 tokens, 8 tools
  kiro/context7: 1,148 tokens, 2 tools
  codex/shadcn: 1,124 tokens, 7 tools
  codex/node_repl: 541 tokens, 4 tools
  kiro/exa: 522 tokens, 2 tools
```

Per-server timeouts, hard kills, remote servers skipped unless you opt in, and schemas discarded after counting. Servers you have switched off are never started. The result is cached so `ctxmeter` folds it into the audit.

## Then switch the expensive ones off

Knowing the number is half of it. `fix` turns each finding into one edit, and the edit is always a single key because every harness already ships a disable flag.

```bash
ctxmeter fix                                  # dry run, changes nothing
ctxmeter fix --disable codex/code-review-graph  # one target at a time
```

```
20,747 tokens sit behind 12 switches you can flip.

     7,298  codex/code-review-graph, 30 tools
            [mcp_servers.code-review-graph] in ~/.codex/config.toml
     4,352  kiro/playwright, 25 tools
            "playwright" in ~/.kiro/settings/mcp.json
     2,892  kiro/aws-mcp, 8 tools
            "aws-mcp" in ~/.kiro/settings/mcp.json
     1,890  claude/plugin:aws-core@agent-toolkit-for-aws, 13 skills
            "aws-core@agent-toolkit-for-aws" in ~/.claude/settings.json
       ...

Nothing has been changed. To switch one off:
  ctxmeter fix --disable codex/code-review-graph
```

Claude plugins switch through `enabledPlugins` in `~/.claude/settings.json`. Claude MCP servers are listed with the `/mcp` step instead of a target: their off switch lives in `~/.claude.json`, which Claude rewrites while it runs, so ctxmeter does not edit it.

Applying writes a backup next to the original and prints the undo command:

```
Switched off codex/code-review-graph, freeing about 7,298 tokens at startup.

  changed  ~/.codex/config.toml
  backup   ~/.codex/config.toml.ctxmeter-2026-09-24T13-43-48-623Z.bak

To undo:
  cp '~/.codex/config.toml.ctxmeter-2026-09-24T13-43-48-623Z.bak' '~/.codex/config.toml'
```

TOML is edited line by line and never reserialized, so comments and the other 78 sections keep their bytes. JSON is reserialized but only after a round trip proves the key order and the edit survived; a file that will not parse is refused rather than repaired. There is no bulk apply, and there is no undo log — the printed `cp` still works after ctxmeter is uninstalled.

**It will not touch your writing.** `CLAUDE.md`, `AGENTS.md`, rule files, and steering documents are reported but never edited. Turning off an MCP server is a setting; moving your rule file is editing your work.

## The macOS menu bar app

One icon and one number in the menu bar: how full the context window of the agent you are watching is, refreshed every 30 seconds.

- **Popover:** context per turn for the current session of each agent, with compaction marked; hover a bar for that turn's value. Each agent's tab adds the largest sessions of the last 7 days.
- **Details:** what the window is made of — instructions, skills, MCP schemas, messages, autocompact reserve, free — and every item that loads at startup, ranked by cost, with a switch on each one that has a native off flag. Every switch asks for confirmation, keeps a backup, and tells you which agent to restart.

```bash
cd menubar
make install     # /Applications/CtxmeterBar.app
scripts/ctxmeter-bar.sh on | off | toggle | status   # from the repo root
```

Swift and SwiftPM only; full Xcode is not required. Agent icons are read from the vendor apps installed on your Mac, so no trademarked artwork ships in this repo. Telemetry refresh reads session usage only; session history refreshes at most once a minute, and the Details scan runs only when the window opens or after a switch. [Details](menubar/README.md).

## What it never does

No prompt text, rule text, skill bodies, or credentials are copied. No network connection except MCP servers you explicitly opt into. No background watcher, no database, no telemetry. Prompt-history files are never opened. Snapshots hold paths, counts, and byte estimates only — the test suite asserts it.

Two commands step outside read-only, and both require an explicit flag:

| Command | What it does beyond reading | Gate |
|---|---|---|
| `mcp-scan` | starts each configured server to read its tool list | `--i-understand-this-launches-servers` |
| `fix` | sets one key in one config file | `--disable` / `--enable <target>` |
| menu bar switches | the same edit as `fix` | a confirmation dialog on every switch |

Everything else only reads, and the default invocation of both of those only reads too. `mcp-scan` passes your shell environment through to each server it starts, because servers need `PATH` and `HOME` to run at all. That is how every MCP client works, and it is why the command is opt-in.

## What it cannot tell you

**Static figures are bytes ÷ 4.** A heuristic, not a tokenizer. Claude and Codex session totals are observed exactly; Kiro records only a percentage, so no token count is derived from it.

**Hook output is unmeasurable.** Its size depends on what hooks emit at runtime.

**A model with no known capacity stays unknown.** No context window is ever guessed.

## Commands

| Command | What it does |
|---|---|
| `npx ctxmeter` | audit; ranked startup cost per agent |
| `npx ctxmeter mcp-scan` | measure MCP tool schemas (starts your servers) |
| `npx ctxmeter fix` | list switches that would free tokens; `--disable` / `--enable` to flip one; `--json` for all |
| `npx ctxmeter scan` | full inventory snapshot as JSON |
| `npx ctxmeter telemetry` | current session usage as JSON, ~0.2s |
| `npx ctxmeter history` | context per turn and the largest recent sessions, as JSON |
| `npx ctxmeter details` | what each agent's context is made of, with every switch, as JSON |
| `npx ctxmeter --help` | every command and flag |
| `cd menubar && make install` | macOS menu bar app |

`--home` and `--workspace` override paths on any command.

## Requirements

Node 20+. The menu bar app needs macOS 14+ and the Swift toolchain; full Xcode is not required.

Tested on macOS. Linux should work and is covered by CI for the Node side. Windows support for `mcp-scan` is implemented but unverified.

## License

MIT. Detailed behaviour and measurement limits in [docs/reference.md](docs/reference.md).
