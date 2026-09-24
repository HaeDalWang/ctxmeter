# Pain validation — is "what is eating my context" a real, widely-felt problem?

Researched 2026-09-24. Every item below is a primary source, not a secondary summary.

## Verdict

Validated, loudly, and unsolved. This is not a niche annoyance; it is one of the most
recurring complaints in the Claude Code issue tracker, and the requested fix is
almost exactly what this project already computes.

## Primary evidence

| Source | Claim | Number |
|---|---|---|
| [claude-code#3036](https://github.com/anthropics/claude-code/issues/3036) | ~20 MCP servers exhaust the window in ~5 prompts | starts at 8–18%, hits 100% in 5 prompts |
| [claude-code#50133](https://github.com/anthropics/claude-code/issues/50133) | Startup overhead before the first user message | ~20%, one reporter ~30% with 2 servers (90 tools) |
| [claude-code#84490](https://github.com/anthropics/claude-code/issues/84490) | A single "hello" in a fresh session | 51,700–56,900 tokens |
| [claude-code#12241](https://github.com/anthropics/claude-code/issues/12241) | `/doctor` reporting MCP tool cost | 144,802 tokens; one server 125,964 |
| [claude-code#13717](https://github.com/anthropics/claude-code/issues/13717) | Referenced repeatedly | "MCP tools consume 50% of context tokens" |
| [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1mwxfit/) | Immediately after `/clear` | 83.3k tokens, 41.6% of context |
| [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1nntrkh/) | 5 MCP servers | 45k tokens; linear 12,935, jetbrains 12,252, playwright 9,804 |
| [claude-code#14851](https://github.com/anthropics/claude-code/issues/14851) | Commands became skills and load unprompted | qualitative, high engagement |
| [claude-code#40104](https://github.com/anthropics/claude-code/issues/40104) | Subagents inherit all MCP defs | "Prompt is too long" with ~200 tools |

## The requested feature is what we already do

claude-code#50133 asks, verbatim, for:

> Add a `/context` command showing a token breakdown of what was auto-loaded at session start

claude-code#21966 asks for:

> [FEATURE] Show deferred MCP tools overhead in `/context` command

Anthropic's own [Claude Code 101 context management](https://academy.claude.com/courses/claude-code-101/context-management)
course tells users to "check what's consuming your current context" and to
"manage your MCP servers" — but ships no tool that attributes the cost per server,
per skill, or per rule file across harnesses.

## The gap in our own product

The loudest single culprit in every source above is **MCP tool schemas**. Our scanner
counts MCP servers and then reports `estimatedTokens: null` / `미측정` for them.

We measure the things people complain about *least* (skill frontmatter, steering bytes)
precisely and the thing they complain about *most* not at all.

This is the most important finding of the entire research pass. See
`decisions/03-mcp-measurement.md`.

## What this implies for positioning

The pain is not "I would like observability." The pain is:

- "I lost 40% of my window before typing anything and I do not know which server did it."
- "Tell me what to turn off."

A dashboard answers the first half. Nothing currently answers the second half.
