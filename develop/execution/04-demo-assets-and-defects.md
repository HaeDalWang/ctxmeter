# 04 — Demo assets, and the four defects they exposed

Session goal: the operator installed VHS and Playwright, unblocking the two items
previously marked unverifiable — a real terminal recording, and a visual check of
the dashboard. Producing those assets surfaced four defects, all now fixed.

## Outcome

| Artifact | Result |
|---|---|
| `docs/demo.gif` | 1000×612, 188 frames, 82 KB — real recording of `ctxmeter` |
| `docs/img/dashboard.png` | 1440×900 viewport hero, 281 KB |
| `docs/img/dashboard-full.png` | full-page capture, 755 KB |
| `scripts/build-demo.sh` | reproducible GIF build |
| `scripts/capture-dashboard.js` | screenshot + assertions, exits non-zero on a broken page |

Tests 66 → 83. Coverage 92.87% overall; `cli.js` 68.5% → 75.6%.

## Defect 1 — the dashboard front-end did not run at all (CRITICAL)

`public/app.js:217` contained `'...this workspace's JSONL...'`: an unescaped
apostrophe inside a single-quoted string. The whole file failed to parse, so the
page rendered its static HTML shell and nothing else. Body text was 465 chars of
headings with zero data.

Introduced by the Korean → English translation pass in the previous session.

**Why 81 passing tests missed it.** Unit tests import `public/dashboard-model.js`,
never `public/app.js`. The 23 KB browser bundle had no syntax gate of any kind. A
test suite at 96% coverage was reporting green on a product whose primary UI was
dead on arrival.

Fixed the string, then closed the hole: `test/shipped-sources.test.js` runs
`node --check` over every `.js` file in `src/` and `public/`. Verified RED against
the live defect before fixing.

This is the strongest argument in the project so far for the rule that a
verification step must be proven to fail. Coverage percentage measured the tested
files and said nothing about the untested one.

## Defect 2 — `--help` and `--version` did not exist

`ctxmeter --help` printed `error: Unknown option: --help` and exited 1. So did
`-h`, `help`, `--version`, and `-v`. A `usage()` function existed but was reachable
only by supplying an invalid command, and it went to stderr with a failure code.

For a tool whose entire distribution strategy is `npx ctxmeter`, the first thing a
curious user types is `--help`. Fixed with all six spellings; help short-circuits
argument parsing so a user who also typed a bad flag still gets instructions
rather than an error about the flag.

Unknown commands now say `Unknown command: nonsense` followed by usage, instead of
printing bare usage with no indication of what was wrong.

## Defect 3 — the dashboard was unreachable for installed users

It existed only as `npm run dashboard`, which requires a cloned repo. An `npx
ctxmeter` user had no path to it. Added a `dashboard` subcommand.

Extracting the bootstrap into `startDashboard()` exposed a second problem in the
same code: `publicDirectory` and `contextProfilesFile` were resolved against
`process.cwd()`. Run from any directory other than the repo root — which is every
npm install — the server would have served 404 for its own HTML, CSS, and JS. Now
resolved against `__dirname`.

Verified by launching from `/tmp` and fetching each asset: all 200, and `..`
traversal still 404.

## Defect 4 — `1 assets`

Four sites concatenated a count with a hardcoded plural noun. Added a `plural()`
helper and an assertion in the capture script that fails on
`1 (assets|items|skills|hooks)`, so the screenshot run catches a regression.

## Two dead ends worth recording

**VHS 0.12.0 cannot write a video.** It exits 0 and prints `Creating demo.gif...`
while producing no file. Upstream: charmbracelet/vhs#787, reproduced on Linux,
macOS, and Windows. `Evaluate` cancels the recording context during teardown and
then passes that same canceled context to `Render`, so Go's `exec.CommandContext`
refuses to start ffmpeg; `Render` logs empty output and returns nil.

Chose the frames workaround over a v0.11.0 downgrade: frame capture is unaffected,
so the tape emits PNGs and `build-demo.sh` runs ffmpeg. This touches no Homebrew
state and gives control over encode settings. A downgrade would have been a
global, less reversible change for the same result.

Second trap inside that workaround: VHS silently writes no frames if the output
directory already exists. The build script must delete it and let VHS create it.

**Three invalid diagnostics.** Recording them because each nearly produced a wrong
conclusion:

1. `node src/cli.js 2>&1 >/dev/null | cat` appeared to prove the report was on
   stderr. zsh MULTIOS tees output to multiple destinations, so the test was
   meaningless. Redirecting each stream to its own file showed stdout 1292 bytes,
   stderr 0.
2. `rm -f *.gif && vhs ...` — zsh `NOMATCH` aborted the `rm`, so `&&`
   short-circuited and VHS never ran. The absence of a ttyd process was read as
   evidence about VHS when nothing had been launched.
3. An ffmpeg wrapper on `PATH` was never called, which looked like VHS using an
   absolute path. It was never called because VHS never reached the encode step.

## Decisions

**Playwright is not a dependency.** ctxmeter ships zero dependencies and that is
part of its pitch. Playwright plus browsers is hundreds of megabytes. It stays a
maintainer-only tool, resolved from wherever the maintainer installed it;
`capture-dashboard.js` fails with an install hint if absent. CI does not run it.

Side effect to note: installing it added `playwright` to `~/package.json`, which
already carried an unrelated `shadcn` entry and a populated `~/node_modules`. That
file was not created by this work and was left in place.

**The recorded command is real.** `.vhs-bin/ctxmeter` is a symlink to
`src/cli.js`, which is exactly what npm's `bin` entry installs. The GIF is not a
staged prompt with fabricated output.

**A status line, because the demo exposed a real flaw.** `audit` spends ~2.9s
walking the filesystem and printed nothing during it. On a 9s GIF that is a third
of the runtime showing a blank screen, and in real use it reads as a hung process.
`src/status-line.js` writes one rewritable line to stderr, gated on `isTTY` so
pipes and CI stay byte-for-byte clean. Confirmed both ways: visible in GIF frame
45, and stderr measured at 0 bytes when redirected to a file.

**`docs/demo.svg` deleted.** The hand-written SVG was a stand-in for a recording
that could not be made. Keeping both invites drift.

## Reproduce

```bash
./scripts/build-demo.sh                      # needs vhs, ttyd, ffmpeg
node scripts/capture-dashboard.js            # needs playwright resolvable
```

## Still unverified

- Windows `mcp-scan` — no Windows machine.
- The menu bar app's rendered appearance. `swift test` covers 21 formatting and
  locator cases; no screenshot exists, because capturing it needs Accessibility
  permission to foreground a window.
- Whether npmjs.com resolves the relative `docs/img/` README paths against the
  repo. GitHub, the primary target, does. The PNGs are deliberately excluded from
  the tarball to keep it at 115 KB.
