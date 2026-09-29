# 07. Releases and an "update available" notice

2026-09-28. Colleagues want to try it; nothing told them how, or when a new version exists.

## Decided

- **Distribution is a source build.** `git clone` + `./scripts/ctxmeter-bar.sh install`. The CLI runs as `npx github:HaeDalWang/ctxmeter` (confirmed working; the package was never on npm, so the old `npx ctxmeter` 404'd for everyone else).
- **Tags `vX.Y.Z` with a GitHub Release.** First tag `v0.1.0` (user's choice). `package.json` and `menubar/Info.plist` must carry the same version; `test/version.test.js` enforces it, and on a tag push CI also checks the tag equals it.
- **The app shows a notice, it does not update itself.** At launch and once a day it reads `releases/latest` from the GitHub API, compares tags, and shows "vX available" with *Copy* (the upgrade command) and *Release* (opens the page). On by default (user's choice), off in Settings → Updates.

## Rejected

- **Prebuilt .app / DMG.** No Developer ID here, so a downloaded ad-hoc build hits Gatekeeper ("damaged"), needs `xattr` instructions, and carries the builder's `AGLDefaultWorkspace`. A local build has none of those problems.
- **Auto-update (Sparkle etc.).** Needs signing and an appcast; out of proportion for a handful of colleagues.
- ~~**npm publish.** Irreversible and needs an account; not needed while `npx github:` works.~~ Reversed 2026-09-29 by the owner: see `execution/10-npm-launch.md`.

## Risks accepted

- This is the app's first network request. It sends nothing but the GET (IP and a `CtxmeterBar/<version>` User-Agent reach GitHub). README's "network: none" badge became "telemetry: none", and "What it never does" says so.
- The response is untrusted: drafts and prereleases are ignored, an unparseable tag means no notice, and the link opened is the release URL only if it points into this repository, otherwise the releases page.
- Unauthenticated API limit is 60/hour per IP; one request a day is far below it. A failure is silent and retried after an hour.
