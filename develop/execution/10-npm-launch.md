# 10. npm launch (v0.1.1)

2026-09-29. Reverses the "npm later" line in `decisions/07`: the owner asked for the npm front door now.

## Prepared

- `package.json` 0.1.1: description no longer says "read-only" (`fix` and the switches write), more keywords, `publishConfig.access: public`, `prepublishOnly: node --test`. `menubar/Info.plist` bumped with it (the version test enforces it).
- `scripts/verify-package.sh`: packs, installs the tarball into a throwaway prefix, and runs the installed bin (`--version`, `--help`, `audit`, `details`, `fix --json` on an empty home); fails on any shipped file outside `src/`, `config/`, READMEs, LICENSE, `docs/demo.gif`, `package.json`. Runs in CI and in the publish workflow. Result locally: ok, 116 KB, 17 files.
- It was first wired into `prepublishOnly` as well; under `npm publish --dry-run` the nested `npm pack` inherits the dry-run flag and produces no tarball (exit 254). Dropped from the hook rather than worked around; CI already runs it.
- `.github/workflows/publish.yml`: on `v*` tags, Node 24 (npm ≥ 11.5.1 for OIDC), tag == version check, tests, package check, skip if the version is already on npm, then `npm publish` via trusted publishing — no npm token stored anywhere, provenance attached automatically.
- READMEs (en/ko): `npx ctxmeter` everywhere, `npm i -g ctxmeter` mentioned, npm version badge.
- `npm publish --dry-run`: passes; only warning is "requires you to be logged in".

## Why the first publish is manual

npm cannot configure a trusted publisher for a package that does not exist yet (npm/cli#8544). So 0.1.1 is published once from this machine after `npm login`; the trusted publisher is then configured, and later tags publish from CI. When `v0.1.1` is tagged, the workflow finds 0.1.1 already on npm and skips.
