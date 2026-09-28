# 08 — The menu bar becomes the management surface

Scope and rules: `decisions/06-details-replaces-dashboard.md`. The owner compared
the app with CodexBar and found it static: numbers in a table, no trend, no
composition, and no way to act.

## What shipped

CLI (TDD throughout; Node tests 140 → 151 after removing 35 dashboard tests,
coverage 95.2% → 96.4%, `cli.js` 77% → 86%):

- `ctxmeter history` (`src/session-history.js`): per-turn context for the current
  session and the 5 largest sessions of the last 7 days, per harness. 0.4 s here.
- `ctxmeter details` (`src/details.js`): composition of the observed input and
  every startup item with its switch. 3 s here, because it runs the full scan.
- `ctxmeter fix --json | --enable | --disable` (`src/switches.js`): every switch in
  both states; `--apply` stays as an alias for `--disable`.
- Claude plugins are switchable through `enabledPlugins` in
  `~/.claude/settings.json` (`setJsonPluginEnabled`, refuses a plugin not listed).
- `setTomlSectionKey` no longer treats a line inside a multi-line array or string
  as a section header. That was improvement #3 from 06, and it mattered more now
  that switching is two-way and one click away.

Menu bar (Swift tests 26 → 37):

- Popover: a per-turn chart under each agent in the overview; on an agent tab, a
  larger chart with hover values and compaction marks, and the largest sessions.
- Details: segmented agent picker, composition bar (instructions, skills, MCP,
  messages, autocompact reserve, free), ranked item list with switches. Every
  switch opens a confirmation stating the saving or that it is unmeasured, the
  backup, and which agent to restart. A restart banner and the undo command follow.
- The web dashboard, its server, its front end, and its screenshots are removed.

## Behaviour changes worth knowing

- `fix` offers only servers that are still configured. A cache entry for a server
  removed from the config used to be offered; now it is not (test added).
- `fix` now includes Claude plugins, so on this machine the dry run reads
  20,747 tokens behind 12 switches (was 18,287 / 9). README updated.
- Charts scale to the session's peak, not the window. Scaled to 1m, a 19% Claude
  session was a row of 2-pixel bars; the caption states the peak's share instead.
- A plugin with no skills reads "no skills; any other plugin content is not
  measured" rather than "0 skills", which would imply it is free. context7 and
  github plugins here ship MCP servers that are not measured — a known gap.

## Verification

- Views rendered offscreen with `ImageRenderer` against live data in a throwaway
  package under `/tmp` (deleted). Buttons, toggles, and the picker render as
  placeholders there, so the switch controls and the dialog were never seen.
- Switch round trip checked through the CLI the app calls: `verify-fix-sandbox.sh`
  passed; a Claude plugin disabled, re-enabled byte-identical, and a second enable
  refused with exit 1 — on a stand-in `settings.json` holding only `enabledPlugins`.
- Live configs untouched: no `*.ctxmeter-*.bak` beside any of them.

## Launch and visibility — resolved

Two separate faults, both confirmed on this Mac (macOS 26).

1. The app quit ~2 s after every launch. When Control Center refused the status
   item, SwiftUI's `MenuBarExtra` scene closed, and AppKit treated that as the
   last window closing. Fix: `MenuBarExtra(isInserted:)` plus an app delegate
   returning `false` from `applicationShouldTerminateAfterLastWindowClosed`.
   Same failure as akring.com "A strange bug caused by SwiftUI + macOS 26".
2. The icon stayed hidden even with the app alive and the System Settings
   toggle on. Control Center's private allow-list (`trackedApplications` in
   `group.com.apple.controlcenter.plist`) had our own entry at
   `isAllowed=False`, and the entry for the Orca terminal (disabled, and the
   process that ran `open`) listed `local.ctxmeter.bar` in its
   `menuItemLocations`. A trivial status-item app under this bundle id was
   hidden the same way, and under a fresh id was not, so the state is keyed on
   the bundle id, not the code. Same as steipete/CodexBar#1440 and #1945.
   Rebooting does not clear it; the GUI toggle did not either.
   Fix: `scripts/menubar-allowlist.py --repair` (backs up, sets our entry
   allowed, drops our id from other entries, restarts cfprefsd and Control
   Center). Needs Full Disk Access. After it, the icon showed (user screenshot,
   19:48).

Rejected: notch overflow (screenshot showed free space and a test item drew
there); moving off `MenuBarExtra` (a minimal `MenuBarExtra` app drew fine under
another id, so it is not the cause of the hiding).

Recurrence risk: launching from a disabled terminal can re-attribute the item.
Orca is now allowed in Menu Bar, so a new claim inherits `true`.

Popover (Overview, Claude tab with session chart, compaction marker, and largest
sessions) and the Details window (composition bar, startup items with switches)
seen live on 2026-09-28 (user screenshots). Still owed: one real switch through
the confirmation dialog.
