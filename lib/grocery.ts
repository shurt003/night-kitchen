import { db } from "./db";
import { MODELS, GrocerySection } from "./config";
import { askJson } from "./anthropic";
import { CategorizeSchema } from "./schemas";
import { CATEGORIZE_SYSTEM } from "./prompts/grocery";
import { normalizeName, mergeQuantities } from "./groceryShared";

export { normalizeName, mergeQuantities };

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------
export function nextSunday(from = new Date()): string {
  const d = new Date(from);
  const day = d.getDay();
  const add = day === 0 ? 0 : 7 - day; // today if it IS Sunday
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}

export async function getOrCreateOpenTrip(userId: string) {
  const supabase = db();
  const { data: open } = await supabase
    .from("grocery_trips")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "open")
    .maybeSingle();
  if (open) return open;
  const { data: created, error } = await supabase
    .from("grocery_trips")
    .insert({ shop_date: nextSunday(), user_id: userId })
    .select()
    .single();
  if (error) throw error;
  return created;
}

// ---------------------------------------------------------------------------
// Canonicalization + categorization
// Order of authority: alias cache (one Haiku call per raw name, ever) →
// Haiku normalize+categorize → fallbacks. Hand-corrected sections
// (item_section_prefs, keyed by canonical name) always win.
// ---------------------------------------------------------------------------
export type Resolved = { canonical: string; section: GrocerySection };

export async function resolveItems(
  userId: string,
  names: string[]
): Promise<Map<string, Resolved>> {
  const supabase = db();
  const result = new Map<string, Resolved>();
  const normalized = [...new Set(names.map(normalizeName))];

  // 1. Alias cache — raw name → canonical
  const { data: aliases } = await supabase
    .from("ingredient_aliases")
    .select("raw_name, canonical")
    .in("raw_name", normalized);
  const canonicalByRaw = new Map((aliases ?? []).map((a) => [a.raw_name, a.canonical as string]));

  // 2. What section do we already know for those canonicals? Hand-corrections
  // first, then wherever the item landed last time.
  const cached = [...new Set(canonicalByRaw.values())];
  const [prefRes, seenRes] = await Promise.all([
    cached.length
      ? supabase.from("item_section_prefs").select("name, section").in("name", cached)
      : Promise.resolve({ data: [] as { name: string; section: string }[] }),
    cached.length
      ? supabase
          .from("grocery_items")
          .select("canonical_name, section, created_at")
          .eq("user_id", userId)
          .in("canonical_name", cached)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { canonical_name: string; section: string }[] }),
  ]);
  const prefSections = new Map(
    (prefRes.data ?? []).map((p) => [p.name, p.section as GrocerySection])
  );
  const seenSections = new Map<string, GrocerySection>();
  for (const row of seenRes.data ?? []) {
    // ordered newest first, so the first sighting wins
    if (row.canonical_name && !seenSections.has(row.canonical_name)) {
      seenSections.set(row.canonical_name, row.section as GrocerySection);
    }
  }

  /**
   * Haiku sees anything we can't fully answer: a name with no alias, or one
   * whose alias is cached but whose section we've never recorded. Skipping the
   * latter is what used to drop repeat items into "Other" — the alias table
   * stores no section, so a cache hit meant the section was simply lost.
   */
  const unknown = normalized.filter((n) => {
    const canonical = canonicalByRaw.get(n);
    if (!canonical) return true;
    return !prefSections.has(canonical) && !seenSections.has(canonical);
  });

  const aiSections = new Map<string, GrocerySection>();
  if (unknown.length && process.env.ANTHROPIC_API_KEY) {
    try {
      const ai = await askJson({
        feature: "categorize",
        userId,
        model: MODELS.fast,
        system: CATEGORIZE_SYSTEM,
        content: JSON.stringify({ items: unknown }),
        schema: CategorizeSchema,
        maxTokens: 2048,
      });
      const newAliases = [];
      for (const item of ai.items) {
        const raw = normalizeName(item.name);
        const canonical = normalizeName(item.canonical) || raw;
        canonicalByRaw.set(raw, canonical);
        aiSections.set(canonical, item.section);
        newAliases.push({ raw_name: raw, canonical });
      }
      if (newAliases.length) await supabase.from("ingredient_aliases").upsert(newAliases);
    } catch {
      // fall through: raw name becomes its own canonical, section 'other'
    }
  }

  // Prefs may cover canonicals only discovered by the call above.
  const fresh = [...new Set(normalized.map((n) => canonicalByRaw.get(n) ?? n))].filter(
    (c) => !prefSections.has(c)
  );
  if (fresh.length) {
    const { data: more } = await supabase
      .from("item_section_prefs")
      .select("name, section")
      .in("name", fresh);
    for (const p of more ?? []) prefSections.set(p.name, p.section as GrocerySection);
  }

  for (const n of normalized) {
    const canonical = canonicalByRaw.get(n) ?? n;
    result.set(n, {
      canonical,
      section:
        prefSections.get(canonical) ??
        aiSections.get(canonical) ??
        seenSections.get(canonical) ??
        "other",
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Add items to the open trip, merging duplicates on add
// ---------------------------------------------------------------------------
export type NewItem = {
  name: string;
  quantity?: string;
  source_type?: "manual" | "recipe" | "quick_meal" | "staple" | "ai";
  source_id?: string | null;
  source_label?: string | null;
  section?: GrocerySection; // caller may already know (staples)
  carried_over_from?: string | null;
};

export async function addItemsToOpenTrip(userId: string, items: NewItem[]) {
  const supabase = db();
  const trip = await getOrCreateOpenTrip(userId);

  const { data: existingItems } = await supabase
    .from("grocery_items")
    .select("*")
    .eq("user_id", userId)
    .eq("trip_id", trip.id)
    .eq("checked", false);
  // Merge key is the canonical name — "scallions" finds "green onions".
  const existingByCanonical = new Map(
    (existingItems ?? []).map((item) => [item.canonical_name ?? normalizeName(item.name), item])
  );

  const resolved = await resolveItems(userId, items.map((i) => i.name));

  const added: unknown[] = [];
  const merged: unknown[] = [];

  for (const item of items) {
    const norm = normalizeName(item.name);
    const res = resolved.get(norm) ?? { canonical: norm, section: "other" as GrocerySection };
    const source = {
      type: item.source_type ?? "manual",
      id: item.source_id ?? null,
      label: item.source_label ?? null,
      quantity: item.quantity ?? "",
    };
    const existing = existingByCanonical.get(res.canonical);

    if (existing) {
      const newQuantity = mergeQuantities(existing.quantity, item.quantity ?? "");
      const newSources = [...(existing.sources ?? []), source];
      const { data: updated } = await supabase
        .from("grocery_items")
        .update({ quantity: newQuantity, sources: newSources })
        .eq("id", existing.id)
        .eq("user_id", userId)
        .select()
        .single();
      existingByCanonical.set(res.canonical, updated ?? existing);
      merged.push(updated);
    } else {
      const { data: created } = await supabase
        .from("grocery_items")
        .insert({
          user_id: userId,
          trip_id: trip.id,
          name: item.name.trim(),
          canonical_name: res.canonical,
          quantity: item.quantity ?? "",
          section: item.section ?? res.section,
          source_type: item.source_type ?? "manual",
          source_id: item.source_id ?? null,
          sources: [source],
          carried_over_from: item.carried_over_from ?? null,
        })
        .select()
        .single();
      if (created) {
        existingByCanonical.set(res.canonical, created);
        added.push(created);
      }
    }
  }
  return { trip, added, merged };
}
