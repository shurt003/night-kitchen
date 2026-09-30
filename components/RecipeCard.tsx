"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Recipe } from "@/lib/types";
import { springOvershoot, springSoft, springUI } from "@/lib/springs";
import { useLongPress, HOLD_MS, HOLD_REVEAL_MS } from "@/lib/useLongPress";
import { RecipeImage } from "./RecipeImage";

/**
 * Placeholder shown while the library is loading, matching the real card's
 * shape exactly so nothing shifts when content arrives.
 */
export function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-[14px] border border-char/8 bg-surface/50">
      <div className="shimmer aspect-[4/3] bg-char/8" />
      <div className="space-y-2 p-3">
        <div className="shimmer h-3.5 w-4/5 rounded bg-char/8" />
        <div className="shimmer h-2.5 w-1/2 rounded bg-char/5" />
      </div>
    </div>
  );
}

/** Fills over the hold duration so the gesture shows its own progress. */
function HoldToDelete({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: 0.14, delay: HOLD_REVEAL_MS / 1000 }}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-[14px] bg-scrim/75"
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-chalk">
            Hold to delete
          </span>
          <span className="h-1 w-16 overflow-hidden rounded-full bg-chalk/25">
            <motion.span
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{
                duration: (HOLD_MS - HOLD_REVEAL_MS) / 1000,
                delay: HOLD_REVEAL_MS / 1000,
                ease: "linear",
              }}
              className="block h-full w-full origin-left bg-flame"
            />
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function faviconFor(url: string | null): string | null {
  if (!url) return null;
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`;
  } catch {
    return null;
  }
}

const materializeParent = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};
const materializeChild = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0, transition: springSoft },
};
const materializeImage = {
  hidden: { opacity: 0, scale: 1.08 },
  shown: { opacity: 1, scale: 1, transition: springSoft },
};

export function RecipeCard({
  recipe,
  onOpen,
  onRetry,
  onLongPress,
}: {
  recipe: Recipe;
  onOpen: (r: Recipe) => void;
  onRetry: (r: Recipe) => void;
  onLongPress: (r: Recipe) => void;
}) {
  const capturing = recipe.capture_status === "pending" || recipe.capture_status === "processing";
  const failed = recipe.capture_status === "failed";
  const press = useLongPress(() => onLongPress(recipe));

  // Detect the pending → ready flip while mounted: that's the moment the card
  // materializes in stages instead of just being there.
  const prevStatus = useRef(recipe.capture_status);
  const [justReady, setJustReady] = useState(false);
  useEffect(() => {
    if (
      (prevStatus.current === "pending" || prevStatus.current === "processing") &&
      recipe.capture_status === "ready"
    ) {
      setJustReady(true);
    }
    prevStatus.current = recipe.capture_status;
  }, [recipe.capture_status]);

  const favicon = faviconFor(recipe.source_url);
  const wantToTry = recipe.status === "want_to_try";

  if (capturing) {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={springOvershoot}
        className="capture-pulse overflow-hidden rounded-[14px] border border-char/10 bg-surface"
      >
        <div className="relative aspect-[4/3] bg-char/5">
          {favicon && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={favicon}
              alt=""
              className="absolute left-3 top-3 h-6 w-6 rounded-md"
            />
          )}
        </div>
        <div className="space-y-2 p-3">
          <div className="h-4 w-3/4 rounded bg-char/10" />
          <div className="h-3 w-1/2 rounded bg-char/5" />
        </div>
      </motion.div>
    );
  }

  if (failed) {
    return (
      <motion.div
        layout
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, scale: press.holding ? 0.96 : 1 }}
        transition={springUI}
        {...press.handlers}
        className="relative flex select-none flex-col justify-between rounded-[14px] border border-flame/30 bg-flame/5 p-3 [-webkit-touch-callout:none]"
      >
        <p className="text-sm text-char/80">{recipe.capture_error ?? "Extraction failed."}</p>
        <button
          onClick={(e) => {
            if (press.clickWasSuppressed()) return;
            e.stopPropagation();
            onRetry(recipe);
          }}
          className="mt-3 self-start rounded-full bg-flame px-4 py-1.5 text-sm font-semibold text-accent-ink"
        >
          Retry
        </button>
        <HoldToDelete visible={press.holding} />
      </motion.div>
    );
  }

  return (
    <motion.button
      layout
      variants={materializeParent}
      initial={justReady ? "hidden" : false}
      animate="shown"
      whileTap={{ scale: 0.96 }}
      transition={springOvershoot}
      onClick={() => {
        if (press.clickWasSuppressed()) return;
        onOpen(recipe);
      }}
      {...press.handlers}
      className={`relative select-none overflow-hidden rounded-[14px] border border-char/10 text-left [-webkit-touch-callout:none] ${
        wantToTry ? "bg-surface/60" : "bg-surface"
      }`}
    >
      <HoldToDelete visible={press.holding} />
      <motion.div variants={materializeImage} className="relative aspect-[4/3] bg-char/5">
        {/* The only thing allowed over the photo. */}
        {(recipe.hearts ?? 0) > 0 && (
          <motion.span
            layout
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={springOvershoot}
            aria-label="Loved"
            className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-surface text-sm leading-none text-flame shadow-sm shadow-scrim/20"
          >
            ♥
          </motion.span>
        )}
        {recipe.image_url ? (
          <RecipeImage src={recipe.image_url} layoutId={`img-${recipe.id}`} />
        ) : (
          <motion.div
            layoutId={`img-${recipe.id}`}
            className="flex h-full w-full items-center justify-center bg-gradient-to-br from-yolk/30 to-flame/20 font-display text-3xl font-bold text-char/30"
          >
            {recipe.title.slice(0, 1).toUpperCase()}
          </motion.div>
        )}
      </motion.div>
      <div className="p-3">
        <motion.h3
          layoutId={`title-${recipe.id}`}
          variants={materializeChild}
          className="font-display text-[15px] font-bold leading-snug"
        >
          {recipe.title}
        </motion.h3>
        <motion.div
          variants={materializeChild}
          className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-smoke"
        >
          {recipe.time_active_min != null && <span>{recipe.time_active_min}m active</span>}
          {recipe.tags.includes("generated") && (
            <span className="font-semibold text-char/45">invented</span>
          )}
        </motion.div>
      </div>
    </motion.button>
  );
}
