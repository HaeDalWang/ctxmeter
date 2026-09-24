# 05 — How `fix` is allowed to touch a config file

`ctxmeter fix` is the first command that writes. Everything before it was
read-only, and that read-only property is in the README, the badges, and the test
suite. This records what the write is permitted to be.

## The finding that shaped the whole design

Every harness already has a native disable flag, and every one of them is already
in use on this machine:

| Harness | File | Flag | Already used on |
|---|---|---|---|
| Claude | `~/.claude/mcp.json` | `"disabled": true` | both of its servers |
| Codex | `~/.codex/config.toml` | `enabled = false` | `cua_repl`, and 12 of 14 plugins |
| Kiro | `~/.kiro/settings/mcp.json` | `"disabled": true` | none yet |

So `fix` never has to comment out a block, delete a section, or move a file. Every
change is one key. That collapses the risk surface to almost nothing and it is why
this feature is worth building now rather than later.

## Rules

**Dry run is the default.** `ctxmeter fix` prints proposals and the exact edit it
would make. Writing requires `--apply` plus a named target. There is no bulk apply
in this version; `--apply` with no target lists the valid targets and exits
non-zero. A blunt "fix everything" against someone's agent config has to earn
trust first.

**TOML is edited line by line, never reserialized.** The file has 79 sections and
comments, and there is no TOML writer here. The applier locates the section's line
range, replaces an existing `enabled = ...` inside it, or inserts
`enabled = false` directly after the header. Every other byte is untouched.

**JSON is parsed and reserialized, but only when that is provably safe.** JSON has
no comments, so there is no line-level trick. Both files are small and machine
written. The applier round-trips first: parse, serialize, reparse, and require the
result to be deep-equal to the original with only the one key added. A file that
fails to parse — JSONC with comments, a trailing comma — is refused, not repaired.
Trailing newline presence is preserved.

**A backup sits next to the original.** `<name>.ctxmeter-<timestamp>.bak`, in the
same directory. Not in the workspace: a home-directory file backed up into a
workspace can be orphaned by deleting that workspace, and the user looks for it
beside the file. The rollback is then a `cp` with both paths in one directory,
printed verbatim.

**Undo is a printed command, not stored state.** No undo log, no database. The
restore command works after ctxmeter is uninstalled, which a `--undo` flag reading
private state would not.

**Nothing is proposed that is already off, or that was never measured.** A proposal
requires the item to be currently enabled and to carry a real measured token count.
Ranking is by tokens saved.

**Refuse rather than guess.** Unparseable file, ambiguous section, or a file whose
bytes changed since the measurement — all produce a refusal with the reason, not a
best-effort edit.

## What is in scope, and what is deliberately not

In scope: MCP servers, and Codex plugin groups. Both are configuration toggles with
a vendor-supported off switch, and both are fully reversible.

Out of scope: `CLAUDE.md`, `AGENTS.md`, rule files, steering documents, and skills
the user wrote. These are content, not configuration. Turning off an MCP server is
a setting; moving someone's rule file is editing their work. The audit will keep
reporting their cost and the user can act on it themselves.

## Two defects that had to be fixed first

Found while reading the real files, both of which would have made `fix` wrong.

**`mcp-scan` starts servers the user disabled.** `codexEntries` never looked at
`enabled`. `cua_repl` is set to `enabled = false` and its command is
`/Applications/ChatGPT.app/Contents/MacOS/ChatGPT`, so every `mcp-scan` was
launching the ChatGPT GUI app and then reporting the 20-second timeout that
appeared in the README's own sample output. Beyond the wasted launch, it inflates
the "not measured" count with something that costs nothing.

Without this fix, `fix` would propose disabling a server that is already off.

**Kiro's MCP servers were invisible.** `~/.kiro/settings/mcp.json` holds four
servers and nothing read it — not the cost measurement, not the configured-server
count. Kiro's audit line showed no MCP row and no "not measured" note, so its cost
read as zero.

Without this fix, `fix` would have nothing to offer Kiro users.

## Consequence for the README's read-only claim

The claim has to become precise rather than absolute. Two commands step outside it
and both are opt-in behind an explicit flag: `mcp-scan` starts processes, `fix`
writes files. Everything else remains read-only, and the default invocation of
every command — including `fix` — still is.
