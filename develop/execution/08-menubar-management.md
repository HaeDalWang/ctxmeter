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

## Not verified — blocked

Every build of the app exits about two seconds after launch with `auxiliary scene
activation failed … scene invalidated`, including a clean build of the previous
commit and the copy installed in `/Applications` at 09:39. So this is the
environment, not this change (confirmed by the previous commit failing the same
way). Unknown cause. Candidates, not checked: the app disallowed under System
Settings → Menu Bar, or Control Center holding a stale scene after `make bundle`
deleted a running bundle. A live look at the popover, Details, and one real
switch is still owed.
