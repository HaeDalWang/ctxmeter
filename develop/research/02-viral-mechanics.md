# Viral mechanics — what actually moves GitHub stars

Researched 2026-09-24. Numbers are from the sources named, not from intuition.

## Hacker News is an ignition source, not a destination

[arXiv 2511.04453](https://arxiv.org/html/2511.04453) measured HN exposure → star growth:

| Horizon | Average stars gained |
|---|---|
| 24h | 121 |
| 48h | 189 |
| 1 week | 289 |

HN score is the strongest single predictor. **One HN front page is worth ~289 stars.**
A 10K target therefore cannot be reached by launching once. It needs either a
repeatable engine or an unusually shareable artifact.

Counter-intuitive finding from the same paper: the `Show HN` tag itself was associated
with **119 fewer** stars at 48h (β = −119.2, SE = 138.3, p = 0.39 — not significant, so
treat as "no benefit proven" rather than "harmful").

## Show HN submission mechanics

From [WannaLaunch's Show HN dataset](https://wannalaunch.com/blog/show-hn-what-the-data-says)
and [a 1,200-launch analysis](https://dev.to/howiprompt/decoding-the-show-hn-algorithm-what-1200-launches-taught-me-about-viral-dev-growth-11cd):

- **Open source has a 13.9% virality rate on Show HN — roughly 3× that of an AI project.**
  Lead with "open source, local, no account", not with "AI".
- Title length 60–80 characters outperforms shorter and longer.
- Heavy capitalisation (>20–25% uppercase) performs significantly worse across every
  year and topic; readers read it as marketing.
- Spacing submissions ≥6 months apart correlates with better performance. Launching
  from a dedicated project URL or repo beats a personal domain with prior Show HN history.

## The 0 → 10K pattern set

From [an analysis of 50 repos that reached 10K](https://dev.to/0012303/i-analyzed-50-github-repos-that-went-from-0-to-10k-stars-here-are-the-7-patterns-54o1):

1. **The README is the product.** It sells in under 7 seconds. Required order:
   one-line description → GIF/screenshot proving it works → install command → 3 use cases.
   "This is a library for…" loses the reader immediately.
2. **Solve a pain, not a feature.** The formula is "X but without Y" where Y is the thing
   developers hate. `htmx` removed the need for a JS framework. `uv` made Python packaging
   fast. `zoxide` made `cd` instant. None added features.
3. **Launch day multiplier.** 87% of repos that hit 10K launched on HN first, then
   cross-posted. Tue–Thu, 08:00–10:00 EST. A personal story ("I was frustrated with X so
   I built Y") gets ~3× the upvotes of a technical description.
4. **5-minute onboarding.** 95% of successful repos can be tried in under 5 minutes,
   typically one install command and one run command.
5. **Awesome lists.** Being listed can drive 50–200 stars/month on autopilot, because
   awesome lists dominate page 1 for "best X tools github".
6. **Documentation paradox** — more docs is not better; findable docs are.
7. **Community before code.** Repos with the fastest growth answer every issue within 24h.

Additional, from [a 33K-star case study](https://dev.to/iris1031/github-star-growth-10-proven-tactics-that-got-us-33k-stars-1h6):

- 60–100 stars/day can rank in **language-specific** Trending, which has far less
  competition than All Languages.
- Contributors compound: ~300 active contributors produced hundreds of organic stars
  per month by word of mouth.
- AFFiNE's 60K over 3 years ≈ 55 stars/day sustained, via repeatable launches — not one spike.

## Translation to an arithmetic target

10,000 stars is not one event. Plausible decompositions:

- 55–70 stars/day sustained for ~6 months (the AFFiNE / CodexBar shape), or
- ~30 successful HN-scale launches at 289 each (not realistic for one project), or
- one genuinely shareable artifact that spreads peer-to-peer, plus a steady engine.

The third is the only route available to a project without an existing audience, and it
dictates the product decision in `decisions/02-positioning.md`.
