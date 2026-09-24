# Decision 01 — Reposition from dashboard to audit

Date 2026-09-24. Status: decided, partially executed.

## The problem with the current positioning

Today the README opens with:

> Local, read-only observability for Claude Code, Codex, and Kiro configuration.

That sentence fails every test in `research/02-viral-mechanics.md`. It names a category
("observability"), not a pain. It is the "This is a library for…" opener the 10K-repo
analysis says loses the reader. And the seven 0-star status line repos in
`research/03-competition-and-timing.md` prove that *displaying* context numbers earns nothing.

## What the evidence demands

The pain, quoted from the sources, is two-part:

1. "I lost 40% of my window before typing anything and I don't know which server did it."
2. "Tell me what to turn off."

Part 1 is measurement. Part 2 is a recommendation. We do part 1 well and part 2 not at all.

The viral pattern is "X but without Y". Here:

> See exactly what is eating your agent's context — and what to delete — without sending
> anything to a server.

## The decision

Lead with a **one-command audit that prints a verdict and a recommendation**, not with a
dashboard. The dashboard and menu bar stay, but they become the second and third things a
visitor sees, not the first.

Concretely: `npx <name>` with no arguments runs the audit and prints something a developer
would screenshot. That screenshot is the distribution mechanism — it is the only asset
available to a project with no pre-existing audience (see the arithmetic in
`research/02-viral-mechanics.md`).

## Why this is the right shape and not just marketing

A number alone is not shareable. "You are using 18.8% of your window" provokes nothing.
"Your setup burns 12,762 tokens before you type — 2,275 of them from six steering files
you symlinked and forgot" provokes a reaction, because it is specific, surprising, and
actionable.

We are already in position to produce that sentence: the scanner knows the per-group,
per-file byte cost and the session telemetry knows the observed total. What is missing is
the framing layer that turns the inventory into a ranked list of removable cost.

## What this decision does not license

It does not license inventing numbers to make the output dramatic. The project's whole
credibility rests on `용량 미확인` / `미측정` discipline. The audit must rank what it can
measure and state plainly what it cannot — notably MCP, per `03-mcp-measurement.md`.

An audit that overstates is worse than no audit: the first reply on Hacker News will be
someone checking the arithmetic.
