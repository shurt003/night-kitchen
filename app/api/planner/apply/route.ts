import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/auth";

/**
 * POST /api/planner/apply
 * Body: { picks: [{ date, source_type: "recipe" | "quick_meal", id, reason? }] }
 *
 * Writes the picks the user APPROVED in the review sheet. Everything is
 * re-validated here — the client echoes back what generate proposed, and an
 * echo is never trusted: ids must be the user's own, dates must still be
 * empty (something may have been planned between propose and apply; first
 * write wins, the pick is skipped and reported).
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  type Pick = {
    date: string;
    source_type: "recipe" | "quick_meal" | "idea";
    id?: string | null;
    // idea only:
    title?: string;
    ingredients?: { item: string; quantity: string | null }[];
    reason?: string;
  };
  const rawPicks: Pick[] = Array.isArray(body.picks) ? body.picks : [];
  const picks = rawPicks.filter((p) => {
    if (typeof p?.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return false;
    if (p.source_type === "idea") return typeof p.title === "string" && !!p.title.trim();
    return (
      (p.source_type === "recipe" || p.source_type === "quick_meal") && typeof p.id === "string"
    );
  });
  if (!picks.length) return NextResponse.json({ error: "Nothing to apply." }, { status: 400 });

  const supabase = db();
  const dates = [...new Set(picks.map((p) => p.date))];
  const recipeIds = [
    ...new Set(picks.filter((p) => p.source_type === "recipe").map((p) => p.id as string)),
  ];
  const quickIds = [
    ...new Set(picks.filter((p) => p.source_type === "quick_meal").map((p) => p.id as string)),
  ];

  const [planned, ownRecipes, ownQuick] = await Promise.all([
    supabase.from("planned_meals").select("date").eq("user_id", userId).in("date", dates),
    recipeIds.length
      ? supabase.from("recipes").select("id").eq("user_id", userId).in("id", recipeIds)
      : Promise.resolve({ data: [] as { id: string }[] }),
    quickIds.length
      ? supabase.from("quick_meals").select("id").eq("user_id", userId).in("id", quickIds)
      : Promise.resolve({ data: [] as { id: string }[] }),
  ]);

  const takenDates = new Set((planned.data ?? []).map((m) => m.date));
  const validRecipe = new Set((ownRecipes.data ?? []).map((r) => r.id));
  const validQuick = new Set((ownQuick.data ?? []).map((q) => q.id));

  const seen = new Set<string>();
  const valid = picks.filter((p) => {
    if (takenDates.has(p.date) || seen.has(p.date)) return false;
    if (p.source_type === "recipe" && !validRecipe.has(p.id as string)) return false;
    if (p.source_type === "quick_meal" && !validQuick.has(p.id as string)) return false;
    seen.add(p.date);
    return true;
  });

  const inserted = [];
  for (const pick of valid) {
    // An invented idea becomes a freeform night: its title + ingredients live
    // on the row itself, which is all add-to-grocery needs later.
    const isIdea = pick.source_type === "idea";
    const ingredients = isIdea
      ? (pick.ingredients ?? [])
          .filter((i) => typeof i?.item === "string" && i.item.trim())
          .slice(0, 30)
          .map((i) => ({
            raw: [i.quantity, i.item].filter(Boolean).join(" ").trim(),
            quantity: typeof i.quantity === "string" ? i.quantity : null,
            unit: null,
            item: i.item.trim(),
            note: null,
            section: null,
          }))
      : null;
    const { data } = await supabase
      .from("planned_meals")
      .upsert(
        {
          user_id: userId,
          date: pick.date,
          slot: "dinner",
          source_type: isIdea ? "freeform" : pick.source_type,
          recipe_id: pick.source_type === "recipe" ? pick.id : null,
          quick_meal_id: pick.source_type === "quick_meal" ? pick.id : null,
          title: isIdea ? (pick.title as string).trim().slice(0, 120) : "",
          ingredients: ingredients?.length ? ingredients : null,
          reason: typeof pick.reason === "string" ? pick.reason.slice(0, 500) : "",
        },
        { onConflict: "user_id,date,slot" }
      )
      .select(
        "*, recipes(id, title, image_url, time_active_min, effort, hearts, ingredients), quick_meals(id, name, ingredients)"
      )
      .single();
    if (data) inserted.push(data);
  }

  return NextResponse.json({ meals: inserted, skipped: picks.length - valid.length });
}
