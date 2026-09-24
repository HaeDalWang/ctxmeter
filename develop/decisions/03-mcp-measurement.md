# Decision 03 — MCP tool schema cost: the killer feature and its cost

Date 2026-09-24. Status: **designed, NOT executed. Needs the owner's call on the safety tradeoff.**

## Why this is the single highest-value feature

Every primary source in `research/01-pain-validation.md` names MCP tool schemas as the
dominant consumer. One server measured at 125,964 tokens. `/doctor` reporting 144,802.
Reddit reporting 83.3k (41.6%) immediately after `/clear`.

We currently report MCP as a count with `estimatedTokens: null`. We measure skill
frontmatter to the byte and the actual villain not at all. Closing this gap converts the
project from "interesting inventory" to "the tool that answers the question everyone is asking".

## Why it cannot be read from disk

Checked on this machine:

- `~/.claude/mcp-health-cache.json` holds status, timestamps, failure counts — **no tool
  names, no schemas, no counts**. A grep for `inputSchema|"tools"|toolCount` returns 0 hits.
- `~/.claude/mcp-needs-auth-cache.json` holds auth state only.
- The session JSONL contains `mcp__*` strings 40 times, but those are tool *invocations*.
  The schema block itself is never written to disk.

Conclusion: the schema exists only in the live prompt. There is no local artifact to parse.

## The only way to measure it

Spawn each configured MCP server and issue a JSON-RPC `tools/list`, then count the
serialized schema. We already parse `mcp.json` and `config.toml`, so the server inventory
is in hand.

## The tradeoff this forces

The project's entire trust proposition is in its README and its warnings:

> It does not use a background watcher, database, Docker container, or external network request.
> This snapshot stores metadata only and does not copy prompt, rule, skill, or secret contents.

Spawning MCP servers breaks the spirit of that. It means:

- **Executing arbitrary configured commands.** An MCP server entry is a shell command with
  arguments and environment. Running the scanner would run them.
- **Network activity.** Many MCP servers dial out on startup. "No external network request"
  stops being true.
- **Credential use.** Servers with API keys in env would authenticate.
- **Side effects.** Nothing guarantees an MCP server's startup is read-only.

For a tool whose pitch is "read-only and local", turning it into a process launcher is not
a small change. It is the one decision here that could damage the project's credibility
rather than grow it.

## Recommended design if the owner approves

Opt-in and loud, never default:

1. New command `agentlens mcp-scan`, never part of `scan` or `telemetry`.
2. Requires an explicit flag to run at all: `--i-understand-this-launches-servers`.
3. Per-server timeout (5s default) and hard kill; one bad server cannot hang the scan.
4. Serialize only `name`, `description`, and `inputSchema` per tool; count bytes; store
   **counts and byte totals only**, never the schema text — consistent with the existing
   privacy rule that the snapshot holds metadata, not content.
5. Results cached to `.agentlens/mcp-cost.json` with a timestamp so the expensive path runs
   rarely and the dashboard reads the cache.
6. The README must state plainly that this one command launches processes, and why.
7. `--dry-run` listing exactly which commands *would* be executed, so a user can inspect
   before consenting.

## Honest assessment of the alternative

Not doing it leaves the headline number incomplete forever, and a reviewer on Hacker News
will find that hole immediately — "it does not measure the thing that actually costs me
100k tokens" is a fair and fatal comment.

A middle path exists and is weak: ship a curated table of well-known servers' typical tool
counts. That is guessing with extra steps and contradicts the `용량 미확인` discipline the
project has maintained everywhere else. Rejected.

## Status

Not implemented in this session. The safety tradeoff is the owner's to accept, and it is
the kind of change that should not be slipped in alongside unrelated work.
