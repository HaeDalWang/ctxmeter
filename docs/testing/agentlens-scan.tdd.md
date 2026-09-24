# AgentLens scan TDD evidence

Source plan: user journey derived in this session.

## User journey

As a multi-harness AI-agent user, I want a local read-only scan of Claude Code, Codex, and Kiro configuration so that I can see which assets are active candidates and estimate their baseline context cost without exposing prompt or secret contents.

## RED and GREEN evidence

| Stage | Command | Result |
|---|---|---|
| RED: scanner | `npm test` | Failed because `../src/scanner` did not exist. |
| GREEN: scanner | `npm test` | 5 scanner tests passed after `src/scanner.js` was added. |
| RED: CLI | `npm test` | Failed because `src/cli.js` did not exist. |
| GREEN: final | `npm test` | 6 tests passed. |
| Coverage | `npm run test:coverage` | Lines 96.26%, branches 82.69%, functions 89.58%. |
| RED: asset inventory | `npm test` | Failed because skill groups did not expose an `assets` collection. |
| GREEN: asset inventory | `npm test` | 8 tests passed after asset-level records were added. |
| Coverage: asset inventory | `npm run test:coverage` | Lines 96.59%, branches 81.90%, functions 90.38%. |

## Test specification

| # | Guarantee | Test | Type | Result |
|---|---|---|---|---|
| 1 | Active candidates, cache, backup, marketplace source, and staging paths are classified separately. | `classifies active assets separately...` | Unit | PASS |
| 2 | Only skill YAML frontmatter contributes to metadata baseline estimates. | `measures only frontmatter...` | Unit | PASS |
| 3 | Enabled Claude plugin caches are included while backup and marketplace source skills remain excluded. | `discovers enabled Claude plugins...` | Integration | PASS |
| 4 | Kiro Crew skills are reported separately from normal Kiro skills. | `keeps Kiro Crew assets separate...` | Integration | PASS |
| 5 | Missing plugin caches and malformed optional JSON do not stop a scan. | `reports missing plugin caches...` | Integration | PASS |
| 6 | The CLI writes a JSON snapshot and does not persist fixture prompt content. | `CLI writes a metadata-only JSON snapshot...` | CLI integration | PASS |
| 7 | Each skill inventory entry contains identity, size, timestamp, and SHA-256 but not body text. | `includes an asset-level skill inventory...` | Unit | PASS |
| 8 | CLI parsing rejects unknown and incomplete arguments. | `CLI argument parsing accepts...` | Unit | PASS |

## Known gaps

The scan is static discovery. It does not yet measure per-turn context, actual skill-body loads, vendor-managed system prompts, tool-schema loads, or compaction events. All token figures are documented byte-based estimates.

The workspace is not a Git repository, so no TDD checkpoint commits were created.

## Dashboard follow-up

User journey: open local snapshots in a browser, filter the inventory, and inspect an individual asset without starting a background service by default.

| Stage | Command | Result |
|---|---|---|
| RED | `npm test` | Failed because `src/dashboard-server.js` did not exist. |
| GREEN | `npm test` | 9 tests passed, including dashboard API and traversal protection. |
| Coverage | `npm run test:coverage` | Lines 95.72%, branches 81.12%, functions 90.00%. |
| HTTP smoke | `curl -fsS http://127.0.0.1:4318/api/snapshots` | Returned local snapshots; `/` contained `AgentLens`. |

Visual regression: inconclusive. Browser automation was not exposed in this session, so no screenshot baseline was created.

## Context visualization follow-up

User journey: identify the largest known session-start cost within 30 seconds, keep large groups such as ECC collapsed, and distinguish static estimates from runtime values that require telemetry.

| Stage | Command | Result |
|---|---|---|
| RED | `npm test` | Failed because `public/dashboard-model.js` did not exist. |
| GREEN | `npm test` | 12 tests passed after context overview and risk modeling were added. |
| Coverage | `npm run test:coverage` | Lines 95.01%, branches 83.24%, functions 89.71%. |

The UI now renders risk cards, relative meters, stacked known/unknown context bars, and collapsed `<details>` inventory groups. Runtime usage remains explicitly unknown until telemetry is connected.

## Model-aware context budget follow-up

