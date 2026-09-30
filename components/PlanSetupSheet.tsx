"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { dayLabel, isToday } from "@/lib/week";
import { springUI } from "@/lib/springs";
import { PLAN_SOURCE_KEY } from "@/lib/userCache";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import type { PlanSource } from "@/app/api/planner/generate/route";

const SOURCES: { key: PlanSource; label: string; hint: string }[] = [
  { key: "mix", label: "Mix", hint: "Saved recipes + ideas from what you have" },
  { key: "library", label: "My library", hint: "Only recipes and quick meals you've saved" },
  { key: "on_hand", label: "What's on hand", hint: "Invent dinners from staples + your list" },
];

/**
 * The pre-flight step before proposing a week: which nights, and from where.
 * Nights start UNSELECTED on purpose — picking the 3 you'll actually cook is
 * lighter than deselecting the 4 you won't, and unpicked nights are the
 * planner's answer to leftovers, takeout, and plans: it leaves them alone.
 */
export function PlanSetupSheet({
  emptyDates,
  onClose,
  onSubmit,
}: {
  emptyDates: string[];
  onClose: () => void;
  onSubmit: (dates: string[], source: PlanSource) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useBodyScrollLock();
  // Sticky preference: the source you planned from last time is probably the
  // one you'll plan from this time. (Sheet only mounts client-side, so the
  // lazy read never runs during SSR.)
  const [source, setSource] = useState<PlanSource>(() => {
    try {
      const s = localStorage.getItem(PLAN_SOURCE_KEY);
      if (s === "library" || s === "on_hand" || s === "mix") return s;
    } catch {}
    return "mix";
  });

  function toggle(date: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  const hint = SOURCES.find((s) => s.key === source)?.hint ?? "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-scrim/40"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={springUI}
        className="relative w-full max-w-sm rounded-3xl bg-tile p-5 shadow-2xl"
      >
        <h2 className="font-display text-xl font-bold">Plan this week</h2>

        <p className="mt-3 text-sm font-semibold">Which nights are you cooking?</p>
        <p className="mt-0.5 text-xs text-smoke">
          Skip nights for leftovers, takeout, or plans — they&apos;ll be left alone.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {emptyDates.map((date) => {
            const { weekday, day } = dayLabel(date);
            const on = selected.has(date);
            return (
              <motion.button
                key={date}
                whileTap={{ scale: 0.93 }}
                transition={springUI}
                onClick={() => toggle(date)}
                className={`flex h-14 w-12 flex-col items-center justify-center rounded-xl border text-center transition-colors ${
                  on
                    ? "border-flame bg-flame text-accent-ink"
                    : isToday(date)
                      ? "border-flame/40 bg-surface"
                      : "border-char/15 bg-surface"
                }`}
              >
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wide ${
                    on ? "text-chalk/80" : "text-smoke"
                  }`}
                >
                  {weekday}
                </span>
                <span className="font-display text-base font-bold leading-tight">{day}</span>
              </motion.button>
            );
          })}
        </div>

        <p className="mt-4 text-sm font-semibold">Cook from</p>
        <div className="mt-2 flex gap-2">
          {SOURCES.map((s) => (
            <button
              key={s.key}
              onClick={() => setSource(s.key)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                source === s.key ? "bg-char text-tile" : "bg-char/5 text-smoke"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 min-h-[1rem] text-xs text-smoke">{hint}</p>

        <motion.button
          whileTap={{ scale: 0.97 }}
          transition={springUI}
          onClick={() => {
            try {
              localStorage.setItem(PLAN_SOURCE_KEY, source);
            } catch {}
            onSubmit([...selected], source);
          }}
          disabled={selected.size === 0}
          className="mt-5 w-full rounded-xl bg-flame py-3.5 font-display text-base font-bold text-accent-ink disabled:opacity-40"
        >
          {selected.size === 0
            ? "Pick a night to plan"
            : `Suggest ${selected.size} dinner${selected.size === 1 ? "" : "s"}`}
        </motion.button>
      </motion.div>
    </div>
  );
}
