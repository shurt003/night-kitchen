"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { QuickMeal, Recipe } from "@/lib/types";
import { NO_COOK_TITLES } from "@/lib/types";
import { springSoft, springUI } from "@/lib/springs";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import { dayLabel, weekdayLong } from "@/lib/week";
import { RecipeImage } from "./RecipeImage";

type Mode = "type" | "recipe" | "quick";

/**
 * Three ways to fill a slot, all equal citizens (§5). Typing opens first and
 * needs nothing else — a meal is not always a recipe.
 */
export function MealPicker({
  date,
  onClose,
  onPick,
}: {
  date: string;
  onClose: () => void;
  onPick: (body: Record<string, unknown>) => void;
}) {
  const [mode, setMode] = useState<Mode>("recipe");
  const [typed, setTyped] = useState("");
  const [saveQuick, setSaveQuick] = useState(false);
  const [query, setQuery] = useState("");
  // null until the fetch lands — an empty array is a real answer ("you have
  // none"), and showing that answer before it's true flashed "Nothing matches"
  // over a library that was merely still loading.
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [quickMeals, setQuickMeals] = useState<QuickMeal[] | null>(null);
  useBodyScrollLock();

  /**
   * A typed meal can be promoted to a quick meal in the same gesture — the
   * night then links to the saved quick meal (so its use gets counted). If the
   * save fails for any reason, the night still gets planned as plain freeform.
   */
  async function addTyped() {
    const title = typed.trim();
    if (!title) return;
    if (saveQuick) {
      try {
        const res = await fetch("/api/quick-meals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: title }),
        });
        const json = await res.json();
        if (res.ok && json.quick_meal?.id) {
          onPick({ source_type: "quick_meal", quick_meal_id: json.quick_meal.id });
          return;
        }
      } catch {}
    }
    onPick({ source_type: "freeform", title });
  }

  useEffect(() => {
    // A failed fetch settles to empty too — the list stops loading and says so,
    // rather than pulsing forever.
    fetch("/api/recipes?sort=recent")
      .then((r) => r.json())
      .then((j) => setRecipes(j.recipes ?? []))
      .catch(() => setRecipes([]));
    fetch("/api/quick-meals")
      .then((r) => r.json())
      .then((j) => setQuickMeals(j.quick_meals ?? []))
      .catch(() => setQuickMeals([]));
  }, []);

  const { day } = dayLabel(date);
  const filtered = (recipes ?? []).filter((r) =>
    r.title.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-50 touch-none bg-scrim/45"
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={springUI}
        // Full-height like SundayFlow, so switching modes never resizes the
        // sheet — only the scroll area's content changes.
        className="fixed inset-x-0 bottom-0 top-[max(env(safe-area-inset-top),12px)] z-50 mx-auto flex max-w-2xl flex-col rounded-t-3xl bg-tile p-5 pb-[max(env(safe-area-inset-bottom),20px)]"
      >
        <div className="flex shrink-0 items-center justify-between">
          <h2 className="font-display text-xl font-bold">
            {weekdayLong(date)} {day}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-char/5 text-smoke"
          >
            ✕
          </button>
        </div>

        {/* No-cook nights are one tap — a real plan entry, not a guilty gap.
            Outlined so they read as a different kind of thing than the mode
            tabs below. */}
        <div className="mt-2.5 flex shrink-0 flex-wrap items-center gap-2">
          <span className="text-xs text-smoke">Not cooking?</span>
          {NO_COOK_TITLES.map((t) => (
            <button
              key={t}
              onClick={() => onPick({ source_type: "freeform", title: t })}
              className="rounded-full border border-char/15 bg-surface px-3 py-1 text-sm font-medium text-smoke"
            >
              {t}
            </button>
          ))}
        </div>

        <div className="mt-3 flex shrink-0 gap-2">
          {([
            ["recipe", "A recipe"],
            ["type", "Just type it"],
            ["quick", "Quick meal"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${
                mode === key ? "bg-char text-tile" : "bg-char/5 text-smoke"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {mode === "type" && (
            <div>
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addTyped();
                }}
                placeholder="salmon, rice, broccoli"
                className="w-full rounded-xl border border-char/15 bg-surface px-4 py-3 text-base outline-none focus:border-flame"
              />
              <p className="mt-2 text-sm text-smoke">
                That&apos;s a legitimate Tuesday. Nothing else required.
              </p>
              <label className="mt-3 flex items-start gap-3 rounded-xl bg-surface px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={saveQuick}
                  onChange={(e) => setSaveQuick(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[#e8430f]"
                />
                <span className="text-sm">
                  <span className="font-semibold">Make this often?</span>{" "}
                  <span className="text-smoke">
                    Save it so it&apos;s one tap away under Quick meal next time.
                  </span>
                </span>
              </label>
              <motion.button
                whileTap={{ scale: 0.97 }}
                transition={springUI}
                disabled={!typed.trim()}
                onClick={() => void addTyped()}
                className="mt-3 w-full rounded-xl bg-flame py-3.5 font-display font-bold text-accent-ink disabled:opacity-40"
              >
                Add it
              </motion.button>
            </div>
          )}

          {mode === "recipe" && (
            <div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your library…"
                className="w-full rounded-xl border border-char/15 bg-surface px-4 py-2.5 text-base outline-none focus:border-flame"
              />
              <ul className="mt-3 space-y-1.5">
                {/* Cascade in from the top. The per-row delay caps so a long
                    library doesn't turn the tail of the list into a wait. */}
                {filtered.map((r, i) => (
                  <motion.li
                    key={r.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...springSoft, delay: Math.min(i, 12) * 0.025 }}
                  >
                    <button
                      onClick={() => onPick({ source_type: "recipe", recipe_id: r.id })}
                      className="flex w-full items-center gap-3 rounded-xl bg-surface p-2 text-left"
                    >
                      <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-char/5">
                        {(r.image_thumb_url ?? r.image_url) && (
                          <RecipeImage src={(r.image_thumb_url ?? r.image_url) as string} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{r.title}</span>
                        <span className="block text-xs text-smoke">
                          {r.time_active_min != null ? `${r.time_active_min}m active` : ""}
                          {r.status === "want_to_try" ? " · never made" : ""}
                        </span>
                      </span>
                    </button>
                  </motion.li>
                ))}
                {recipes === null ? (
                  <li className="animate-pulse py-6 text-center text-sm text-smoke">
                    Getting your library…
                  </li>
                ) : (
                  !filtered.length && (
                    <li className="py-6 text-center text-sm text-smoke">
                      {recipes.length ? "Nothing matches." : "Your library's empty so far."}
                    </li>
                  )
                )}
              </ul>
            </div>
          )}

          {mode === "quick" && (
            <ul className="space-y-1.5">
              {(quickMeals ?? []).map((q, i) => (
                <motion.li
                  key={q.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...springSoft, delay: Math.min(i, 12) * 0.025 }}
                >
                  <button
                    onClick={() => onPick({ source_type: "quick_meal", quick_meal_id: q.id })}
                    className="flex w-full items-center justify-between rounded-xl bg-surface px-3 py-3 text-left"
                  >
                    <span className="text-[15px]">{q.name}</span>
                    <span className="text-xs text-smoke">used {q.times_used}×</span>
                  </button>
                </motion.li>
              ))}
              {quickMeals === null ? (
                <li className="animate-pulse py-8 text-center text-sm text-smoke">
                  Getting your quick meals…
                </li>
              ) : (
                !quickMeals.length && (
                  <li className="py-8 text-center text-sm text-smoke">
                    No quick meals yet. Type a meal in and tick &ldquo;Make this often?&rdquo; —
                    it&apos;ll live here.
                  </li>
                )
              )}
            </ul>
          )}
        </div>
      </motion.div>
    </>
  );
}

export function PickerPortal({
  date,
  onClose,
  onPick,
}: {
  date: string | null;
  onClose: () => void;
  onPick: (body: Record<string, unknown>) => void;
}) {
  return (
    <AnimatePresence>
      {date && <MealPicker date={date} onClose={onClose} onPick={onPick} />}
    </AnimatePresence>
  );
}
