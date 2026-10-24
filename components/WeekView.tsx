"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { springSoft } from "@/lib/springs";
import { usesTitles, type WeekOutline } from "@/lib/weekPlan";
import { GamePlan } from "./GamePlan";
import { SwapPanel } from "./SwapPanel";

/** A recipe slot in the week: written (and maybe saved), still writing, or failed. */
export type WeekSlot = { state: "ready"; saved: boolean } | { state: "failed" } | { state: "missing" };

/**
 * A planned week, laid out for a week rather than a meal: the prep session
 * and its bulk components first, then one card per night by weekday — each
 * night its own recipe, so Swap always means just that night. Shared by the
 * Make results and a saved week in the Library.
 */
export function WeekView({
  outline,
  prepDay,
  componentSlot,
  nightSlot,
  onOpenComponent,
  onOpenNight,
  onSwapNight,
  onRetry,
}: {
  outline: WeekOutline;
  /** "Sun", or null when there's no separate prep day. */
  prepDay: string | null;
  componentSlot: (key: string) => WeekSlot;
  nightSlot: (night: number) => WeekSlot;
  onOpenComponent: (key: string) => void;
  onOpenNight: (night: number) => void;
  onSwapNight?: (night: number, hint: string) => void;
  /** Rewrite a recipe that failed to write. */
  onRetry?: (ref: { component: string } | { night: number }) => void;
}) {
  const [swapAt, setSwapAt] = useState<number | null>(null);
  const labelOf = (n: number) => outline.nights.find((x) => x.night === n)?.label ?? `Night ${n}`;

  return (
    <div className="space-y-4">
      {outline.components.length > 0 && (
        <section className="rounded-[14px] border border-char/10 bg-surface p-3">
          <p className="font-display text-xs font-bold uppercase tracking-widest text-flame">
            {prepDay ? `Prep · ${prepDay}` : "Cook ahead"}
          </p>
          <p className="mt-0.5 text-sm text-smoke">
            Made once, used through the week{prepDay ? "" : " — cook these on the first night"}.
          </p>
          <ul className="mt-2 space-y-1.5">
            {outline.components.map((c) => {
              const slot = componentSlot(c.key);
              return (
                <li key={c.key}>
                  <button
                    onClick={() => (slot.state === "failed" ? onRetry?.({ component: c.key }) : onOpenComponent(c.key))}
                    disabled={slot.state === "missing"}
                    className="w-full rounded-[10px] bg-char/5 px-3 py-2.5 text-left disabled:opacity-60"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 font-display text-[15px] font-bold">{c.title}</span>
                      <SlotNote slot={slot} />
                    </span>
                    <span className="mt-0.5 block text-xs text-smoke">
                      {c.makes}
                      {c.used_on.length > 0 && ` · for ${c.used_on.map(labelOf).join(", ")}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {outline.prep_plan && outline.prep_plan.length > 0 && (
            <div className="mt-3">
              <GamePlan steps={outline.prep_plan} title="Prep session" />
            </div>
          )}
        </section>
      )}

      <ul className="space-y-2">
        {outline.nights.map((n, i) => {
          const slot = nightSlot(n.night);
          const uses = usesTitles(outline, n);
          const reheat = n.kind === "reheat";
          return (
            <motion.li
              key={`${n.night}-${n.title}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springSoft, delay: i * 0.03 }}
              className="rounded-[14px] border border-char/10 bg-surface"
            >
              <button
                onClick={() =>
                  slot.state === "failed" ? onRetry?.({ night: n.night }) : !reheat && onOpenNight(n.night)
                }
                disabled={reheat || slot.state === "missing"}
                className="flex w-full gap-3 p-3 pb-2 text-left disabled:cursor-default"
              >
                <span className="w-10 shrink-0 pt-0.5 font-display text-sm font-bold uppercase text-flame">
                  {n.label}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[15px] font-bold leading-snug">{n.title}</span>
                  {n.hook && <span className="mt-0.5 line-clamp-2 text-xs text-smoke">{n.hook}</span>}
                </span>
              </button>
              {/* One trimmed line rather than chips: prep items have long names
                  ("Charred roasted vegetable tray") that wrapped into a tall stack. */}
              {uses.length > 0 && (
                <p className="truncate px-3 pl-[64px] text-xs text-smoke">Uses {uses.join(" · ")}</p>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 pb-3 pl-[64px] pt-1.5 text-xs">
                {n.tonight_min != null && <span className="text-smoke">{n.tonight_min} min tonight</span>}
                {n.kind !== "cook" && n.from_night && (
                  <span className="font-semibold text-herb">
                    {reheat ? `Leftovers from ${labelOf(n.from_night)}` : `Remix of ${labelOf(n.from_night)}`}
                  </span>
                )}
                {!reheat && <SlotNote slot={slot} />}
                {onSwapNight && (
                  <button
                    onClick={() => setSwapAt((cur) => (cur === n.night ? null : n.night))}
                    className={`ml-auto rounded-full px-3 py-1 font-semibold ${
                      swapAt === n.night ? "bg-char text-tile" : "bg-char/5 text-char"
                    }`}
                  >
                    Swap
                  </button>
                )}
              </div>
              <AnimatePresence initial={false}>
                {swapAt === n.night && (
                  <SwapPanel
                    what={`${n.label} dinner`}
                    onSwap={(hint) => {
                      setSwapAt(null);
                      onSwapNight?.(n.night, hint);
                    }}
                  />
                )}
              </AnimatePresence>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}

function SlotNote({ slot }: { slot: WeekSlot }) {
  if (slot.state === "failed") return <span className="text-xs font-semibold text-flame">Didn&apos;t write — tap to retry</span>;
  if (slot.state === "missing") return <span className="text-xs text-smoke">Writing…</span>;
  return slot.saved ? <span className="text-xs font-semibold text-herb">✓ Saved</span> : null;
}
