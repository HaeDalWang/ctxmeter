# Pre-publish self review — 2026-09-24

The owner asked whether this is actually ready, and to keep finding gaps rather than
declare victory. I ran the checks instead of reasoning about them. Five real defects
surfaced, all now fixed, plus a list of things I cannot fix and things I lack the
ability to do at all.

## Defects found and fixed

### 1. Phantom MCP cost on a foreign home — correctness, severity HIGH

`audit --home <empty dir>` reported **18,813 tokens of MCP cost that did not exist**.
The MCP cache lives in the workspace, so it was read regardless of which home was scanned.
Every case I tested — empty home, Claude-only, deliberately corrupt JSON — printed the
same fabricated figure instead of "No local agent configuration found."

This is precisely the failure that would discredit the project on day one: a reviewer runs
it in a container, sees invented numbers, and says so publicly.

Fix: the cache now records the home it measured, and `auditReport` ignores any cache whose
home does not match the scanned home. A cache with no recorded home is treated as untrusted,
so caches written by the previous build are rejected rather than silently trusted.

Verified: all three synthetic environments now print "No local agent configuration found",
and the real environment still reports 34,394 after remeasuring.

### 2. `docs/demo.svg` missing from the npm tarball — severity MEDIUM

`npm pack --dry-run` showed the README shipping without the image it references. The README
on npmjs.com would have rendered a broken image — the first impression for anyone arriving
from `npx`. Added to the `files` list; the tarball now contains it.

### 3. Unbounded stdout buffer in the MCP spawner — robustness, severity MEDIUM

A server that streams output without ever answering `tools/list` would grow our buffer until
the process died. Capped at 8 MB with a clear `too much output` status. Test spawns a server
that floods 64 KB every millisecond and asserts it is cut off rather than tolerated.

### 4. Windows spawn would fail — portability, severity MEDIUM

`npx` and `uvx` are batch shims on Windows and are not directly executable by `spawn`. Added
`shell: process.platform === 'win32'`. Untested on Windows — I have no Windows machine — so
this is a fix I believe in but cannot verify. Recorded as unverified rather than claimed.

### 5. Entire dashboard and menu bar UI in Korean — adoption, severity HIGH

363 Korean strings in the web dashboard and 30 in the Swift app. A visitor who stars the repo,
runs `npm run dashboard`, and cannot read the screen is a lost user, and the repo reads as
not intended for them. All of it is now English: dashboard, `index.html`, the Swift popover,
detail window, and settings.

The Swift tests caught this correctly — seven assertions failed because they asserted the
Korean strings. That is the test suite doing its job.

## Things I checked that were already fine

- `src/` and `public/` contain no hardcoded macOS paths; platform assumptions are confined
  to the menu bar app, where they belong.
- Shebang and executable bit on `src/cli.js` are correct for `npx`.
- Corrupt JSON in every config file is tolerated; no crash, no stack trace.
- The scanner's coverage stayed at 99.9% lines through all of this.

## Known gaps I am not fixing, with reasons

**`cli.js` coverage is 68.5%.** The uncovered regions are `run()` branches and the
`require.main` block. Testing them properly means spawning the CLI for each command, which
the suite already does once. Worth doing, not worth doing badly in a rush.

**`mcp-cost.js` coverage is 77%.** The uncovered part is the HTTP transport — I would need a
local HTTP MCP server fixture to exercise it. The stdio path, which is what almost everyone
uses, is covered end to end.

**MCP measurement passes the full parent environment** to each spawned server. This is what
every MCP client does, because servers need `PATH` and `HOME`, but it does mean every variable
in the calling shell reaches every server. Narrowing it would break `npx` and `uvx`. Documented
rather than silently accepted.

**Windows is unverified.** Fixed in principle, never run.

**No `CONTRIBUTING.md`, no issue templates.** The research says answering issues within 24
hours is the strongest correlate of fast growth; templates make that cheaper. Not done.

**No release tags.** CodexBar's one reproducible behaviour is 100 releases in 312 days. There
is no release yet because there is no publish yet.

## The blocker that remains, and it is mine only in part

**Nothing is published.** `npx ctxmeter` does not work for anyone on earth right now. The
README's headline command is a promise the repository cannot keep until `npm publish` runs,
and that needs the owner's npm credentials.

Same for the repo itself: I can `git init` and commit, but I cannot create a GitHub repository
or push, because I have no GitHub write credentials for a new remote in this environment.

## Capabilities I lack that would have changed the outcome

Listed because the owner asked, and because each one left a real hole:

**No screen recorder.** The research names a GIF as a required README element. I hand-wrote an
animated SVG instead. It works and is smaller, but it cannot show the dashboard or the menu bar
popover in motion, which is where the product actually looks good. A 10-second screen recording
of clicking through the menu bar tabs would likely outperform everything else in the README.

**No browser automation.** Every visual claim about the dashboard and the menu bar app in this
entire project is unverified. I have asserted the rendering model and the HTTP layer, never a
pixel. A headless browser would let me assert layout, catch overflow, and produce screenshots.

**No Accessibility permission.** `osascript` cannot query `System Events`, so I could never
confirm the menu bar item exists, let alone that the popover opens. I verified the process runs
and spawns the CLI; appearance has been checked only by the owner looking at it.

**No Windows or Linux machine.** Cross-platform claims are reasoned, not tested. CI covers
Linux for Node, which helps, but the menu bar app and the MCP spawner's Windows path are untested.

**No GitHub write access for a new remote, and no npm token.** The two steps that turn this
from a local directory into something a stranger can use are both outside my reach.

**No way to measure a real tokenizer.** Everything static is bytes ÷ 4. Anthropic and OpenAI
tokenizers would give exact figures; shipping a tokenizer dependency would contradict the
zero-dependency design. This is the honest ceiling on the static numbers and it is stated
everywhere they appear.

## What I would build next, in order

1. **Publish.** Nothing else matters while the headline command does not work.
2. **`ctxmeter fix`** — the audit says what is expensive; the obvious next step is offering to
   disable the specific plugin group or MCP server it just named. That converts a diagnostic
   into a tool, and it is the difference between "interesting" and "installed permanently".
3. **Watch mode with a diff.** "Your startup cost went from 12k to 34k after that plugin
   install" is a stronger message than any absolute number, and it needs only the snapshot
   history that already exists in `.ctxmeter/snapshots/`.
4. **A tokenizer opt-in.** `--exact` that uses a real tokenizer when one is installed, keeping
   the default dependency-free.
5. **Issue templates and CONTRIBUTING**, because the 24-hour response discipline is the
   cheapest growth lever left and it needs scaffolding to sustain.