User journey: select a locally available model and see predicted first-session consumption, available working space, autocompact reserve, and a `/context`-level category breakdown on the first screen.

| Stage | Command | Result |
|---|---|---|
| RED: model budget | `npm test` | Failed because the context profile fixture and budget builder did not exist. |
| GREEN: model budget | `npm test` | 16 tests passed after model discovery, context profiles, calibration math, static fallback, and the profile API were added. |
| Coverage | `npm run test:coverage` | Lines 95.22%, branches 79.46%, functions 90.48%. |
| HTTP smoke | temporary port `4329` | Dashboard, profile API, latest snapshot, four discovered Claude models, and selected-model metadata returned successfully. |

The captured Opus 5 `/context` sample produces a 71,273-token first-session baseline and retains the 111,000-token observed-session headline. Cross-model projections are marked as proxies, model catalog descriptions are excluded from snapshots, and unknown capacities remain null rather than being guessed.

Visual regression remains inconclusive because browser automation is not installed in this environment.

## Codex session telemetry follow-up

User journey: switch from Claude Code to Codex and see model-specific first-session and current-session context consumption without persisting conversation content.

| Stage | Command | Result |
|---|---|---|
| RED | `npm test` | Two new tests failed because Codex model/session telemetry and Codex context-budget calculation did not exist. |
| GREEN | `npm test` | 20 tests passed after numeric JSONL telemetry, local model limits, privacy filtering, sparse-data handling, and context calculation were added. |
| Coverage | `npm run test:coverage` | Lines 96.20%, branches 82.67%, functions 90.43%. |
| HTTP smoke | temporary port `4329` | Agent tabs and assets returned 200; selected `gpt-5.6-sol` produced 19,134 first-input tokens and 140,214 latest-input tokens against a 258,400 effective window. |

The parser retains only whitelisted numeric usage, model, effort, timestamps, and the local source path. Fixture prompts, model descriptions, and compaction text are proven absent from the snapshot. Thread cumulative usage is supplemental and is not treated as current context occupancy.

Visual browser QA is inconclusive: no browser automation command or MCP is installed, so interaction and responsive screenshots were not available. HTTP and pure rendering-model paths were verified instead.

## Codex live refresh follow-up

User journey: keep the visible Codex panel current without rerunning the scan, while consuming no polling resources on Claude/Kiro panels or a hidden browser tab.

| Stage | Command | Result |
|---|---|---|
| RED | `npm test` | Runtime API, cached reader, immutable merge, and visibility gate tests failed because the behaviors did not exist. |
| GREEN | `npm test` | 23 tests passed after demand-driven polling and server-side throttling were added. |
| Coverage | `npm run test:coverage` | Lines 96.07%, branches 81.77%, functions 90.91%. |
| HTTP smoke | temporary port `4329` | `/`, `/app.js`, `/styles.css`, and `/api/runtime/codex` returned 200. The live endpoint read 178,608 input tokens without a new snapshot. |
| Cache smoke | two immediate runtime requests | First parse took 55ms; the cached second response took 1ms and retained the same observation timestamp. |

Polling runs every ten seconds only when both conditions are true: the selected harness is Codex and `document.visibilityState` is `visible`. The server reader has a five-second minimum refresh interval. Visual and responsive browser QA remains INCONCLUSIVE because no browser automation capability is installed.

## Stale Claude calibration and snapshot refresh fix

User journey: after removing a large plugin and scanning again, the newest Claude dashboard must show the changed inventory without presenting an older `/context` observation as current; an open page should discover the new snapshot automatically.

| Stage | Command | Result |
|---|---|---|
| RED | `npm test` | Three new tests failed: changed inventory still returned `observed-baseline`, missing calibration provenance was trusted, and the snapshot-selection helper did not exist. |
| GREEN | `npm test` | 26 tests passed after inventory provenance, stale-calibration fallback, historical observation state, and newest-snapshot selection were added. |
| Related RED/GREEN | `npm test` | Codex discovered context capacity was overwritten by `null`; a new test failed, then all 27 tests passed after profile merge was fixed. |
| Coverage | `npm run test:coverage` | Lines 96.27%, branches 83.05%, functions 91.43%. |
| Real snapshots | `node` model check | Pre-removal scan: 365 scanner-visible Claude skills and 71,273-token observed baseline. Post-removal scan: 73 skills, 8,481 skill-metadata tokens, 12,762-token known minimum, and no exact free-space claim. |
| HTTP smoke | temporary port `4329` | `/`, `/app.js`, `/styles.css`, context profiles, and snapshot list returned 200; latest snapshot used stale-calibration state. |

