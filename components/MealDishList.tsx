"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { springSoft, springUI } from "@/lib/springs";

/** A meal's dishes are labelled by their place in it, not the library's course pills. */
export const MEAL_ROLE: Record<string, string> = {
  meals: "Main",
  sides: "Side",
  appetizers: "Starter",
  desserts: "Dessert",
  drinks: "Drink",
  misc: "",
};

/** Braises run for hours — "4h" reads at a glance where "240m" makes you divide. */
export function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** One tap fills the hint; "Surprise me" leaves it empty on purpose. */
const SWAP_HINTS = ["Something lighter", "No oven", "Quicker", "Surprise me"];

type Dish = {
  title: string;
  course: string;
  description: string;
  time_active_min: number | null;
  time_total_min: number | null;
};

/**
 * The dishes of a meal as cards: tap to open the recipe, and — when `onSwap`
 * is given — swap any one of them for something else, with an optional hint.
 * Shared by the Make results and a saved meal, so both read the same.
 */
export function MealDishList({
  dishes,
  status,
  onOpen,
  onSwap,
}: {
  dishes: Dish[];
  /** Per-dish footer note, e.g. "✓ Saved" (true) / "Not saved yet" (false); null hides it. */
  status?: (boolean | null)[];
  onOpen: (i: number) => void;
  onSwap?: (i: number, hint: string) => void;
}) {
  const [swapAt, setSwapAt] = useState<number | null>(null);
  const [hint, setHint] = useState("");

  function openSwap(i: number) {
    setSwapAt((cur) => (cur === i ? null : i));
    setHint("");
  }

  function go(i: number, h: string) {
    setSwapAt(null);
    onSwap?.(i, h === "Surprise me" ? "" : h.trim());
  }

  return (
    <ul className="space-y-2">
      {dishes.map((d, i) => {
        const role = MEAL_ROLE[d.course] ?? "";
        const s = status?.[i];
        return (
          <motion.li
            key={`${d.title}-${i}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springSoft, delay: i * 0.04 }}
            className="rounded-[14px] border border-char/10 bg-surface"
          >
            <button onClick={() => onOpen(i)} className="w-full p-3 pb-2 text-left">
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 font-display text-[15px] font-bold">{d.title}</span>
                {role && (
                  <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-smoke">
                    {role}
                  </span>
                )}
              </span>
              {/* No `block` here: line-clamp needs its own display value to cut
                  the text off at two lines. */}
              {d.description && (
                <span className="mt-0.5 line-clamp-2 text-xs text-smoke">{d.description}</span>
              )}
            </button>
            <div className="flex items-center gap-3 px-3 pb-3 text-xs">
              {d.time_active_min != null && (
                <span className="text-smoke">
                  {formatMinutes(d.time_active_min)} active
                  {d.time_total_min != null &&
                    d.time_total_min !== d.time_active_min &&
                    ` · ${formatMinutes(d.time_total_min)} total`}
                </span>
              )}
              {s != null && (
                <span className={`font-semibold ${s ? "text-herb" : "text-smoke"}`}>
                  {s ? "✓ Saved" : "Not saved yet"}
                </span>
              )}
              {onSwap && (
                <button
                  onClick={() => openSwap(i)}
                  className={`ml-auto rounded-full px-3 py-1 font-semibold ${
                    swapAt === i ? "bg-char text-tile" : "bg-char/5 text-char"
                  }`}
                >
                  Swap
                </button>
              )}
            </div>

            <AnimatePresence initial={false}>
              {swapAt === i && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={springUI}
                  className="overflow-hidden"
                >
                  <div className="border-t border-char/10 p-3">
                    <p className="text-sm font-semibold">
                      Swap the {role ? role.toLowerCase() : "dish"} for…
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {SWAP_HINTS.map((h) => (
                        <button
                          key={h}
                          onClick={() => go(i, h)}
                          className="rounded-full bg-char/5 px-3 py-1.5 text-xs font-medium text-smoke"
                        >
                          {h}
                        </button>
                      ))}
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (hint.trim()) go(i, hint);
                      }}
                      className="mt-2 flex gap-2"
                    >
                      <input
                        value={hint}
                        onChange={(e) => setHint(e.target.value.slice(0, 200))}
                        placeholder="or say what you'd like…"
                        aria-label="What would you like instead?"
                        className="min-w-0 flex-1 rounded-full border border-char/15 bg-tile px-3.5 py-2 text-base outline-none focus:border-flame"
                      />
                      <button
                        type="submit"
                        disabled={!hint.trim()}
                        className="shrink-0 rounded-full bg-flame px-4 text-sm font-bold text-accent-ink disabled:opacity-40"
                      >
                        Swap
                      </button>
                    </form>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.li>
        );
      })}
    </ul>
  );
}
