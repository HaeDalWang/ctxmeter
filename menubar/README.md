# CtxmeterBar

macOS menu bar front end for ctxmeter. Shows current context occupancy per harness, refreshes on a timer or on demand, and opens a detail window.

## Build and run

Full Xcode is not required; the Swift command line tools are enough.

```bash
make test      # swift test, 37 core tests
make bundle    # assembles .build/release/CtxmeterBar.app
make run       # bundle, then launch
make install   # copy to /Applications
```

SwiftPM cannot emit a `.app`, so the `Makefile` assembles the bundle: it copies the executable, rewrites `Info.plist`, and stages `src/`, `config/`, and `package.json` from the repository root into `Contents/Resources/ctxmeter`.

To switch the running app on and off from a terminal:

```bash
scripts/ctxmeter-bar.sh on | off | toggle | restart | status | install
```

`on` prefers `/Applications/CtxmeterBar.app` and falls back to the local build. `install` rebuilds, replaces the copy in `/Applications`, and restarts the app if it was running.

## How it gets data

The app runs the bundled CLI and decodes its JSON. The scanner stays in Node because it is already covered by the JavaScript test suite; duplicating it in Swift would create two sources of truth. Only decoding, formatting, chart scaling, prompts, and the node lookup live here, and those are what the Swift tests cover.

| Command | When | Cost on this machine |
|---|---|---|
| `telemetry` | every refresh interval (30 s default) | ~0.2 s |
| `history` | with a refresh, at most once a minute, and when the popover opens | ~0.4 s |
| `details` | when Details opens, on rescan, and after a switch | ~3 s (full scan) |
| `fix --enable/--disable <target> --json` | after the user confirms a switch | one file edit plus backup |

## Charts and switches

The popover charts context per turn for the current session, scaled to that session's peak so the shape stays readable at 19% of a 1m window; the caption states the peak's share of the window. A red tick marks a compaction. Each agent tab lists the largest sessions of the last 7 days.

Details shows what the window is made of and every item that loads at startup, ranked by cost. Items with a native off flag get a switch. Flipping one opens a confirmation that states the saving (or that the cost is unmeasured), that a backup is kept, and which agent to restart; only then does the CLI write. Claude MCP servers show `/mcp` instead of a switch, because their flag lives in `~/.claude.json`, which Claude rewrites while it runs.

`node` must be installed. A menu bar app inherits a minimal `PATH`, so `/usr/bin/env node` cannot be relied on. `NodeLocator` checks `/opt/homebrew/bin/node`, `/usr/local/bin/node`, and `/usr/bin/node` in that order, and Settings accepts an explicit override.

## Icons

Each harness icon is read from the vendor app installed on this Mac with `NSWorkspace.icon(forFile:)`:

| Harness | Source app |
|---|---|
| Claude | `/Applications/Claude.app` |
| Codex | `/Applications/ChatGPT.app` — Codex ships no app of its own, so the vendor's stands in |
| Kiro | `/Applications/Kiro.app`, then `/Applications/Kiro CLI.app` |

`~/Applications` is checked after `/Applications`. No brand artwork is bundled, so there is nothing to keep in sync and no trademarked asset in the repository. A harness whose app is missing falls back to an SF Symbol.

`.icns` files are not parsed directly: vendors name them inconsistently, and both Claude and ChatGPT ship theirs as `electron.icns`.

## Tabs

The popover opens with an overview tab listing all three harnesses, followed by one tab per harness showing its detail grid and the measurement limit that applies to it. The selected tab is persisted and also decides what the menu bar shows, so there is a single selector rather than two competing ones.

## Menu bar label

One icon and one number, always. Three percentages side by side took 24 characters and crowded the menu bar out.

On a harness tab the bar shows that harness. On the overview tab it shows whichever harness sits closest to its limit, which is the one number worth glancing at; ties fall to display order. The overview list marks that harness with a `menu bar` pill so the connection is visible, and the full `CC 19% · CX 27% · KI 40%` summary moves to the hover tooltip and the accessibility label.

## Refresh cost

`telemetry` reads session usage only and skips the inventory scan. The three readers cost roughly 25ms, 42ms, and 69ms; a full scan costs seconds. At the default 30-second interval the app uses about 0.45% of one core. The minimum interval is 5 seconds and the maximum is 300.

## Units are not uniform

Kiro records a context percentage and no token total. Claude and Codex record the reverse, so their percentage is derived from observed input tokens divided by a known context window. A model with no capacity profile shows `capacity unknown` and is left out of the menu bar label rather than being shown as 0%.

All three currently resolve: Claude 18.8% of 1m, Codex 27.0% of 258.4k, Kiro 37.1% of 1m. Claude's `claude-opus-5-5` profile was added on the operator's confirmation of a 1M window; the capacity could not be read from Anthropic's docs by this tooling, and `capacityProvenance` in `config/context-profiles.json` records that.

## Scope

One workspace at a time, chosen in Settings and defaulting to the repository this app was built from. Details replaced the web dashboard, which was removed (`develop/decisions/06`).

## Not verified

Views were checked by rendering them offscreen with `ImageRenderer` against live data; buttons, toggles, and the segmented picker do not render that way and were not seen. The confirmation dialog and a real switch round trip through the app were not exercised by hand. On 2026-09-28 every build of the app, including the previous release, exited about two seconds after launch with `auxiliary scene activation failed … scene invalidated` from the status bar; that is an environment issue on this Mac, not a code change, and it blocked a live check.
