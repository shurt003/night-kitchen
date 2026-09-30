"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { springUI } from "@/lib/springs";

/**
 * Pull down at the top of the page to force a sync.
 *
 * The grocery list polls on its own, but two people shopping the same list
 * want a way to say "no, right now" — this is that gesture, and it's the one
 * everybody already knows.
 *
 * Notes on the mechanics:
 *  - Listeners are attached natively with { passive: false }; React registers
 *    touchmove as passive, so preventDefault from a JSX handler is ignored and
 *    the page scrolls underneath the pull.
 *  - The wrapper must not contain anything `fixed` — a transform on it becomes
 *    the containing block for fixed descendants, which would drag sheets and
 *    toasts down with the pull.
 */

const THRESHOLD = 64; // pull past this and the release refreshes
const REST = 64; // where the content parks while the refresh runs — far enough
// down that the indicator (which hangs 48px above the content) clears the top
// of the screen instead of being half cut off
const MAX = 110; // asymptote of the rubber band
const MIN_SPIN_MS = 450; // a sync that returns instantly still reads as "it did something"

export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<unknown> | unknown;
  children: React.ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Handlers are bound once and read live state through refs.
  const refreshingRef = useRef(false);
  const pullRef = useRef(0);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    // State updates are batched, so the distance is tracked in a ref too —
    // touchend has to read the pull it just set.
    const applyPull = (v: number) => {
      pullRef.current = v;
      setPull(v);
    };

    let startY = 0;
    let startX = 0;
    // 0 = still deciding, 1 = this gesture is a pull, -1 = it's a scroll/swipe
    let intent = 0;

    const reachedTop = () => window.scrollY <= 0;

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current || e.touches.length !== 1) {
        intent = -1;
        return;
      }
      intent = 0;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
    };

    const onMove = (e: TouchEvent) => {
      if (intent === -1) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;

      if (intent === 0) {
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return; // too small to read
        // Sideways, upward, or not actually at the top: leave it to the page.
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || !reachedTop()) {
          intent = -1;
          return;
        }
        intent = 1;
        startY = e.touches[0].clientY; // re-zero so the pull starts from here
        setDragging(true);
      }

      // Strictly negative, not <= 0: startY was just re-zeroed to this very
      // point, so the move that starts the pull travels exactly 0.
      const travelled = e.touches[0].clientY - startY;
      if (travelled < 0) {
        // Reversed above where the pull began — hand the gesture back.
        intent = -1;
        setDragging(false);
        applyPull(0);
        return;
      }
      // Rubber band: eases toward MAX so it never feels like a free drag.
      applyPull(MAX * (1 - Math.exp(-travelled / MAX)));
      e.preventDefault();
    };

    const onEnd = async () => {
      if (intent !== 1) {
        intent = 0;
        return;
      }
      intent = 0;
      setDragging(false);

      const armed = pullRef.current >= THRESHOLD;
      applyPull(armed ? REST : 0);
      if (!armed) return;

      refreshingRef.current = true;
      setRefreshing(true);
      const started = Date.now();
      try {
        await onRefreshRef.current();
      } catch {
        // A failed sync is the op queue's problem; the gesture just ends.
      }
      const held = Date.now() - started;
      if (held < MIN_SPIN_MS) await new Promise((r) => setTimeout(r, MIN_SPIN_MS - held));
      refreshingRef.current = false;
      setRefreshing(false);
      applyPull(0);
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  // Kills iOS's own rubber-band bounce for as long as this page is mounted, so
  // the pull moves our content instead of the whole viewport. Scoped to the
  // mount rather than set globally — every other page still bounces normally.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = "contain";
    return () => {
      root.style.overscrollBehaviorY = previous;
    };
  }, []);

  const progress = Math.min(pull / THRESHOLD, 1);
  const armed = pull >= THRESHOLD;

  return (
    <motion.div
      ref={host}
      // While the finger is down the content tracks it exactly — a spring here
      // would lag the pull. The spring is only for the release.
      animate={{ y: pull }}
      transition={dragging ? { duration: 0 } : springUI}
      className="relative"
    >
      {/* Sits above the content and rides down with it. aria-hidden: the list
          itself updating is the feedback that matters to a screen reader. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-12 flex justify-center"
        style={{ opacity: refreshing ? 1 : progress }}
      >
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-full bg-surface shadow-sm transition-colors ${
            armed || refreshing ? "text-flame" : "text-smoke"
          }`}
          style={{ transform: `scale(${refreshing ? 1 : 0.7 + progress * 0.3})` }}
        >
          {refreshing ? (
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />
          ) : (
            // Arrow flips to point up once you're past the threshold — the
            // "let go now" tell, without a word of copy.
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4 transition-transform duration-200"
              style={{ transform: `rotate(${armed ? 180 : 0}deg)` }}
            >
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          )}
        </span>
      </div>

      {children}
    </motion.div>
  );
}