The visible snapshot list is checked every ten seconds. It auto-selects a newly created scan only when the viewer was already following the newest scan; historical selections remain pinned. Browser screenshot/interaction QA remains INCONCLUSIVE because no browser automation tool is available in this environment.


## Kiro session telemetry follow-up

User journey: select the Kiro tab and see the observed context occupancy for the scanned workspace, without AgentLens inventing token numbers Kiro does not record.

Pre-implementation investigation established the constraint that shaped the design:

| Source | Absolute tokens | Real signal |
|---|---|---|
| `sessions/cli/*.json` — 90 sessions, 235 turns | `input_token_count`, `output_token_count`, `cache_read_input_token_count` all `0` in 235/235 turns | `context_usage_percentage` in 223/235 turns, `model_info.context_window_tokens` |
| `sessions/<workspace>/sess_*/messages.jsonl` | absent | `session_metadata[contextUsage].usagePercentage` time series, `usage_summary` credits |
| `crew/usage/tokens/*.jsonl` — 158 records | `input`/`output` sum to `0` | `credits` (469.27 total) |

Because no local source exposes absolute tokens, the percentage is reported as observed and no token figure is derived from it. Deriving `percentage × context_window` was rejected: Kiro's denominator is not verifiable locally, and a guessed total would contradict the project's `용량 미확인` / `미측정` convention.

| Stage | Command | Result |
|---|---|---|
| RED | `npm test` | 6 new tests failed: Kiro session telemetry, newest-store preference, sparse fallback, Crew usage, Kiro context budget, and Kiro model tabs did not exist. |
| GREEN | `npm test` | 40 tests passed after `kiroSessionTelemetry`, `kiroCrewUsage`, `scanKiro(home, workspace)`, and the `buildKiroContextBudget` branch were added. |
| Coverage | `npm run test:coverage` | Lines 97.32%, branches 81.07%, functions 95.33%. |
| Real scan | `node src/cli.js scan` | The live IDE session for this workspace returned 42 percentage samples, 4.57% first, 17.52% latest, 15.84 credits, store `ide`. Crew returned 469.27 credits across 158 records and 2026-08-24 ~ 2026-09-21. |
| Privacy | snapshot string assertions | Snapshot contains no `.history` path, no `content` key, and no session title. Fixture assertions prove prompt text, other-workspace percentages, and history files stay out. |
| HTTP smoke | temporary port `4331` | `/`, `/app.js`, `/dashboard-model.js`, `/styles.css`, `/api/snapshots`, `/api/context-profiles` returned 200; the served snapshot exposed `store: ide`, `17.52%`, and Crew credits. |

The Kiro budget sets `usedTokens` and `freeTokens` to `null`, renders the context map from the observed percentage (which needs no denominator), and keeps steering/skill byte estimates in `breakdownTokens` labeled as file estimates rather than as a breakdown of the observed percentage. Crew appears in its own collapsed block marked `워크스페이스 귀속 불가`.

Known gaps: Kiro has no live-refresh endpoint, so its panel updates only on rescan. `buildConfigurationCosts` has no Kiro rows. Browser screenshot QA remains INCONCLUSIVE — no browser automation is installed, so `contextCells` and the Crew block were verified through the pure rendering model and HTTP responses instead.


## Symlinked asset discovery fix

Enabling the Kiro panel exposed a pre-existing accuracy bug: `walkFiles` skipped every symbolic link, so the dashboard reported Kiro as 2 skills and 0 steering files. The real figures were 13 and 6. Direct evidence that the harness loads these assets: the session that found the bug had `eli5`, `github-ops`, `katalk`, `verification-loop`, `saltware-sow`, `helm-k8s-compat`, and `k8s-upgrade-skills` active, and all seven are symlinks.

