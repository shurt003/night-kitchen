"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { springUI } from "@/lib/springs";

/** One tap swaps with that hint; "Surprise me" leaves the hint empty on purpose. */
const SWAP_HINTS = ["Something lighter", "No oven", "Quicker", "Surprise me"];

/**
 * The swap choices that open under a dish or a night: a few one-tap hints, or
 * say what you'd like. Used by a meal's dishes and a week's nights alike.
 */
export function SwapPanel({ what, onSwap }: { what: string; onSwap: (hint: string) => void }) {
  const [hint, setHint] = useState("");
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={springUI}
      className="overflow-hidden"
    >
      <div className="border-t border-char/10 p-3">
        <p className="text-sm font-semibold">Swap the {what} for…</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SWAP_HINTS.map((h) => (
            <button
              key={h}
              onClick={() => onSwap(h === "Surprise me" ? "" : h)}
              className="rounded-full bg-char/5 px-3 py-1.5 text-xs font-medium text-smoke"
            >
              {h}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (hint.trim()) onSwap(hint.trim());
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
  );
}
