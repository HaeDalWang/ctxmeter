# 05 — `fix`, and the numbers it corrected on the way

Goal for the session: move ctxmeter from reporting to acting. The operator picked
`fix` first and left the rest of the order open.

Reading the real config files before writing any code turned out to matter more
than the feature. Three defects surfaced, and correcting them changed the published
figures substantially — in both directions.

## The numbers were wrong

| | before | after | why |
|---|---|---|---|
| total | 34,394 | 36,657 | net of the three corrections below |
| Kiro | 4,070 | **12,984** | its four MCP servers had never been read |
| Codex | 19,779 | **11,253** | a disabled `obsidian` was contributing a phantom 8,526 |
| Claude Code | 10,545 | 12,420 | remote servers now measured with `--allow-remote` |
| Codex unmeasured | 3 servers | 1 server | two of the three were switched off, not unknown |
| `mcp-scan` headline | 18,813 / 51 tools | 21,076 / 81 tools | omitted Kiro, counted two disabled servers |

Kiro moved from the cheapest harness to the most expensive. The ranking in the
README, the demo GIF, and every screenshot was inverted.

### Defect 1 — servers the user had switched off were being started

`codexEntries` never looked at `enabled`. Two Codex servers on this machine are set
to `enabled = false`, and one of them, `cua_repl`, has
`/Applications/ChatGPT.app/Contents/MacOS/ChatGPT` as its command. Every `mcp-scan`
launched the ChatGPT GUI app and then reported the 20-second timeout that appeared
in the README's own sample output as though it were a measurement problem.

### Defect 2 — Kiro's MCP servers were invisible

`~/.kiro/settings/mcp.json` holds four servers and nothing read it. Claude and Kiro
share the `mcpServers` + `disabled` shape, so one reader now serves both.

### Defect 3 — disabled servers inflated the unmeasured count

The scanner counted every configured server regardless of its flag and the audit
subtracted the measured ones, so switched-off servers surfaced as unknowns. The
whole project's discipline is about not overstating what is unknown, and this was
overstating it.

## What made `fix` safe enough to build

Every harness already has a native disable flag, and every one was already in use
on this machine. That collapsed the design: a change is never more than one key, so
there is no need to comment out a block, delete a section, or move a file.

| Harness | Flag | Default when absent |
|---|---|---|
| Claude, Kiro | `"disabled": true` in JSON | enabled |
| Codex MCP | `enabled = false` in TOML | enabled |
| Codex plugins | `enabled = true` in TOML | **off** |

The inverted default on plugin groups is why two separate readers exist rather than
one shared one. Sharing would have silently disabled every plugin group or enabled
every MCP server, depending on which default won.

TOML is edited line by line and never reserialized — the file has 79 sections and
comments. JSON is reserialized but only after a round trip proves key order and the
edit survived, and an unparseable file is refused rather than repaired.

Result on real data: 21,486 tokens behind 10 switches.

## The bug that mattered most

The first implementation gated proposals on `status === 'ok'`. This codebase never
emits that value; the real one is `'measured'`. Twelve unit tests passed, because
their fixtures repeated the same invention. A fully green suite sat on top of a
feature that produced zero MCP proposals against real data, and only running it
against the actual machine revealed it.

Fixed structurally rather than with another test: `MEASURED_STATUS` is exported from
`mcp-cost.js` and imported by `audit.js`, `fix.js`, and the fixtures, so the literal
exists once. No test has to notice drift because drift is no longer expressible.

This is the second time this session that a green suite covered a broken feature.
The first was `public/app.js`, which failed to parse at all while 81 tests passed
because nothing ever loaded it. Both had the same shape: the test suite verified
what it could reach, and the gap was somewhere it could not.

## Verification harnesses lied five times

Worth recording as a pattern, because in every case the code was correct and the
measurement was wrong:

1. `2>&1 >/dev/null` appeared to prove the report went to stderr. zsh MULTIOS tees
   to multiple destinations, so the test meant nothing.
2. `rm -f *.gif && vhs ...` — zsh NOMATCH aborted the `rm`, so `&&` short-circuited
   and VHS never ran. Its absence from the process list was read as evidence.
3. Accessibility clicks dismissed the popover without firing SwiftUI actions, and AX
   window counts for the app returned 1, 0, and 2 for the same state. A synthesized
   `CGEvent` mouse click settled it in one attempt.
4. The sandbox script hashed `$(basename "$f")`, and `.claude/mcp.json` and
   `.kiro/settings/mcp.json` share a basename, so one hash overwrote the other and
   reported a file as modified that had not been touched.
5. `set -o pipefail` made `run ... | grep -q` report the producer's non-zero exit, so
   a correctly refused second apply read as "not refused".

The lesson that generalises: when a measurement disagrees with the code, suspect the
measurement first, and prefer the path a real user takes — a real mouse click, a real
file, a real status value — over a synthetic stand-in.

## Menu bar identifiability

The operator could not tell which menu bar item was ctxmeter's, because CodexBar
also shows a vendor icon beside a percentage and both read close to the same number.
Worse, the two run in opposite directions: CodexBar's 96% is quota remaining and
good, ctxmeter's 19% is context used and bad.

A gauge glyph now leads the label, and the tooltip names the tool and says what the
number measures. `gauge.medium` was checked against `NSImage(systemSymbolName:)`
before shipping, because a name that does not resolve renders as nothing — a test
now asserts it so the mark cannot silently disappear.

Could not screenshot the result: the IDE is fullscreen, so that Space has no menu
bar, and window focus is not controllable from here. Verified through the
accessibility label instead, which now reads
`ctxmeter · context window used / CC 19% · CX 27% · KI 36%`.

## State

Node tests 66 → 119. Swift tests 21 → 26. Coverage: `fix.js` 100%,
`config-edit.js` 97.8%, overall 93.6%.

`scripts/verify-fix-sandbox.sh` copies the real configs to a temporary home and
checks one added TOML line, one added JSON key, the untouched file byte-identical, a
second apply refused with exit 1, and byte-for-byte restoration from the printed
rollback. Live configs confirmed untouched: no backup was ever written beside them
and the `enabled = false` count in the real `config.toml` is unchanged at 13.

## Next

1. `npm publish` — still the only thing blocking `npx ctxmeter` for anyone else, and
   it needs the operator's credentials.
2. Watch mode with a diff against `.ctxmeter/snapshots/` history.
3. `--exact` opt-in tokenizer, as a dev or optional dependency.
4. `CONTRIBUTING.md` and issue templates.
5. Raise `cli.js` coverage, currently 77.1%; the HTTP MCP transport is still
   untested.
6. Homebrew tap and Sparkle for menu bar distribution.