| Stage | Command | Result |
|---|---|---|
| Backup | `cp -R src public test config docs …` | Taken before the shared-function change; the project has no Git repository, so a copy is the only rollback path. |
| Baseline | `node -e` count dump | Every harness group count recorded to compare afterwards. |
| RED | `npm test` | Three tests failed: symlinked file/directory discovery, duplicate-link dedup, and symlinked Claude rule costs. |
| GREEN | `npm test` | 43 tests passed after `walkFiles` followed links with realpath cycle detection and broken-link guarding. |
| Regression caught | `/usr/bin/time -p` ×3 | Scan went 2.85s → 6.09s (2.1×). Cause: an added `statSync` on **every** directory entry, discarding the free type information from `readdirSync({ withFileTypes: true })`. |
| Partial fix | `/usr/bin/time -p` ×3 | 4.38s after restricting `statSync` to symlink entries only. Still 1.5× baseline. |
| Root cause | `/usr/bin/time -p` ×3 | Remaining cost was `realpathSync` per directory, which resolves every path component — expensive across the 23,183 staging entries under `~/.codex/.tmp`. |
| Final | `npm test` + timing ×3 | 2.84s, matching the 2.85s baseline. Cycle and duplicate tracking now begins only after a symlink is followed, because neither can occur without one. |
| Count diff | before/after dump | Exactly 5 keys changed, all Kiro: `skillGroups.user-skills` 2 → 13, `metadataTokens` 229 → 1795, `steering` 0 → 6 files / 9,098 bytes / 2,275 tokens. 32 keys unchanged, including every Claude and Codex count. |

The first probe predicted Claude skills would move 18 → 19, and the scanner reported no change. The nineteenth file is `~/.claude/skills/aws-customer-account-ops/.backup/SKILL.md`, classified `backup` and therefore excluded from active candidates. It sits on a real path, not behind a symlink, so it was already counted in `excluded.backup` before the fix. The same pattern accounts for Kiro's 14 discovered files against 13 active. Both discrepancies are explained; neither is a behavior change.

## Kiro hook count and peer-session context window

| Stage | Command | Result |
|---|---|---|
| RED | `npm test` | Two tests failed: Kiro v2 hook counting and context-window reuse. |
| GREEN | `npm test` | 45 tests passed. |
| Coverage | `npm run test:coverage` | Lines 97.43%, branches 81.42%, functions 95.48%. |
| Real scan | `node src/cli.js scan` | Kiro known baseline moved 229 → 4,070 tokens. The window resolved to 1,000,000 via `peer-session`, so the dashboard now shows `23.90% / 1m tokens` instead of `용량 미확인`. |
| HTTP smoke | temporary port `4332` | `/`, `/app.js`, `/dashboard-model.js`, `/styles.css`, `/api/snapshots`, `/api/runtime/claude`, `/api/runtime/codex` returned 200. |

`hookCount` was previously never computed for Kiro, so the field was structurally absent rather than zero. It now sums `hooks[]` across `~/.kiro/hooks/*.json` and the workspace's `.kiro/hooks/*.json`. **This path is fixture-verified only.** Neither directory exists on the machine used here, so the real-data result is 0 and the non-zero branch has no live confirmation. Hook commands and agent prompts are counted but never copied, which the fixture asserts.

Known gaps unchanged: no Kiro live-refresh endpoint, no Kiro rows in `buildConfigurationCosts`, and browser QA still INCONCLUSIVE with no automation installed.


## Kiro runtime reader and telemetry command

User journey: an external status display, such as a macOS menu bar app, needs current usage for all three harnesses on a short timer without paying for an inventory scan.

| Stage | Command | Result |
|---|---|---|
| RED | `npm test` | Five tests failed: Kiro runtime reader caching, the Kiro runtime endpoint, percentage unification, null handling, and the `telemetry` CLI command. |
| GREEN | `npm test` | 51 tests passed. |
| Coverage | `npm run test:coverage` | Lines 97.25%, branches 81.75%, functions 95.18%. |
| Reader cost | in-process benchmark ×5 | Claude 24.7ms, Codex 42.0ms, Kiro 68.5ms. Full `scanEnvironment` is 2.8–5.0s, so the cheap path is roughly two orders of magnitude faster. |
| Command cost | `/usr/bin/time -p` ×3 | `node src/cli.js telemetry` completes in 0.21s including Node startup. |
| HTTP smoke | temporary port `4333` | `/api/runtime/claude`, `/api/runtime/codex`, `/api/runtime/kiro` returned 200 and `/api/runtime/bogus` returned 404. The Kiro endpoint reported 31.00% across 127 samples from the `ide` store. |

