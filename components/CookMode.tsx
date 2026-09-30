"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Recipe } from "@/lib/types";
import { springSoft, springOvershoot } from "@/lib/springs";
import { CookTimer, useTimers } from "./CookTimer";
import { scaleIngredientQuantity } from "@/lib/scale";

/**
 * Full screen, one step at a time. Assumes greasy hands: large type, high
 * contrast, generous targets, wake lock on, and no accidental exits (§5).
 */
export function CookMode({ recipeId }: { recipeId: string }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [confirmExit, setConfirmExit] = useState(false);
  const { timers, add, toggle, dismiss, pulse } = useTimers();
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    fetch(`/api/recipes/${recipeId}`)
      .then((r) => r.json())
      .then((j) => setRecipe(j.recipe ?? null))
      .catch(() => {});
  }, [recipeId]);

  // Screen wake lock — re-acquired when returning from the app switcher.
  useEffect(() => {
    let cancelled = false;
    async function acquire() {
      try {
        if ("wakeLock" in navigator && document.visibilityState === "visible") {
          const sentinel = await navigator.wakeLock.request("screen");
          if (cancelled) return sentinel.release();
          wakeLock.current = sentinel;
        }
      } catch {
        // Unsupported or denied — cooking still works, the screen just sleeps.
      }
    }
    acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      wakeLock.current?.release().catch(() => {});
    };
  }, []);

  const steps = recipe?.steps ?? [];
  const step = steps[index];

  const go = useCallback(
    (delta: number) => {
      setDirection(delta);
      setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(steps.length - 1, 0)));
    },
    [steps.length]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  /** Ingredients relevant to this step, matched by name so they're visible without leaving it. */
  const stepIngredients = useMemo(() => {
    if (!recipe || !step) return [];
    const text = step.text.toLowerCase();
    return recipe.ingredients.filter((ing) => {
      const item = (ing.item || "").toLowerCase().trim();
      if (item.length < 3) return false;
      const head = item.split(/[ ,]/)[0];
      return head.length > 2 && text.includes(head);
    });
  }, [recipe, step]);

  if (!recipe) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-scrim text-chalk">
        <p className="animate-pulse text-sm opacity-60">Opening…</p>
      </div>
    );
  }

  if (!steps.length) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-scrim px-6 text-chalk">
        <p className="text-center">This recipe has no steps to walk through.</p>
        <button
          onClick={() => router.push(`/recipes/${recipeId}`)}
          className="rounded-full bg-chalk px-5 py-2.5 font-display font-bold text-scrim"
        >
          Back to the recipe
        </button>
      </div>
    );
  }

  const atEnd = index === steps.length - 1;

  return (
    // The night kitchen: cook mode is always dark, whatever the app theme.
    <motion.div
      animate={pulse && !reduce ? { scale: [1, 1.012, 1] } : {}}
      transition={{ duration: 0.45 }}
      className="fixed inset-0 z-[80] flex flex-col bg-scrim text-chalk"
    >
      <div className="flex shrink-0 items-center justify-between px-4 pt-[max(env(safe-area-inset-top),14px)]">
        <button
          onClick={() => setConfirmExit(true)}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-chalk/10 text-lg"
          aria-label="Exit cook mode"
        >
          ✕
        </button>
        <div className="flex-1 px-3">
          <div className="h-1 overflow-hidden rounded-full bg-chalk/15">
            <motion.div
              className="h-full rounded-full bg-flame"
              animate={{ width: `${((index + 1) / steps.length) * 100}%` }}
              transition={springSoft}
            />
          </div>
        </div>
        <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums opacity-70">
          {index + 1}/{steps.length}
        </span>
      </div>

      {timers.length > 0 && (
        <div className="no-scrollbar flex shrink-0 gap-2 overflow-x-auto px-4 pt-3">
          {timers.map((t) => (
            <CookTimer
              key={t.id}
              timer={t}
              compact
              onToggle={() => toggle(t.id)}
              onDismiss={() => dismiss(t.id)}
            />
          ))}
        </div>
      )}

      {/* Steps advance with depth: outgoing recedes and dims, incoming rises. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout" custom={direction}>
          <motion.div
            key={index}
            custom={direction}
            initial={{ opacity: 0, scale: 1.06, y: 30 * direction }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: -24 * direction }}
            transition={springSoft}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.16}
            onDragEnd={(_, info) => {
              if (info.offset.x < -70 && !atEnd) go(1);
              if (info.offset.x > 70 && index > 0) go(-1);
            }}
            className="absolute inset-0 overflow-y-auto px-6 py-6"
          >
            <p className="font-display text-[26px] font-bold leading-snug">{step.text}</p>

            {step.timer_seconds != null && (
              <div className="mt-5 inline-flex">
                <CookTimer
                  timer={{
                    id: "inline",
                    label: `${Math.round(step.timer_seconds / 60)} min`,
                    total: step.timer_seconds,
                    remaining: step.timer_seconds,
                    running: false,
                    done: false,
                  }}
                  onToggle={() =>
                    add(
                      `Step ${index + 1} · ${Math.round((step.timer_seconds ?? 0) / 60)} min`,
                      step.timer_seconds ?? 0
                    )
                  }
                  onDismiss={() => {}}
                />
              </div>
            )}

            {stepIngredients.length > 0 && (
              <div className="mt-6 rounded-2xl bg-chalk/8 p-4">
                <p className="text-xs font-bold uppercase tracking-widest opacity-50">
                  For this step
                </p>
                <ul className="mt-2 space-y-1">
                  {stepIngredients.map((ing, i) => {
                    const { display } = scaleIngredientQuantity(ing.quantity, ing.item, 1);
                    return (
                      <li key={i} className="text-[17px]">
                        <span className="font-semibold">
                          {display} {ing.unit ?? ""}
                        </span>{" "}
                        {ing.item}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Big targets, thumb-reachable, no accidental exits. */}
      <div className="flex shrink-0 gap-3 px-4 pb-[max(env(safe-area-inset-bottom),18px)] pt-3">
        <motion.button
          whileTap={{ scale: 0.96 }}
          transition={springOvershoot}
          onClick={() => go(-1)}
          disabled={index === 0}
          className="h-16 flex-1 rounded-2xl bg-chalk/10 font-display text-lg font-bold disabled:opacity-25"
        >
          Back
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.96 }}
          transition={springOvershoot}
          onClick={() => (atEnd ? setConfirmExit(true) : go(1))}
          className="h-16 flex-[2] rounded-2xl bg-flame font-display text-lg font-bold text-accent-ink"
        >
          {atEnd ? "Done" : "Next"}
        </motion.button>
      </div>

      <AnimatePresence>
        {confirmExit && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmExit(false)}
              className="absolute inset-0 bg-scrim/70"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={springSoft}
              className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-tile p-5 pb-[max(env(safe-area-inset-bottom),20px)] text-char"
            >
              <p className="font-display text-lg font-bold">
                {atEnd ? "Nice." : "Leave cook mode?"}
              </p>
              <p className="mt-1 text-sm text-smoke">
                {atEnd
                  ? "Log it so you remember you made this."
                  : "Your timers will stop."}
              </p>
              <div className="mt-4 space-y-2">
                <button
                  onClick={async () => {
                    await fetch(`/api/recipes/${recipeId}/cook`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({}),
                    });
                    router.push(`/recipes/${recipeId}`);
                  }}
                  className="w-full rounded-xl bg-flame py-3.5 font-display font-bold text-accent-ink"
                >
                  I made this
                </button>
                <button
                  onClick={() => router.push(`/recipes/${recipeId}`)}
                  className="w-full rounded-xl bg-char/5 py-3 font-display font-bold"
                >
                  Just exit
                </button>
                <button
                  onClick={() => setConfirmExit(false)}
                  className="w-full py-2 text-sm text-smoke"
                >
                  Keep cooking
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
