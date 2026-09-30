# Wing it — "Inspired by my cookbooks"

**Status:** Idea / not started. Written 2026-07-27. Work on it later.

## One-liner

An opt-in toggle on **Wing it** that lets the invented dinner pitches be
*stylistically inspired by* the cookbook recipes you love — borrowing their
technique, flavor logic, and plating instinct, never reproducing the recipe
itself — while still obeying Wing it's hard rule: cookable tonight from what's
already on hand.

## Why it fits the existing design

Wing it (`app/api/invent/route.ts`) today feeds the model four inputs:
`on_hand`, `staples`, an optional `cuisine` steer, and `max_active_min`. It
**deliberately does not see the saved library** — that was an intentional split:
invent = "make me something new," Pantry = "what I've already saved."

This feature slots in as a **fifth, opt-in input**: a few loved cookbook recipes
passed in as *inspiration seeds*. It does **not** surface saved recipes — it
borrows their sensibility — so it respects the original architectural split
rather than fighting it.

The plumbing already exists:
- Recipes carry `source_type = 'images'` + `source_name` and a **1024-dim
  Voyage embedding** with a `match_recipes` cosine-similarity RPC
  (`supabase/migrations/001_init.sql`). "Find the loved cookbook recipes most
  relevant to tonight's on-hand" is already a runnable query.
- The [cookbook capture plan](COOKBOOK_CAPTURE_PLAN.md) is about getting
  photographed cookbook pages into the library cleanly — the raw material this
  feature draws on. The two plans compound.

## The core constraint: inspiration = approach, NOT ingredients

Wing it's hardest rule is "cookable tonight, nothing you don't already have." A
cookbook recipe almost always needs ingredients you lack. So the seed must teach
the model a **technique / flavor pattern / plating instinct** — "a bright
herb-and-acid finish," "low-and-slow braise then reduce," "toast whole spices
first" — and the on-hand constraint still wins every time.

If the seed is passed as a thing to reproduce, pitches will fail the "no
shopping" promise and the feature feels broken. The prompt must state the seed
is **stylistic only** and the on-hand rule is non-negotiable.

This framing is also the right call on **copyright**: not regenerating someone's
copyrighted recipe, but learning a style from recipes the user personally owns
and applying it to their own pantry. Keep raw cookbook text out of the *output*;
use it only to steer.

## Open decisions

1. **Which recipes seed it?**
   - A lightweight ❤️ "loved" flag on cookbook recipes — matches "recipes I
     loved," most intentional.
   - Pure semantic match over everything cookbook-sourced — zero extra UI, but
     "loved" gets diluted by anything captured.
   - **Recommended: both** — filter to ❤️'d cookbook recipes, then
     semantic-rank *those* against tonight's `on_hand` so the 2–3 seeds are the
     most relevant loved ones, not random.

2. **The toggle.** Plain on/off next to the cuisine steer for v1. Skip an
   intensity slider ("lightly ↔ strongly inspired") — nice later, not now.

3. **Show the borrow.** Per-pitch attribution — "in the spirit of your
   *Ottolenghi* shelf" — is a delight/trust signal and keeps the
   inspired-not-copied contract visible.

## Recommended v1 scope

❤️ flag + on/off toggle + inject the top 2–3 semantically-matched loved recipes
into `INVENT_PITCHES_SYSTEM` as **explicitly stylistic** seeds, with the on-hand
rule restated as non-negotiable. Small, well-contained, leans on infrastructure
already built; gives Wing it a personality that's *yours* instead of a generic
model's.
