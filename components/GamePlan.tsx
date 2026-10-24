"use client";

import { AnimatePresence, motion } from "motion/react";
import { formatClock, parseServeTime, stepTiming, type GamePlanStep } from "@/lib/gamePlan";

/**
 * A meal's game plan, with an optional "What time is dinner?" that turns each
 * step's "4 hours before" into a clock time. The time is the cook's to set (or
 * clear) once everything's written — it never blocks reading the plan.
 *
 * The time picker is a real <input type="time"> stretched invisibly over the
 * button, so a tap opens the phone's own time wheel directly.
 */
export function GamePlan({
  steps,
  serveTime = null,
  onServeTimeChange,
  title = "Game plan",
}: {
  steps: GamePlanStep[];
  /** "19:00", or null when no dinner time is set. */
  serveTime?: string | null;
  /** Leave out for a plan with no dinner to time against (a week's prep session). */
  onServeTimeChange?: (t: string | null) => void;
  title?: string;
}) {
  const serveMin = parseServeTime(serveTime);

  return (
    <div className="rounded-xl border border-char/10 bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-display text-sm font-bold">{title}</p>
        {onServeTimeChange && (
          <div className="flex items-center gap-1">
            <label className="relative cursor-pointer rounded-full bg-char/5 px-3 py-1.5 text-xs font-semibold text-char">
              {serveMin === null ? "What time is dinner?" : `Dinner at ${formatClock(serveMin)}`}
              <input
                type="time"
                value={serveTime ?? ""}
                onChange={(e) => onServeTimeChange(e.target.value || null)}
                aria-label="What time is dinner?"
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
            {serveMin !== null && (
              <button
                onClick={() => onServeTimeChange(null)}
                aria-label="Clear dinner time"
                className="flex h-7 w-7 items-center justify-center rounded-full text-sm text-smoke/70"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>
      <ol className="mt-2 space-y-2 text-sm">
        {steps.map((step, i) => {
          const timing = stepTiming(step, serveMin);
          return (
            <li key={i} className="flex gap-2.5">
              <span className="mt-px font-display font-bold text-flame">{i + 1}</span>
              <span>
                <AnimatePresence mode="wait" initial={false}>
                  {timing && (
                    // Keyed on the text so switching to clock times cross-fades
                    // rather than snapping.
                    <motion.span
                      key={timing}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="font-semibold"
                    >
                      {timing}:{" "}
                    </motion.span>
                  )}
                </AnimatePresence>
                {step.text}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
