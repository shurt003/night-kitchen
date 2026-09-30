"use client";

import { MotionConfig } from "motion/react";

/**
 * reducedMotion="user" makes Motion honour the OS setting everywhere (§7):
 * transforms are dropped in favour of opacity, durations are kept, and layout
 * never breaks. A client wrapper because the root layout is a server component.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
