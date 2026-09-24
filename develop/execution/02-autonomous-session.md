# Execution log — 2026-09-24, autonomous pass

The owner delegated both deferred decisions and asked for best effort rather than
permission. This records what I chose and why, so the reasoning survives.

## 1. MCP tool schema measurement — built

This was the highest-value item in `../PLAN.md` and the one credibility hole: every
primary source names MCP as the dominant cost and we reported it as `not measured`.

### What I confirmed before building

There is no file to read. On this machine `~/.claude/mcp-health-cache.json` holds status,
timestamps and failure counts; a grep for `inputSchema|"tools"|toolCount` returns zero hits.
The session JSONL contains `mcp__*` forty times, but those are invocations, not definitions.
The schema exists only in the live prompt.

So the only honest measurement is to start each server and call `tools/list`. I built that,
and I kept every guard from the design in `../decisions/03-mcp-measurement.md`:

- Separate `mcp-scan` command. Never part of `scan`, `audit`, or `telemetry`.
- Refuses to run without `--i-understand-this-launches-servers`, and the refusal message
  explains why the file-reading alternative does not exist.
- `--dry-run` prints the exact command line per server plus **env variable names only**.
  A test asserts the values never appear; one real server here carries `OBSIDIAN_API_KEY`.
- Remote servers are skipped unless `--allow-remote`, because those are genuine network calls.
- Per-server timeout with `SIGKILL`; one hung server cannot stall the scan.
- Only `name`, `description`, and `inputSchema` are counted — the fields a model is shown.
  Server-side `_meta` and `annotations` are excluded. A test proves a 5,000-byte `_meta`
  does not inflate the number.
- Schemas are discarded after counting. Tests assert the result contains neither
  `inputSchema` nor any tool name.

### Verification

Seven tests, including an end-to-end run against a fake stdio MCP server fixture written
for the purpose, plus timeout and spawn-failure cases.

Then against the real configuration on this machine: **18,813 tokens across 51 tools.**
`codex/obsidian` alone is 8,526 tokens for 12 tools. Two servers failed or timed out and
were reported as such rather than silently dropped — which is the behaviour I wanted to see.

### The side effect I accepted knowingly

One configured server is `/Applications/ChatGPT.app/Contents/MacOS/ChatGPT`. Running
`mcp-scan` starts it. It timed out and was killed, but a user could see an app launch.
This is exactly the risk that justified the consent flag, and it is now documented in the
README rather than discovered by surprise.

### The payoff

Folding the cached measurement into the audit moved the headline from 15,581 to **34,394
tokens**, and reordered the list: Codex went from last to first because its MCP servers cost
16,948 tokens — more than its skills and instructions combined. That reordering is the
insight the tool exists to produce, and without MCP measurement it was invisible.

## 2. Rename to `ctxmeter` — done

`agentlens` collided with eight GitHub repos, three in identical positioning, and npm was
taken. Evidence in `../research/03-competition-and-timing.md`.

Chose `ctxmeter` over `ctxaudit`: both are clean on npm and GitHub, `ctxmeter` is shorter,
pronounceable as "context meter", and covers the continuous surfaces (menu bar, dashboard)
as well as the one-shot audit.

Renamed everything rather than only the user-visible strings. Swift targets, modules, source
directories, bundle identifier, `CTXMETER_PORT`, and the `.ctxmeter/` snapshot directory all
moved; 23 existing snapshots were migrated rather than orphaned. Leaving internal names
mismatched would read as sloppy to a visitor, and sloppiness is expensive for a repo trying
to earn trust in seven seconds.

Verified after: 63 Node tests, 21 Swift tests, `npx`-style bare invocation, `scan` writing to
the new directory, and the menu bar app rebuilt and relaunched as `CtxmeterBar.app`.

## 3. README and demo asset — done

The research names a GIF or screenshot as a required README element and I have no screen
recorder. I hand-wrote `docs/demo.svg`: a terminal window with the real audit output revealed
line by line via staggered SVG `animate` elements. It renders inline on GitHub, weighs a few
kilobytes, needs no recording tool, and stays legible in dark and light themes.

README now follows the order the 50-repo study prescribes — pain sentence, proof image,
install command, three use cases — and leads with "open source, local, no account" rather
than "AI", per the finding that open-source framing carries roughly 3× the Show HN virality
of AI framing. The MCP section is placed immediately after the use cases because it is the
only genuine differentiator.

## What remains, honestly

**Dashboard is still Korean.** The audit is the front door and is English, so this no longer
blocks adoption, but the dashboard's reach is limited until it is translated. Mechanical work,
low risk, not done here.

**No published npm package.** `private: true` is still set. Publishing requires the owner's
npm account, so `npx ctxmeter` will not work for anyone until that happens. This is now the
single largest gap between the README's promise and reality, and it is the next thing to do.

**Hook output remains unmeasurable** and always will be; its size depends on runtime emission.

**No launch yet.** Per `../PLAN.md` the sequence is rename → MCP → launch → engine. The first
two are now done, so the launch is unblocked. Tue–Thu 08:00–10:00 EST, title 60–80 characters,
minimal capitalisation, personal story rather than feature list.
