import { NextResponse } from "next/server";
import { MODELS } from "@/lib/config";
import { askJson } from "@/lib/anthropic";
import { RecipeNoteSchema } from "@/lib/schemas";
import { RECIPE_NOTE_SYSTEM } from "@/lib/prompts/cook";
import { currentUserId } from "@/lib/auth";

export const maxDuration = 30;

/**
 * POST /api/recipe-ask/note — condense an Ask answer into a terse margin note.
 * Saving the whole reply into notes buried the one line worth keeping; this
 * boils it down to that line.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const answer = String(body.answer ?? "").trim();
  const question = String(body.question ?? "").trim();
  if (!answer) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });

  const result = await askJson({
    feature: "recipe-ask-note",
    userId,
    model: MODELS.fast,
    system: RECIPE_NOTE_SYSTEM,
    content: JSON.stringify({ question, answer }),
    schema: RecipeNoteSchema,
    maxTokens: 120,
  });

  return NextResponse.json({ note: result.note.trim() });
}
