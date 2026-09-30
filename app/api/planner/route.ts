import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { weekDates } from "@/lib/week";
import { currentUserId } from "@/lib/auth";

/** GET /api/planner?start=YYYY-MM-DD — the week's slots, joined to their source. */
export async function GET(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const start = new URL(req.url).searchParams.get("start");
  const dates = weekDates(start ? new Date(start + "T12:00:00") : new Date());

  const { data, error } = await db()
    .from("planned_meals")
    .select(
      "*, recipes(id, title, image_url, time_active_min, effort, hearts, ingredients), quick_meals(id, name, ingredients)"
    )
    .eq("user_id", userId)
    .in("date", dates)
    .order("date");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ dates, meals: data ?? [] });
}

/**
 * POST /api/planner — fill one night. All three sources are equal citizens:
 * { date, source_type: "recipe"|"quick_meal"|"freeform", recipe_id?, quick_meal_id?, title?, ingredients?, note?, reason? }
 * Typing a title is the zero-friction path and requires nothing else.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.date || !body.source_type) {
    return NextResponse.json({ error: "date and source_type required" }, { status: 400 });
  }
  const supabase = db();

  const row = {
    user_id: userId,
    date: body.date,
    slot: "dinner" as const,
    source_type: body.source_type,
    recipe_id: body.source_type === "recipe" ? body.recipe_id : null,
    quick_meal_id: body.source_type === "quick_meal" ? body.quick_meal_id : null,
    title: body.title ?? "",
    ingredients: body.ingredients ?? null,
    note: body.note ?? "",
    reason: body.reason ?? "",
    locked: body.locked ?? false,
  };

  const { data, error } = await supabase
    .from("planned_meals")
    .upsert(row, { onConflict: "user_id,date,slot" })
    .select(
      "*, recipes(id, title, image_url, time_active_min, effort, hearts, ingredients), quick_meals(id, name, ingredients)"
    )
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Using a quick meal is what makes it worth keeping around.
  if (body.source_type === "quick_meal" && body.quick_meal_id) {
    const { data: qm } = await supabase
      .from("quick_meals")
      .select("times_used")
      .eq("id", body.quick_meal_id)
      .eq("user_id", userId)
      .maybeSingle();
    await supabase
      .from("quick_meals")
      .update({ times_used: (qm?.times_used ?? 0) + 1, last_used: body.date })
      .eq("id", body.quick_meal_id)
      .eq("user_id", userId);
  }

  return NextResponse.json({ meal: data });
}
