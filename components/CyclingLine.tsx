"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

/**
 * Cycles a line so a wait has a pulse to it. Fixed height and one absolutely
 * positioned line: the copy swaps without anything resizing under it, and
 * nothing can wrap onto a second.
 */
export function CyclingLine({
  lines,
  start = 0,
  className,
}: {
  lines: readonly string[];
  /** The button wants to open on its first line; the modal would rather not. */
  start?: number;
  className: string;
}) {
  const [i, setI] = useState(start);

  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % lines.length), 2400);
    return () => clearInterval(t);
  }, [lines.length]);

  return (
    <span className={`relative block ${className}`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.22 }}
          className="absolute inset-x-0 block truncate"
        >
          {lines[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
