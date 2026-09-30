"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { springOvershoot, springUI } from "@/lib/springs";

/** Eight sparks, fixed angles — deterministic so the burst reads the same every time. */
const SPARKS = Array.from({ length: 8 }, (_, i) => {
  const angle = (i / 8) * Math.PI * 2;
  return { x: Math.cos(angle) * 26, y: Math.sin(angle) * 26 };
});

/**
 * Loving a recipe is the one purely expressive thing in the app — no list to
 * file, nothing to plan, just "this one was good". So the tap gets more than a
 * state change: the heart punches past its size and settles, a ring pushes out
 * behind it, and eight sparks throw outward and fade.
 *
 * Un-loving is deliberately quiet. Celebrating a removal reads as sarcasm.
 */
export function LoveButton({
  loved,
  onToggle,
}: {
  loved: boolean;
  onToggle: () => void;
}) {
  // Bumped on each love so the burst can replay; the key remounts the effects.
  const [burst, setBurst] = useState(0);

  return (
    <button
      onClick={() => {
        if (!loved) setBurst((b) => b + 1);
        onToggle();
      }}
      aria-label={loved ? "Remove from loved" : "Love this recipe"}
      aria-pressed={loved}
      className="relative flex h-9 w-9 touch-manipulation items-center justify-center rounded-full bg-scrim/60 backdrop-blur"
    >
      {/* Sparks and ring sit behind the heart and ignore pointer events so they
          can overflow the button without eating the next tap. */}
      <AnimatePresence>
        {burst > 0 && (
          <motion.span
            key={`ring-${burst}`}
            initial={{ scale: 0.4, opacity: 0.6 }}
            animate={{ scale: 2.1, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            onAnimationComplete={() => setBurst(0)}
            className="pointer-events-none absolute inset-0 rounded-full border-2 border-flame"
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {burst > 0 &&
          SPARKS.map((s, i) => (
            <motion.span
              key={`spark-${burst}-${i}`}
              initial={{ x: 0, y: 0, scale: 0.4, opacity: 1 }}
              animate={{ x: s.x, y: s.y, scale: 0, opacity: 0 }}
              transition={{ duration: 0.55, ease: "easeOut" }}
              className="pointer-events-none absolute h-1.5 w-1.5 rounded-full bg-flame"
            />
          ))}
      </AnimatePresence>

      <motion.span
        // Keyed on loved so the punch replays on each transition rather than
        // only on mount.
        key={String(loved)}
        initial={loved ? { scale: 0.5 } : false}
        animate={{ scale: 1 }}
        transition={loved ? springOvershoot : springUI}
        className={`relative text-xl leading-none ${loved ? "text-flame" : "text-chalk"}`}
      >
        {loved ? "♥" : "♡"}
      </motion.span>
    </button>
  );
}