`scanKiroRuntime` and `createKiroRuntimeReader` mirror the existing Claude and Codex readers, including the five-second minimum refresh interval. The three per-harness endpoint handlers in `dashboard-server.js` collapsed into one table-driven branch, which also makes an unknown harness return 404 instead of falling through to static file serving.

At a 30-second poll interval the cheap path costs about 0.45% of one core, against roughly 17% for a full scan. That difference is the reason the two paths are separate.

### Percentage unification is incomplete for Claude

The `telemetry` command reports `usagePercent` for every harness that has both a usage figure and a known capacity. Kiro supplies the percentage directly; Claude and Codex derive it from observed input tokens divided by the context window.

Claude currently resolves to `null`. The locally selected model is `claude-opus-5-5`, `config/context-profiles.json` carries profiles for only `claude-opus-5`, `claude-sonnet-5`, and `claude-haiku-4-5-20251001`, and Claude's local model catalog exposes no capacity field — only `id`, `name`, and `shortName`. Seven of the ten locally offered models have no profile.

The capacity for `claude-opus-5-5` could not be confirmed against Anthropic's own documentation with the tools available here; the docs pages render client-side and returned no table. A third-party post claims a 1M-token window, which does not meet the sourcing standard this project set for capacities. The value therefore stays `null` rather than being guessed, consistent with the documented `용량 미확인` behavior. Any consumer must treat Claude's percentage as unavailable until a profile is added from an authoritative source.


## macOS menu bar app

User journey: keep context occupancy visible in the menu bar, refresh on a timer or on demand, and open a larger window for detail.

Toolchain probes came first, because full Xcode is absent and that could have invalidated the whole approach:

| Probe | Result |
|---|---|
| SwiftUI + AppKit under SwiftPM with Command Line Tools only | Compiles and links. |
| `import XCTest` | **Unavailable.** No such module without Xcode. |
| `import Testing` from the toolchain | **Unavailable.** |
| `apple/swift-testing` as an SPM dependency | Works. Testing Library 0.99.0, tests run and report. |
| `node` location | `/opt/homebrew/bin/node`, and `launchctl getenv PATH` is empty — a GUI app cannot rely on `env node`. |

| Stage | Command | Result |
|---|---|---|
| RED | `swift test` | Failed to compile: `no such module 'AgentLensBarCore'`. |
| GREEN | `swift test` | 10 core tests passed: decoding with null capacities, malformed payload handling, display order, menu bar label composition and fallback, token compaction, percentage text, refresh clamping, node lookup precedence, relative age. |
| Build | `swift build -c release` | Build complete. One macOS 15 API (`.rotate` symbol effect) was replaced with a `ProgressView` to hold the macOS 14 floor. |
| Bundle | `make bundle` | Assembles `AgentLensBar.app` with `LSUIElement`, a rewritten `AGLDefaultWorkspace`, and `src/`, `config/`, `package.json` staged into `Contents/Resources/agentlens`. |
| Embedded CLI | ran the staged `cli.js` directly | Returned Claude 188,381 tokens with a null percentage, Codex 27.01%, Kiro 34.44%. |
| Launch | `open AgentLensBar.app` | Process runs, no Dock icon, no crash report. |
| End to end | sampled child processes at a 5s interval | Caught `/opt/homebrew/bin/node <bundle>/Resources/agentlens/src/cli.js telemetry --workspace <repo>`, confirming the app drives the bundled CLI. |
| No interference | `npm test` | 51 tests still pass in 0.87s; the Swift directory does not affect Node test discovery. |

The scanner stays in Node. The Swift layer only spawns, decodes, and formats, which keeps one source of truth and limits what needs Swift tests. `AgentLensBarCore` holds that logic and `AgentLensBar` holds the views, mirroring how CodexBar separates its core from its app.

### Not verified

The menu bar item, popover layout, detail window, and settings panel were **not** confirmed programmatically. `osascript` requires Accessibility permission that is not granted in this environment, so `System Events` queries fail with `-1719`. Launch, `LSUIElement` behavior, crash absence, and the CLI invocation are confirmed; appearance and interaction need a human check.

