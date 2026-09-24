# 04 — Should the menu bar app become CodexBar-shaped?

The operator runs CodexBar (21,863 stars) alongside ctxmeter and proposed moving in
its direction: more information in the menu bar, and Settings as a real management
surface. Asked for a judgment. This splits into two halves with opposite answers.

## Half 1 — more in the menu bar: no

Three arguments against.

**It is the one thing already measured.** Three percentages side by side took 24
characters and 168pt. One icon plus one number takes 3 characters and 147pt. Icons
replacing letter codes bought only 12%. The menu bar is the scarcest surface on the
machine and this operator already gives CodexBar two slots of it.

**It would duplicate an incumbent.** CodexBar owns quota and spend across ~15
providers. Showing quota in ctxmeter makes it a worse CodexBar. Showing three
context percentages spends triple the width on information that is only actionable
one harness at a time.

**Context share is a glance metric.** It matters when it is high. 19% does not need
three numbers; it needs to be legible in one.

## The real problem behind the request

The operator could not tell which menu bar item was ctxmeter. Both ctxmeter and
CodexBar were showing a percentage next to a vendor icon, and the numbers were
close enough to be indistinguishable. Confirmed: the two items read `19%` and `96%`
with similar glyphs, and identifying ctxmeter required querying the accessibility
tree.

That is a discoverability failure, and it argues for a *distinguishing mark*, not
more data. A persistent meter glyph alongside the agent icon fixes the actual
complaint at a fraction of the width three numbers would cost.

## Half 2 — Settings as management: yes, and it is the bigger opportunity

Reframed: not settings, **action**.

Today the tool says `MCP tool schemas 16,948 · largest obsidian at 8,526`. Then the
user opens `~/.codex/config.toml`, works out the syntax, and comments out a server
by hand. The measurement is finished and the fix is entirely manual. That gap is the
product.

```
obsidian costs 8,526 tokens across 12 tools. Disable it? [y/N]
user-skills: 3,268 tokens across 18 skills, 12 unreferenced in 30 days. Move them out? [y/N]
```

Back up first, act, print the exact rollback command. That is a different product
from CodexBar: CodexBar reports how much quota is left, ctxmeter would say what to
delete and then delete it. Nothing measured in the research does that.

The Details and Settings windows then become the GUI for that capability — which is
the operator's instinct, aimed at configuration instead of quota.

## Positioning, which decides it

Earlier research found seven existing "claude code context" repos at 0–5 stars each,
and established that competing on a saturated framing fails. Competing with a
21,863-star incumbent on its own axis, from zero, is the worst available position.

- CodexBar owns: how much quota and money am I using, across providers.
- ctxmeter can own: what is my configuration costing me, and what should I remove.

Complementary, not competing. The proof is that the operator runs both. Going
CodexBar-shaped means beating CodexBar at its own game with 1/1000th the audience.
Staying on the configuration-cost axis means being the only tool there.

## Order of work

1. Make the menu bar item identifiable — fixes the real complaint, small.
2. `ctxmeter fix` — the move from view to action. This is the leap.
3. Details and Settings as the GUI for (2), once the CLI logic exists and is tested.
4. Not doing: quota, spend, multi-provider expansion, more numbers in the bar.

## On dropping the web dashboard

The operator suspects it is unnecessary. Partly agreed.

Evidence it is not load-bearing: its front-end was completely dead for an entire
session — a syntax error meant the page rendered no data at all — and nobody
noticed. That is a strong signal about how much it is used.

Against deleting it now: it is the only place per-file cost is browsable, the code
is already written and tested, and removing it costs work while removing a
capability.

Decision: keep it, stop treating it as a headline. It is already demoted below the
menu bar section in the README. Revisit once `fix` ships and the Details window
grows — at that point it is genuinely redundant and can go. Three surfaces dilutes
a pitch whose hook is "one command"; that is a reason to consolidate later, not to
delete today.
