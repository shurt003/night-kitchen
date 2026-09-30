# Cookbook-page capture — plan (NOT yet implemented)

Goal: make photographing a physical cookbook page (e.g. from *The Food Lab* or
*Salt, Fat, Acid, Heat*, which the user owns) produce an accurate recipe in the
library. The capture plumbing already works; this is about extraction **quality**
for print pages. Personal use only — user photographs their own copy; we do not
transcribe book text ourselves.

## Current state (as investigated 2026-07-25)

- `/add` "Photos" mode: up to `MAX_IMAGES = 3` images (`image/*`), all sent in one
  vision call. Copy already says "a cookbook page or two."
- Client downscales to **1600px max edge, JPEG 0.85** (`app/add/page.tsx` `fileToJpegBase64`).
- Extraction: `lib/extract.ts` image branch → `askJson({ model: MODELS.fast /* claude-haiku-4-5 */, system: EXTRACT_FROM_IMAGES_SYSTEM })`, cached by content hash.
- Prompt: `lib/prompts/extract.ts` `EXTRACT_FROM_IMAGES_SYSTEM`.
- Hero/thumb for photo captures = the user's **first** photo (`heroImage = publicUrl(imagePaths[0])`).

## Gaps, ranked

1. **Prompt is written for scrolling screenshots, not book pages (highest leverage).**
   `EXTRACT_FROM_IMAGES_SYSTEM` says the images are "sequential scrolling screenshots …
   they overlap. Deduplicate repeated lines." For book photos this is wrong: photos are
   usually *distinct, non-overlapping* pages/columns (continuations), print is multi-column,
   with headnotes, "Variations" sidebars, and a serves/time block. The overlap/dedup
   instruction can merge or drop real content, and there's no print-layout guidance.
2. **Model tier vs dense print.** Haiku on small, dense type with fractions (¾, ⅛) is more
   error-prone than on clean web screenshots. `MODELS.smart` (claude-sonnet-5) exists and
   would cut quantity misreads. Quantity accuracy is the whole game for a recipe you cook.
3. **Resolution ceiling.** 1600px / q0.85 is fine for screenshots, borderline for a dense
   full page, poor for a two-page spread in one shot.
4. **Hero/thumbnail.** First photo becomes the library thumbnail → a photo of a text page
   shows text, not the dish. No way to pick the dish photo as hero.
5. **Narrative methods (Salt Fat Acid Heat).** Prose method + "Variations" don't map to
   numbered `steps`; prompt gives no steer.
6. **Attribution.** Nothing sets `source_name` to the book ("The Food Lab").

## Proposed changes

### A. Rework the image prompt (do first)

Make one prompt handle BOTH scrolling screenshots and photographed print pages. Replace
`EXTRACT_FROM_IMAGES_SYSTEM` with something like:

```
These images are ONE recipe, captured as photos or screenshots, in order. They are either:
- overlapping scrolling screenshots of a web/app page — deduplicate repeated lines; or
- photos of a printed/cookbook page or spread — each photo is usually a DIFFERENT page or
  column, so do NOT assume they overlap; treat them as continuations and read in order.

Reconstruct ONE complete recipe from all of them.

Reading printed/cookbook pages:
- Print is often multi-column (ingredients in one block, method in another). Read in natural
  reading order; don't interleave columns.
- A headnote (author's intro prose) is not a step. Lift anything genuinely useful from it
  (serving suggestion, make-ahead, why a technique) into "description"; keep "steps" to the
  actual method.
- "Variations"/"Notes"/"For X do Y" sidebars: if they change the dish, record them in "gaps";
  don't silently fold them into the main steps.
- Some method is written as prose paragraphs. Break it into discrete, ordered steps yourself,
  preserving technique cues (heat, look/feel, timing).
- Read quantities and fractions carefully (¾, ⅛). If a number is unreadable or ambiguous, say
  so in "gaps" rather than guessing.
- If the page shows a book/section title in a running header/footer, set "source_name" to the
  book (e.g. "The Food Lab", "Salt, Fat, Acid, Heat").
- If content clearly continues beyond the photos, note it in "gaps" instead of inventing it.
```
(+ the existing `OUTPUT_CONTRACT`.)

### B. Bump the image path to the smart model

`lib/extract.ts` image branch: `model: MODELS.fast` → `MODELS.smart`. Or two-tier:
try fast, escalate to smart when `confidence` is low or quantities look suspect. Cost is
negligible for the handful of treasured recipes this is for.

### C. Follow-ups (nice to have)

- Raise photo `maxEdge` from 1600 → ~2000–2200 (or detect photo vs screenshot) for legibility.
- Let the user mark which photo is the hero (or auto-prefer a photo that looks like a dish).
- Consider `MAX_IMAGES` 3 → 5 for long multi-page recipes.

## Open questions

1. Dedicated "cookbook" capture toggle vs. one auto-handling prompt? (Lean: auto — one prompt.)
2. OK to run photo extraction on the pricier Sonnet model? (Lean: yes, for accuracy.)

## Touch-points

- `lib/prompts/extract.ts` — `EXTRACT_FROM_IMAGES_SYSTEM`
- `lib/extract.ts` — image branch model + (optional) escalation
- `app/add/page.tsx` — `MAX_IMAGES`, `fileToJpegBase64` maxEdge