Claude's percentage remains unavailable for the reason recorded in the previous section: `claude-opus-5-5` has no capacity profile and the local catalog exposes none. The menu bar label therefore shows only the harnesses that have one, currently `CX` and `KI`.


## Native vendor icons, harness tabs, and the missing Claude profile

| Stage | Command | Result |
|---|---|---|
| Icon sourcing probe | extracted icons via `NSWorkspace.icon(forFile:)` and reviewed the PNGs | Claude returned the orange asterisk, ChatGPT the OpenAI mark, Kiro the purple ghost. All three are the correct brand marks. |
| RED: Claude profile | `npm test` | Failed: no `claude-opus-5-5` profile, so `usagePercent` stayed null. |
| GREEN: Claude profile | `npm test` | 52 tests passed; real telemetry now reports Claude 18.84%, Codex 27.01%, Kiro 37.13%. |
| RED: presentation | `swift test` | Failed to compile: `cannot find 'PopoverTab' in scope`. |
| GREEN: presentation | `swift test` | 17 tests passed, adding tab ordering, storage-key round trip, per-tab menu bar text, vendor app lookup order, `~/Applications` precedence, and symbol fallback coverage. |
| Build | `swift build -c release` | Build complete after renaming a `tint(for:)` helper that shadowed SwiftUI's `View.tint`. |
| Icon resolution | ran the resolver against the real filesystem | claude → `/Applications/Claude.app`, codex → `/Applications/ChatGPT.app`, kiro → `/Applications/Kiro.app`. |
| Relaunch | `make bundle && open` | Runs, no crash report. |
| No regression | `npm test`, `swift test` | 52 and 17 tests pass. |

Icons come from the vendor apps installed on the machine rather than bundled artwork, which avoids shipping trademarked assets and keeps the icons identical to what Finder shows. `.icns` files are not parsed directly because Claude and ChatGPT both ship theirs as `electron.icns`; `NSWorkspace` resolves the real icon regardless of naming.

The selected tab drives the menu bar content, so a harness tab shows its own icon and percentage while the overview shows every harness that has one.

### Claude capacity provenance

`claude-opus-5-5` was released 2026-09-22 and is not in any local source: Claude's model catalog exposes no capacity field, and Kiro's CLI sessions recorded `model_info` only for `auto`, `claude-sonnet-5`, and `claude-opus-5`. Anthropic's docs tables render client-side and could not be read by this tooling. The 1M value therefore rests on the operator's confirmation, recorded in a `capacityProvenance` field next to `capacitySource` so the weaker sourcing is visible rather than implied to match the other profiles.

### Still not verified

Appearance and interaction remain unconfirmed programmatically: `osascript` needs Accessibility permission that is not granted here, so the menu bar item, tab bar, popover, detail window, and settings panel all need a human look.


## Menu bar label width

The overview tab rendered `CC 19% · CX 27% · KI 40%` in the menu bar, 24 characters, which crowded out the other status items.

Replacing the two-letter codes with vendor icons was measured first and rejected: three icons plus three numbers came to roughly 147pt against 168pt, about 12%, which does not solve the problem. Cutting to one number is what actually recovers the width.

| Stage | Command | Result |
|---|---|---|
| RED | `swift test` | Failed to compile: `type 'Format' has no member 'menuBarFocus'`. |
| GREEN | `swift test` | 21 tests passed, adding overview collapse, focus following the highest harness, tie-breaking by display order, focus on a harness tab regardless of data, and the all-unknown case. |
| Build | `swift build -c release` | Build complete. |
| Measured | computed from live telemetry | `CC 19% · CX 27% · KI 40%` (24 chars) became `40%` (3 chars plus one icon), an 88% reduction in characters. |
| Relaunch | `make bundle && open` | Runs, no crash report. |

On a harness tab the bar shows that harness. On overview it shows whichever harness is closest to its limit, so the icon identifies it and the number stays meaningful; the overview list marks that row with a `상단바` pill so the link is visible rather than mysterious. The full summary moves to the hover tooltip and the accessibility label, so no information is lost.

The tradeoff accepted here: the overview icon changes when a different harness takes the lead. That is intentional — it surfaces whichever one is worth attention — but it does mean the bar icon is not a fixed landmark.
