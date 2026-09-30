"use client";

import { AnimatePresence, motion } from "motion/react";
import { springUI } from "@/lib/springs";

// Odometer-style rolling text: each character slot rolls up/down on change.
export function RollingNumber({ value, className }: { value: string; className?: string }) {
  const chars = value.split("");
  return (
    <span className={`inline-flex overflow-hidden ${className ?? ""}`} aria-label={value}>
      {chars.map((ch, i) => (
        <span key={i} className="relative inline-block" style={{ minWidth: "0.5ch" }}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={ch + i + chars.length}
              initial={{ y: "0.9em", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "-0.9em", opacity: 0 }}
              transition={springUI}
              className="inline-block"
            >
              {ch}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  );
}
