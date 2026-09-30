// Prompts for recipe extraction. One file per feature; named exports.

const OUTPUT_CONTRACT = `
Respond with ONLY a JSON object (no prose, no code fences) with these fields:
{
  "title": string,
  "description": string,            // one or two lines, plainly written — no blog preamble, no marketing voice
  "ingredients": [{ "raw": string, "quantity": string|null, "unit": string|null, "item": string, "note": string|null, "section": string|null }],
  "steps": [{ "text": string, "timer_seconds": number|null }],
  "servings": number|null,
  "time_total_min": number|null,
  "time_active_min": number|null,   // hands-on time — the number that matters on a weeknight; estimate if not stated
  "tags": string[],                 // 3-8 useful tags, lowercase
  "cuisine": string|null,
  "course": "meals" | "appetizers" | "sides" | "desserts" | "drinks" | "misc",   // the meal it belongs to. meals = a main / the main event. appetizers = starters, dips, small bites. sides = served alongside a main (vegetables, grains, salads, breads). desserts = anything sweet. drinks = cocktails, smoothies, anything you drink. misc = fits none of these (sauces, snacks, condiments). Pick the single best fit.
  "season": string[],               // e.g. ["summer"] — inferred from ingredients; empty if year-round
  "occasion": string[],             // e.g. ["weeknight","dinner party","make-ahead"]
  "main_ingredients": string[],     // 3-6 core ingredients, lowercase, used for pantry matching
  "image_url": string|null,         // best hero image URL if one exists in the source, else null
  "source_name": string|null,       // e.g. "NYT Cooking", "r/Cooking", "Instagram"
  "confidence": number,             // 0-1, how confident you are the recipe is complete and correct
  "gaps": string[]                  // plain-language notes about content that is clearly missing; empty if none
}

Rules that apply to every field:
- "ingredients[].section" is for groupings like "For the sauce" — null if the recipe has no groupings.
- "steps[].timer_seconds": if a step contains a concrete duration ("simmer 20 minutes"), set it in seconds. Use the first/primary duration in the step. Null if none.
- Never invent ingredients or steps that are not in the source. If something is clearly missing, say so in "gaps" instead.
- Normalize quantities lightly ("½" → "1/2") but keep "raw" as the original line verbatim.`;

export const EXTRACT_FROM_URL_SYSTEM = `You extract recipes from web page text. Recipe blog pages are 90% life story, ads, and navigation — ignore all narrative and extract only the recipe itself. If JSON-LD Recipe schema data is present in the provided text, prefer it as the source of truth and use the page text to fill gaps and normalize.
${OUTPUT_CONTRACT}`;

export const EXTRACT_FROM_IMAGES_SYSTEM = `These images are sequential scrolling screenshots of one recipe, in order. They overlap. Deduplicate repeated lines and reconstruct one complete ingredient list and one complete set of instructions. If content is clearly missing between two screenshots, say so in "gaps" rather than inventing it.
${OUTPUT_CONTRACT}`;

export const EXTRACT_FROM_PDF_SYSTEM = `This PDF is a capture of one recipe (often an iOS "Full Page" screenshot of a web page). Ignore ads, navigation, comments, and life-story narrative — extract only the recipe.
${OUTPUT_CONTRACT}`;

export const EXTRACT_FROM_TEXT_SYSTEM = `The user pasted recipe text. Extract and normalize it. Do not invent content that is not present; note anything clearly missing in "gaps".
${OUTPUT_CONTRACT}`;
