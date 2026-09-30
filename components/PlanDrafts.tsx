"use client";

import { motion } from "motion/react";
import { springUI } from "@/lib/springs";
import { RecipeImage } from "./RecipeImage";

export type ProposalOption = {
  source_type: "recipe" | "quick_meal" | "idea";
  id: string | null;
  reason: string;
  title: string;
  image_url: string | null;
  time_active_min: number | null;
  /** idea only: on-hand items it leans on / the few things to buy. */
  uses: string[];
  needs: string[];
  ingredients: { item: string; quantity: string | null }[];
};

export type PlanProposal = { date: string; options: ProposalOption[] };

/**
 * A suggestion sitting in its night on the week itself — not a modal. The row
 * uses the grid's one grammar: ✕ removes it from the night (same as clearing a
 * committed meal), the row displays, buttons act. Alternates are visible as
 * Option A / Option B pills you jump between directly ("Swap" read as trading
 * between nights), and "Something else" fetches one fresh scoped suggestion.
 */
export function PlanDraftRow({
  option,
  optionIdx,
  optionCount,
  canFetchMore,
  swapping,
  onSelect,
  onFetchNew,
  onSkip,
}: {
  option: ProposalOption;
  optionIdx: number;
  optionCount: number;
  /** Below the per-night cap — the "Something else" pill is still offered. */
  canFetchMore: boolean;
  swapping: boolean;
  onSelect: (idx: number) => void;
  onFetchNew: () => void;
  onSkip: () => void;
}) {
  const isIdea = option.source_type === "idea";
  return (
    <div className={swapping ? "opacity-60" : ""}>
      <div className="flex items-start gap-2.5">
        <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-char/5">
          {option.image_url ? (
            <RecipeImage src={option.image_url} />
          ) : (
            <span className="flex h-full items-center justify-center text-xl">
              {isIdea ? "🍳" : "🍽️"}
            </span>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            {/* Two lines, not one: while deciding, the title IS the pitch. */}
            <p className="min-w-0 flex-1 font-display text-[15px] font-bold leading-snug [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
              {option.title}
            </p>
            {/* A real 36px target — skip is a frequent action, not a corner case. */}
            <button
              onClick={onSkip}
              aria-label="Skip this suggestion"
              className="-mr-2.5 -mt-2 flex h-9 w-9 shrink-0 items-center justify-center text-smoke/60"
            >
              ✕
            </button>
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-smoke">
            <span className="font-semibold text-flame/90">suggested</span>
            {option.time_active_min != null && <span>{option.time_active_min}m active</span>}
            {option.source_type === "quick_meal" && <span>quick meal</span>}
            {isIdea && <span>from what you have</span>}
          </div>
        </div>
      </div>

      {isIdea && (option.uses.length > 0 || option.needs.length > 0) && (
        <div className="mt-1.5 space-y-0.5 text-xs text-smoke">
          {option.uses.length > 0 && (
            <p className="line-clamp-1">
              <span className="font-semibold">uses:</span> {option.uses.join(", ")}
            </p>
          )}
          {option.needs.length > 0 && (
            <p className="line-clamp-1">
              <span className="font-semibold text-flame/80">buy:</span>{" "}
              {option.needs.join(", ")}
            </p>
          )}
        </div>
      )}

      {/* Never clamped — the reason is the pitch, and a cut-off pitch reads
          as a broken card, not a teaser. */}
      {option.reason && (
        <p className="mt-1.5 text-xs italic leading-snug text-smoke">{option.reason}</p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {Array.from({ length: optionCount }, (_, i) => (
          <motion.button
            key={i}
            whileTap={{ scale: 0.95 }}
            transition={springUI}
            onClick={() => onSelect(i)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              i === optionIdx ? "bg-char text-tile" : "bg-char/8 text-smoke"
            }`}
          >
            Option {String.fromCharCode(65 + i)}
          </motion.button>
        ))}
        {canFetchMore && (
          <motion.button
            whileTap={{ scale: 0.95 }}
            transition={springUI}
            onClick={onFetchNew}
            disabled={swapping}
            className={`rounded-full bg-char/8 px-3 py-1.5 text-xs font-semibold text-smoke ${
              swapping ? "animate-pulse" : ""
            }`}
          >
            {swapping ? "Thinking…" : "↻ Something else"}
          </motion.button>
        )}
      </div>
    </div>
  );
}

/** The dashed shell's content while a night's suggestion is being fetched. */
export function DraftSkeleton({ weekday }: { weekday: string }) {
  return (
    <div className="animate-pulse py-1">
      <div className="h-3.5 w-2/3 rounded bg-char/10" />
      <div className="mt-2 h-3 w-5/6 rounded bg-char/5" />
      <p className="mt-2 text-xs text-smoke">Thinking about {weekday}…</p>
    </div>
  );
}

/**
 * The one place drafts become real. Sits above the bottom nav while there's
 * anything to decide; after applying, the same bar morphs into the grocery
 * offer — the follow-up arrives where the person is already looking, instead
 * of a popup.
 */
export function PlanCommitBar({
  phase,
  count,
  singleLabel,
  busy,
  onApply,
  onDiscard,
  onShowList,
  onDismissOffer,
}: {
  phase: "review" | "offer";
  count: number;
  /** Weekday name when exactly one draft, e.g. "Tuesday". */
  singleLabel: string | null;
  busy: boolean;
  onApply: () => void;
  onDiscard: () => void;
  onShowList: () => void;
  onDismissOffer: () => void;
}) {
  return (
    <motion.div
      initial={{ y: 90, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 90, opacity: 0 }}
      transition={springUI}
      className="fixed inset-x-0 bottom-[calc(max(env(safe-area-inset-bottom),12px)+64px)] z-40 mx-auto max-w-2xl px-4"
    >
      <div className="flex items-center gap-2 rounded-2xl bg-char p-2.5 shadow-lg shadow-scrim/20">
        {phase === "review" ? (
          <>
            <button
              onClick={onDiscard}
              disabled={busy}
              className="rounded-full px-3 py-2.5 text-sm font-semibold text-tile/60"
            >
              Discard
            </button>
            <motion.button
              whileTap={{ scale: 0.97 }}
              transition={springUI}
              onClick={onApply}
              disabled={busy || count === 0}
              className="flex-1 rounded-xl bg-flame py-2.5 font-display text-sm font-bold text-accent-ink disabled:opacity-40"
            >
              {busy
                ? "Adding…"
                : count === 1 && singleLabel
                  ? `Add ${singleLabel} to the plan`
                  : `Add ${count} nights to the plan`}
            </motion.button>
          </>
        ) : (
          <>
            <div className="min-w-0 flex-1 pl-1.5">
              <p className="text-sm font-bold text-tile">On the plan ✓</p>
              <p className="truncate text-xs text-tile/70">
                Put the ingredients on your list?
              </p>
            </div>
            <button
              onClick={onDismissOffer}
              className="rounded-full px-3 py-2.5 text-sm font-semibold text-tile/60"
            >
              Not now
            </button>
            <motion.button
              whileTap={{ scale: 0.97 }}
              transition={springUI}
              onClick={onShowList}
              className="rounded-xl bg-flame px-4 py-2.5 font-display text-sm font-bold text-accent-ink"
            >
              Show me
            </motion.button>
          </>
        )}
      </div>
    </motion.div>
  );
}
