# Design note — "Night Kitchen"

*Written before the UI, per spec §7.*

## The idea

The subject is a real kitchen: heat, repetition, mess, and handwriting in the margins of a
stained cookbook. Not a food blog, not a magazine spread. Two images drive the identity:

1. **The ticket rail.** Line cooks run on tickets — terse, monospaced-feeling, high-contrast
   slips that exist to be *acted on* and then spiked. The grocery list and metadata chips
   borrow this language: dense, functional, satisfying to clear.
2. **Marginalia.** The most valuable text in any used cookbook is the handwriting in the
   margins — "halve the sugar", "needs acid". Your notes are rendered in an actual
   handwriting face on a highlighter-yellow field, visually distinct from all recipe text.
   They should look like *your* layer on top of the recipe, because they are.

## The risk

**User notes are set in handwriting (Caveat) on a yolk-yellow highlight, slightly rotated.**
This is the one deliberate break from app-typography orthodoxy. The justification: notes are
the emotional core of the "Remember" job, and they must never read as app chrome or AI text.
Handwriting makes the ownership unmistakable at a glance. Everything else in the app stays
disciplined so this one gesture carries.

## Type

- **Display:** Bricolage Grotesque — characterful, a bit lumpy, used with restraint (titles,
  section heads, big numbers).
- **Body/UI:** Instrument Sans — clean, neutral, warm enough not to feel like a dashboard.
- **Marginalia:** Caveat — user notes only. Never for app copy.

## Palette (6 named values)

| Name  | Value     | Role |
|-------|-----------|------|
| Tile  | `#F2F1EC` | Background — cool kitchen-tile off-white (deliberately not cream) |
| Char  | `#191512` | Ink — burnt near-black |
| Smoke | `#8B857C` | Secondary text, borders |
| Flame | `#E8430F` | The accent. Heat. Actions, timers, active states |
| Yolk  | `#FFC53D` | Highlight — want-to-try markers, note fields, carry-over |
| Herb  | `#42794F` | Checked, done, success |

Dark surfaces (cook mode, night use) invert to Char background with Tile ink — the "night
kitchen" — same accents.

## Spatial system

4px base grid. Cards on a 12/16/24 rhythm. One radius token (14px) for cards, a tighter one
(8px) for chips/inputs. Mobile-first; every primary action reachable one-handed in the
bottom half of the screen.

## Motion principles (how §7 is implemented)

- **Springs only** (Motion's spring physics; no duration-eased "fade in on scroll" decoration).
  Default spring: `{ stiffness: 420, damping: 34 }` for UI, softer `{ 300, 30 }` for layout morphs.
- **The signature moment:** a captured recipe appears instantly as a skeleton card (source
  favicon + soft pulse), then *materializes in stages* as extraction completes — image
  resolves, title slides in, metadata chips stagger, card settles with a small overshoot.
  Implemented as a state machine on the card, not a spinner swap.
- **Shared element** grid→detail: card image + title carry `layoutId`s and morph into the
  detail view (detail renders as an in-tree overlay so Motion can animate the same elements;
  URL is kept in sync so deep links work).
- **Grocery list:** checked items strike through and *demote* with a spring into a settled
  section; merges visibly slide the duplicate into the survivor and roll the quantity up;
  archiving compresses the list and files it away, carried-over items lifting out first.
- **Servings scaler:** odometer-style rolling digits.
- **Everything interruptible:** animations driven by state + springs, so a new tap retargets
  from the current position. No queued sequences.
- **Reduced motion:** transforms swap to opacity, durations kept, layout never breaks.
- **60fps floor:** transform + opacity only; list reordering uses Motion layout animations
  (FLIP under the hood — still transforms).
