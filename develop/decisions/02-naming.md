# Decision 02 — Rename is required, but the choice belongs to the owner

Date 2026-09-24. Status: **recommended, NOT executed. Needs the owner's call.**

## Finding

`agentlens` is unusable as a growth name. Eight GitHub repos carry the name, three of
them in our exact positioning (local observability for coding agents), and `npm i agentlens`
is taken. Full table in `research/03-competition-and-timing.md`.

Discoverability is a primary growth channel in the research — awesome lists and search both
require a unique findable name. Sharing a name with three direct competitors forfeits it.

## Recommendation

Rename. Only two candidates are clean on both npm and GitHub exact-name:

| Candidate | npm | Exact repos | Fit |
|---|---|---|---|
| `ctxmeter` | free | 1 | short, pronounceable, works for CLI + menu bar + dashboard; "meter" implies continuous |
| `ctxaudit` | free | 1 | states the action, matches the audit repositioning; drier, longer to say |

My preference is `ctxmeter`, with `ctxmeter audit` as the headline subcommand — it covers
the continuous surfaces (menu bar, dashboard) and the one-shot surface in one word.

## Why I did not execute it

A rename touches `package.json`, the README, user-facing strings, the Swift bundle
identifier, the app name, the `AGENTLENS_PORT` env var, the `.agentlens/` snapshot
directory, and every document in this repo. It is also an identity decision with branding
consequences that outlast any technical argument.

The working agreement for this project is to surface tradeoffs rather than pick silently on
significant choices, and to keep changes surgical. A unilateral rebrand violates both. The
evidence is recorded here so the decision can be made quickly; the mechanical work is
perhaps an hour once the name is chosen.

## Sequencing note

Rename **before** any public launch, never after. The research shows launches should be
spaced ≥6 months apart to perform well, so there is effectively one first impression. A
repo that renames post-launch loses its inbound links and its awesome-list entries.

## Interim handling

Everything executed in this session is name-neutral where possible. Where a name was
unavoidable (the `bin` entry, the audit output header) the existing `agentlens` string is
used so that a rename is a single find-and-replace rather than a redesign.
