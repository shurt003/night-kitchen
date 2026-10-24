"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { springSoft } from "@/lib/springs";
import { SwapPanel } from "./SwapPanel";

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

  function openSwap(i: number) {
    setSwapAt((cur) => (cur === i ? null : i));
  }

  function go(i: number, hint: string) {
    setSwapAt(null);
    onSwap?.(i, hint);
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
              {swapAt === i && <SwapPanel what={role ? role.toLowerCase() : "dish"} onSwap={(h) => go(i, h)} />}
            </AnimatePresence>
          </motion.li>
        );
      })}
    </ul>
  );
}
