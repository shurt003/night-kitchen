import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { MODELS } from "@/lib/config";
import { streamText } from "@/lib/anthropic";
import { RECIPE_ASK_SYSTEM } from "@/lib/prompts/cook";
import { currentUserId } from "@/lib/auth";
import type { Recipe } from "@/lib/types";

export const maxDuration = 120;

/**
 * POST /api/recipe-ask — chat about one recipe, streamed as plain text.
 * Context is that single recipe (ingredients, steps, servings, the cook's own
 * notes), so answers stay grounded in the dish in front of them.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const recipeId = String(body.recipeId ?? "");
  const messages: { role: "user" | "assistant"; text: string }[] = Array.isArray(body.messages)
    ? body.messages
        .filter((m: unknown): m is { role: "user" | "assistant"; text: string } =>
          !!m && (m as { role?: string }).role !== undefined && typeof (m as { text?: unknown }).text === "string"
        )
        .slice(-12)
    : [];

  if (!recipeId) return NextResponse.json({ error: "Missing recipe." }, { status: 400 });
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "Ask me something." }, { status: 400 });
  }

  const { data: recipe } = await db()
    .from("recipes")
    .select("*")
    .eq("id", recipeId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!recipe) return NextResponse.json({ error: "Recipe not found." }, { status: 404 });

  const r = recipe as Recipe;
  const context = {
    title: r.title,
    description: r.description,
    servings: r.servings,
    time_active_min: r.time_active_min,
    time_total_min: r.time_total_min,
    ingredients: r.ingredients,
    steps: r.steps.map((s) => s.text),
    notes: r.notes || null,
  };
  const system = `${RECIPE_ASK_SYSTEM}\n\nThe recipe:\n${JSON.stringify(context)}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamText({
          feature: "recipe-ask",
          userId,
          model: MODELS.smart,
          system,
          messages: messages.map((m) => ({ role: m.role, content: m.text })),
          maxTokens: 550,
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch {
        controller.enqueue(encoder.encode("\n\nSomething went wrong — try that again."));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
