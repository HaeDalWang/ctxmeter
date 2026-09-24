# Plan — 10,000 GitHub stars, measured against the market of 2026-09-24

Written 2026-09-24. The owner's constraint is explicit: the target is today's market, and
AI tooling decays fast. Every date below is therefore relative to this week, and the plan
is ordered so that the perishable work happens first.

## Honest assessment before anything else

10,000 stars is a top-0.1% outcome. Most repositories never reach 1,000. Two facts make it
conceivable here, and one makes it hard.

**Conceivable:** the pain is enormous and documented (`research/01-pain-validation.md`), and
the direct category is unoccupied (`research/03-competition-and-timing.md`).

**Hard:** the closest comparable, CodexBar at 21.9K in ten months, was built by someone with
a large pre-existing audience. Velocity attributable to the idea alone is unknown and lower.
This project starts with no audience, so it needs the artifact itself to travel.

The arithmetic (`research/02-viral-mechanics.md`): one Hacker News front page is worth about
289 stars in a week. 10K is not one launch. It is roughly 55–70 stars/day sustained for six
months, which is the AFFiNE and CodexBar shape. That requires a repeatable engine, not a spike.

I am not going to promise the number. I can commit to removing every blocker I found and
building the one asset that could plausibly travel.

## Why now, and what closes the window

Favourable now: MCP proliferation is recent, complaint volume is peaking, Anthropic has
shipped `/context` but not per-server attribution (claude-code#21966 and #50133 remain open).

The window closes if Anthropic ships a full breakdown, if lazy-loading becomes the default
and shrinks the pain, or if CodexBar adds context composition. The defence against all three
is the same: **cross-harness** attribution is the durable asset. A tool that only explains
Claude's numbers has a lifespan measured in weeks.

## Phase 0 — Blockers. Nothing else matters until these are done.

These are not growth tactics. They are the reasons a visitor cannot currently use the project.

| # | Blocker | Why fatal | Status |
|---|---|---|---|
| 0.1 | No Git repository | Cannot be published, cloned, starred, or forked | done |
| 0.2 | No LICENSE | Companies cannot touch it; "open source" is the 13.9%-virality trait and needs a licence to be true | done |
| 0.3 | No install path — `git clone` only | Violates the 5-minute onboarding pattern that 95% of successful repos satisfy | done |
| 0.4 | README opens with a category, not a pain | Fails the 7-second test | done |
| 0.5 | Korean-only user-facing output | The star-granting audience is global | partially — CLI audit is English; dashboard remains Korean |
| 0.6 | Name collides with 3 direct competitors | Forfeits search and awesome-list discovery | **recommended, owner's call** (`decisions/02-naming.md`) |

## Phase 1 — The shareable artifact

Per `decisions/01-positioning.md`, the product's front door becomes a one-command audit that
prints a verdict and a ranked list of removable cost. The screenshot of that output is the
distribution mechanism.

Requirements it must satisfy:

- Runs with no install step and no configuration.
- Produces a specific, surprising, actionable sentence within seconds.
- States plainly what it cannot measure. An audit that overstates dies on first inspection.

Status: implemented this session as `agentlens audit`. See `execution/01-session-log.md`.

## Phase 2 — The credibility gap

`decisions/03-mcp-measurement.md`. MCP tool schemas are the dominant cost in every source and
we do not measure them. Until that is closed, the honest headline is incomplete, and the first
serious reviewer will say so.

This is designed but deliberately not implemented: it requires launching configured server
processes, which contradicts the project's read-only promise. That tradeoff is the owner's to
accept. It is the highest-value remaining item.

## Phase 3 — The engine, not the spike

Ordered by evidence strength from `research/02-viral-mechanics.md`:

1. **Ship visibly.** CodexBar's one reproducible behaviour is 100 releases in 312 days.
   Tagged releases with changelogs are the cheapest sustained signal available.
2. **Awesome lists.** 50–200 stars/month on autopilot. Targets: awesome-claude-code,
   awesome-ai-agents, awesome-mcp, awesome-macos. Each is a one-line PR against a quality bar
   that Phase 0 now meets.
3. **Answer every issue within 24h.** The strongest correlate of fast growth in the 50-repo study.
4. **Language-specific Trending.** 60–100 stars/day ranks in JavaScript or Swift Trending,
   which is far less contested than All Languages.
5. **One launch, done properly.** Tue–Thu 08:00–10:00 EST. Title 60–80 characters, minimal
   capitalisation, lead with "open source, local, no account" rather than "AI". A personal
   story outperforms a feature list by ~3×. Launches should be ≥6 months apart, so this is
   effectively a single shot — it must come *after* the rename and after Phase 2.

## Sequencing, and the one ordering error to avoid

```
Phase 0 blockers ──► rename (owner) ──► Phase 2 MCP (owner) ──► launch ──► Phase 3 engine
```

Do not launch before the rename. The research shows one effective first impression per
project; renaming afterwards discards inbound links and awesome-list entries.

Do not launch before Phase 2 either, if the owner intends to accept it. "It does not measure
the thing that costs me 100k tokens" is a fair top comment and there is no second launch.

## What I will not claim

That following this produces 10,000 stars. The plan removes every blocker I could find,
builds the asset most likely to travel, and sequences the launch correctly. Distribution
outcomes depend on timing and luck that no plan controls, and the single largest variable in
the closest comparable was the author's existing audience — which is not a lever available here.
