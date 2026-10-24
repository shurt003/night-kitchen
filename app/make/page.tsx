"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { springUI } from "@/lib/springs";

/**
 * Make: ask for a dish (or a whole meal) and get a recipe written for it.
 * Unlike Wing it, shopping is allowed — whatever's missing goes to the list.
 * See docs/MAKE_PLAN.md. Phase 1 is the page itself; generation lands in
 * Phase 2.
 */

/**
 * Rotated through the empty box so the range of what you can ask for is
 * shown rather than explained. A one-dish ask, a whole-meal ask, a dessert —
 * the three shapes Make answers.
 */
const EXAMPLES = [
  "chicken tikka masala",
  "date night: steak, a side and a dessert",
  "brown butter chocolate chip cookies",
  "something cozy with short ribs",
  "a big pot of chili for the weekend",
];

/** Same caps as Wing it — active time is what decides whether a night works. */
const TIMES: { label: string; max: number | null }[] = [
  { label: "Any time", max: null },
  { label: "30m or less", max: 30 },
  { label: "45m or less", max: 45 },
  { label: "1h or less", max: 60 },
];

export default function MakePage() {
  const [ask, setAsk] = useState("");
  const [meal, setMeal] = useState(false);
  const [maxActive, setMaxActive] = useState<number | null>(null);
  const [example, setExample] = useState(0);
  const [notYet, setNotYet] = useState(false);
  const askRef = useRef<HTMLTextAreaElement | null>(null);

  // Only cycles while the box is empty — once you're typing, it's your words.
  useEffect(() => {
    if (ask) return;
    const t = setInterval(() => setExample((n) => (n + 1) % EXAMPLES.length), 3200);
    return () => clearInterval(t);
  }, [ask]);

  return (
    <main className="px-4 pt-[max(env(safe-area-inset-top),16px)]">
      <h1 className="pr-11 font-display text-3xl font-bold">Make</h1>
      <p className="mt-1 text-sm text-smoke">
        What do you want to eat? A dish or a whole meal — your{" "}
        <Link href="/staples" className="font-semibold text-char underline underline-offset-2">
          staples
        </Link>{" "}
        will be used where they fit, and anything missing can go on the list.
      </p>

      {/* The example sits over the box rather than in `placeholder`, which
          can't animate — and pr-11 is reserved for the ✕ either way, so text
          doesn't reflow when you start typing. */}
      <div className="relative mt-3">
        <textarea
          ref={askRef}
          value={ask}
          onChange={(e) => {
            setAsk(e.target.value);
            setNotYet(false);
          }}
          rows={3}
          aria-label="What do you want to make?"
          className="w-full resize-none rounded-xl border border-char/15 bg-surface py-3 pl-4 pr-11 text-base outline-none focus:border-flame"
        />
        {!ask && (
          <span className="pointer-events-none absolute left-4 right-11 top-3 text-base text-smoke/60">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={example}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22 }}
                className="block"
              >
                {EXAMPLES[example]}…
              </motion.span>
            </AnimatePresence>
          </span>
        )}
        {ask && (
          <button
            onClick={() => {
              setAsk("");
              setNotYet(false);
              askRef.current?.focus();
            }}
            aria-label="Clear"
            className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full text-smoke/70"
          >
            ✕
          </button>
        )}
      </div>

      {/* One dish or a whole meal. Make also reads it from the words ("a main
          and a side"), so this is a nudge, not a gate. */}
      <div className="mt-2 flex gap-2">
        {[
          { label: "One dish", value: false },
          { label: "Whole meal", value: true },
        ].map((o) => {
          const active = meal === o.value;
          return (
            <button
              key={o.label}
              onClick={() => setMeal(o.value)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${
                active ? "bg-char text-tile" : "bg-char/5 text-smoke"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      <div className="no-scrollbar -mx-4 mt-1.5 flex gap-2 overflow-x-auto px-4 pb-1">
        {TIMES.map((t) => {
          const active = maxActive === t.max;
          return (
            <button
              key={t.label}
              onClick={() => setMaxActive(t.max)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${
                active ? "bg-char text-tile" : "bg-char/5 text-smoke"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <motion.button
        whileTap={{ scale: 0.97 }}
        transition={springUI}
        // Phase 1 stub: the page and nav ship first; generation is Phase 2.
        onClick={() => setNotYet(true)}
        disabled={!ask.trim()}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-flame py-3.5 font-display font-bold text-accent-ink disabled:opacity-40"
      >
        {meal ? "Make the meal" : "Make it"}
      </motion.button>
      <AnimatePresence>
        {notYet && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-3 rounded-xl border border-char/10 bg-surface p-4 text-sm text-smoke"
          >
            Recipe writing is coming in the next update — this is just the new page for now.
          </motion.p>
        )}
      </AnimatePresence>
    </main>
  );
}
