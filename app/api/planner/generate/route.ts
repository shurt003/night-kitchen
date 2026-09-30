import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { MODELS } from "@/lib/config";
import { askJson } from "@/lib/anthropic";
import { PlanSchema } from "@/lib/schemas";
import { PLAN_WEEK_SYSTEM } from "@/lib/prompts/planner";
import { buildRecipeIndex, buildQuickMealIndex } from "@/lib/recipeIndex";
import { weekDates } from "@/lib/week";
import { currentUserId } from "@/lib/auth";

// 300 (the max): proposals are the app's longest model call, and a killed
// function strands the client mid-"Thinking…".
export const maxDuration = 300;

export type PlanSource = "library" | "on_hand" | "mix";

/**
 * POST /api/planner/generate
 * Body: { start?, dates?: string[], source?: "library"|"on_hand"|"mix",
 *         max_active_by_date?: {date: minutes}, avoid_weeks?: number,
 *         avoid_titles?: string[] }
 *
 * avoid_titles powers the single-night "swap" reroll: everything already shown
 * this session goes in, so a fresh ask can't hand back what was just passed on.
 *
 * PROPOSES dinners for the nights the user chose — writes nothing. Each chosen
 * night gets a primary suggestion plus an alternate (so "something else" in
 * the review sheet is instant, no second model call). Approved picks are
 * written by POST /api/planner/apply after review.
 *
 * "source" decides where dinners come from: saved recipes ("library"),
 * invented ideas grounded in staples + the unbought grocery list ("on_hand"),
 * or both ("mix", the default). Asking for fewer nights and fewer sources is
 * also the latency fix — the call is as small as the ask.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const dates = weekDates(body.start ? new Date(body.start + "T12:00:00") : new Date());
  const source: PlanSource = ["library", "on_hand", "mix"].includes(body.source)
    ? body.source
    : "mix";
  const supabase = db();

  const { data: existing } = await supabase
    .from("planned_meals")
    .select("id, date, source_type, title, locked, recipes(title, main_ingredients), quick_meals(name)")
    .eq("user_id", userId)
    .in("date", dates);

  // Supabase types to-one joins as arrays; normalize to the single row.
  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

  type ExistingRow = {
    date: string;
    source_type: string;
    title: string;
    recipes?: unknown;
    quick_meals?: unknown;
  };

  const taken = new Map<string, ExistingRow>();
  for (const m of (existing ?? []) as unknown as ExistingRow[]) taken.set(m.date, m);

  // The nights to plan: what the user chose, clipped to genuinely empty nights.
  const requested: string[] = Array.isArray(body.dates) ? body.dates : [];
  const emptyDates = dates.filter(
    (d) => !taken.has(d) && (requested.length === 0 || requested.includes(d))
  );
  if (!emptyDates.length) {
    return NextResponse.json({ proposals: [], message: "Those nights are already planned." });
  }

  const wantLibrary = source !== "on_hand";
  const [recipes, quickMeals, staplesRes, tripRes] = await Promise.all([
    wantLibrary ? buildRecipeIndex(userId) : Promise.resolve([]),
    wantLibrary ? buildQuickMealIndex(userId) : Promise.resolve([]),
    supabase.from("staples").select("name").eq("user_id", userId).eq("active", true),
    // Read-only: no getOrCreateOpenTrip here — planning shouldn't create a trip.
    supabase.from("grocery_trips").select("id").eq("user_id", userId).eq("status", "open").maybeSingle(),
  ]);
  if (source === "library" && !recipes.length && !quickMeals.length) {
    return NextResponse.json(
      { error: "Nothing to plan from yet — capture a few recipes first." },
      { status: 400 }
    );
  }

  // Unbought items on the open list = incoming inventory for the coming week.
  let groceryList: { name: string; quantity: string; for?: string }[] = [];
  if (tripRes.data) {
    const { data: items } = await supabase
      .from("grocery_items")
      .select("name, quantity, source_type, sources")
      .eq("user_id", userId)
      .eq("trip_id", tripRes.data.id)
      .eq("checked", false);
    type Src = { type: string; label: string | null };
    groceryList = (items ?? []).map((i) => {
      const labels = ((i.sources ?? []) as Src[])
        .filter((s) => (s.type === "recipe" || s.type === "quick_meal") && s.label)
        .map((s) => s.label as string);
      return {
        name: i.name,
        quantity: i.quantity,
        ...(labels.length ? { for: [...new Set(labels)].join(", ") } : {}),
      };
    });
  }

  const avoidWeeks = Number(body.avoid_weeks ?? 3);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - avoidWeeks * 7);

  const avoidTitles: string[] = Array.isArray(body.avoid_titles)
    ? body.avoid_titles.filter((t: unknown): t is string => typeof t === "string").slice(0, 40)
    : [];

  const plan = await askJson({
    feature: "plan_week",
    userId,
    model: MODELS.smart,
    // Without a cap, Sonnet 5 thinks at high effort by default — that ran a
    // 21-option call past the function limit. Medium keeps the cross-week
    // reasoning; the smaller night/option counts do the rest.
    effort: "medium",
    system: PLAN_WEEK_SYSTEM,
    content: JSON.stringify({
      mode: source,
      week: dates.map((date) => {
        const m = taken.get(date);
        const recipe = one<{ title: string; main_ingredients: string[] | null }>(
          m?.recipes as never
        );
        const quick = one<{ name: string }>(m?.quick_meals as never);
        return {
          date,
          planned: m ? recipe?.title ?? quick?.name ?? m.title : null,
          uses: recipe?.main_ingredients ?? [],
        };
      }),
      empty_dates: emptyDates,
      ...(wantLibrary ? { recipes, quick_meals: quickMeals } : {}),
      staples: (staplesRes.data ?? []).map((s) => s.name),
      grocery_list: groceryList,
      ...(avoidTitles.length ? { avoid_titles: avoidTitles } : {}),
      constraints: {
        max_active_minutes_by_date: body.max_active_by_date ?? {},
        avoid_cooked_since: cutoff.toISOString().slice(0, 10),
        effort_budget: "avoid stacking more than two high-effort nights in one week",
      },
    }),
    schema: PlanSchema,
    maxTokens: 8192,
  });

  // Keep only requested nights and options that check out: real owned ids for
  // library picks, a usable title for ideas — and in on_hand mode, ideas only.
  const recipeIds = new Set(recipes.map((r) => r.id));
  const quickIds = new Set(quickMeals.map((q) => q.id));
  const seen = new Set<string>();
  const cleaned = plan.picks
    .filter((p) => {
      if (!emptyDates.includes(p.date) || seen.has(p.date)) return false;
      seen.add(p.date);
      return true;
    })
    .map((p) => ({
      date: p.date,
      options: p.options
        .filter((o) => {
          if (o.source_type === "idea") return !!o.title?.trim();
          if (source === "on_hand") return false;
          return o.id != null && (o.source_type === "recipe" ? recipeIds.has(o.id) : quickIds.has(o.id));
        })
        .slice(0, 2),
    }))
    .filter((p) => p.options.length > 0);

  // Hydrate library options for the review cards: photo + active time.
  const pickedRecipeIds = [
    ...new Set(
      cleaned.flatMap((p) =>
        p.options.filter((o) => o.source_type === "recipe" && o.id).map((o) => o.id as string)
      )
    ),
  ];
  const { data: pickedRecipes } = pickedRecipeIds.length
    ? await supabase
        .from("recipes")
        .select("id, title, image_url, image_thumb_url, time_active_min")
        .eq("user_id", userId)
        .in("id", pickedRecipeIds)
    : {
        data: [] as {
          id: string;
          title: string;
          image_url: string | null;
          image_thumb_url: string | null;
          time_active_min: number | null;
        }[],
      };
  const recipeById = new Map((pickedRecipes ?? []).map((r) => [r.id, r]));
  const quickById = new Map(quickMeals.map((q) => [q.id, q]));

  const proposals = cleaned.map((p) => ({
    date: p.date,
    options: p.options.map((o) => {
      if (o.source_type === "idea") {
        return {
          source_type: "idea" as const,
          id: null,
          title: o.title!.trim(),
          image_url: null,
          time_active_min: o.time_active_min,
          uses: o.uses.slice(0, 8),
          needs: o.needs.slice(0, 4),
          ingredients: o.ingredients.slice(0, 30),
          reason: o.reason,
        };
      }
      const r = o.source_type === "recipe" ? recipeById.get(o.id as string) : null;
      const q = o.source_type === "quick_meal" ? quickById.get(o.id as string) : null;
      return {
        source_type: o.source_type,
        id: o.id,
        title: r?.title ?? q?.name ?? "Dinner",
        // Draft rows show 48px squares — the thumb is all they need.
        image_url: r?.image_thumb_url ?? r?.image_url ?? null,
        time_active_min: r?.time_active_min ?? null,
        uses: [],
        needs: [],
        ingredients: [],
        reason: o.reason,
      };
    }),
  }));

  return NextResponse.json({ proposals });
}
