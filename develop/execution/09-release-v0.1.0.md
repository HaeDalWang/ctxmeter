# 09. Quickstart, update notice, v0.1.0

2026-09-28. Decision: `develop/decisions/07-release-and-update-notice.md`.

## Done

- README quickstart for colleagues: `npx github:HaeDalWang/ctxmeter` for the CLI; clone + `ctxmeter-bar.sh install`, launch from Finder, enable in Menu Bar settings, and the macOS 26 allow-list repair for the menu bar app. The command table and `docs/reference.md` no longer say `npx ctxmeter` (404 on npm).
- Menu bar screenshots (Overview, Claude session, Details) added to README, cropped from the user's live screenshots. No menu bar GIF: it needs a screen recording of clicks, and the stills show the same thing.
- `UpdateCheck` in `CtxmeterBarCore` (TDD, 10 tests written first and seen failing to compile): numeric version compare (`0.10.0 > 0.9.0`, `1.0 == 1.0.0`), drafts/prereleases skipped, non-version tags ignored, malformed JSON throws, foreign links replaced by the releases page, 24 h interval with a backwards-clock guard.
- App: `UpdateBanner` above the popover footer; `checkForUpdates` setting (default on); check at launch and daily, retried after an hour on failure.
- `test/version.test.js`: Info.plist version equals package.json; with `RELEASE_TAG` set (CI on tag push) the tag must equal `v<version>`. Seen failing with `RELEASE_TAG=v9.9.9`, passing with `v0.1.0`.
- CI now also runs on `v*` tags.

## Verified

- `node --test`: 152 pass, 1 skipped (the tag check outside a tag push).
- `swift test`: 47 pass. `swift build -c release`: clean.
- Before the release, `releases/latest` returned 404, so the app correctly showed nothing.

- Tag `v0.1.0` pushed; tag CI green, and its log shows the tag check ran (`ok 153 - a release tag matches the version it ships`, 0 skipped).
- Release published: https://github.com/HaeDalWang/ctxmeter/releases/tag/v0.1.0. `releases/latest` now returns it (not draft, not prerelease).
- The real payload through `UpdateCheck.available`: installed `0.0.9` → notice for `0.1.0` with the release URL; installed `0.1.0` → nothing (temporary test, removed).

## Not verified

- The banner drawn in the popover. It only appears when a newer release exists; it will first be seen live when `v0.1.1` or later is published.
