import { NextResponse } from "next/server";
import {
  annotateOwned,
  candidatesForPlannedMeal,
  candidatesForRecipe,
  type Candidate,
} from "@/lib/candidates";
import { currentUserId } from "@/lib/auth";
import { normalizeName } from "@/lib/groceryShared";
import { formatQuantity, parseQuantity } from "@/lib/scale";

/**
 * POST /api/grocery/preview
 * Body: { recipe_id } | { recipe_ids: [] } | { planned_meal_id } | { planned_meal_ids: [] }
 *
 * What *would* be added, annotated with whether you likely already have it.
 * Nothing is written — the user confirms first, so an item is never silently
 * withheld.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  let candidates: Candidate[] = [];

  if (body.recipe_id) {
    candidates = await candidatesForRecipe(userId, body.recipe_id);
  } else if (Array.isArray(body.recipe_ids)) {
    // A Make meal or a whole week: every dish's ingredients in one confirm
    // step, one row per ingredient — garlic in six recipes is one "garlic"
    // line, not six. (Adding merges them on the list the same way.)
    const lists = await Promise.all(
      body.recipe_ids.slice(0, 16).map((id: string) => candidatesForRecipe(userId, String(id)))
    );
    candidates = collapse(lists.flat());
  } else if (body.planned_meal_id) {
    candidates = await candidatesForPlannedMeal(userId, body.planned_meal_id);
  } else if (Array.isArray(body.planned_meal_ids)) {
    const lists = await Promise.all(
      body.planned_meal_ids.map((id: string) => candidatesForPlannedMeal(userId, id))
    );
    candidates = lists.flat();
  } else {
    return NextResponse.json({ error: "Nothing to preview" }, { status: 400 });
  }

  return NextResponse.json({ items: await annotateOwned(userId, candidates) });
}

/** One row per ingredient name, quantities combined, labelled by how many recipes need it. */
function collapse(list: Candidate[]): Candidate[] {
  const byName = new Map<string, { first: Candidate; quantities: string[]; count: number }>();
  for (const c of list) {
    const key = normalizeName(c.name);
    const prev = byName.get(key);
    if (!prev) byName.set(key, { first: c, quantities: [c.quantity], count: 1 });
    else {
      prev.quantities.push(c.quantity);
      prev.count += 1;
    }
  }
  return [...byName.values()].map(({ first, quantities, count }) => ({
    ...first,
    quantity: combineQuantities(quantities),
    source_label: count > 1 ? `${count} recipes` : first.source_label,
  }));
}

/**
 * Sum amounts that share a unit, whatever order they came in and whether the
 * unit is singular or plural ("14 cloves" + "1 clove" = "15 cloves"); keep
 * the rest alongside ("1½ + 2 wedges"). Display only — adding to the list
 * still merges through mergeQuantities as it always has.
 */
function combineQuantities(quantities: string[]): string {
  const groups = new Map<string, { total: number; unit: string }>();
  const loose: string[] = [];
  for (const q of quantities.map((x) => x.trim()).filter(Boolean)) {
    const m = q.match(/^([\d\s./½⅓⅔¼¾⅛⅜⅝⅞]+)\s*(.*)$/);
    const n = m ? parseQuantity(m[1]) : null;
    if (!m || n === null) {
      loose.push(q);
      continue;
    }
    const unit = m[2].trim();
    // "whole" is no unit at all; plurals fold into their singular.
    const key = unit.toLowerCase().replace(/^whole$/, "").replace(/(?<=[a-z]{2})s$/, "");
    const g = groups.get(key);
    if (!g) groups.set(key, { total: n, unit: key ? unit : "" });
    else {
      g.total += n;
      // Prefer the plural spelling once there's more than one.
      if (unit.toLowerCase().endsWith("s") && unit.length > g.unit.length) g.unit = unit;
    }
  }
  const parts = [...groups.values()].map(({ total, unit }) => `${formatQuantity(total)}${unit ? ` ${unit}` : ""}`);
  return [...parts, ...loose].join(" + ");
}
