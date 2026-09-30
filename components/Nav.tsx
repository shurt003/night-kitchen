"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { springUI, springOvershoot } from "@/lib/springs";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { SLIDE, useMenu } from "./AppFrame";

// Measure before paint on the client; fall back to a no-op on the server so
// the isomorphic call doesn't warn during SSR.
const useMeasureEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function Nav() {
  const pathname = usePathname();
  const { shift, elevated } = useMenu();
  const [absorbed, setAbsorbed] = useState(0);
  const [keyboardUp, setKeyboardUp] = useState(false);
  // The active-tab pill is ONE element that slides to the active tab, sized and
  // positioned from the measured tab geometry — not a framer `layoutId` shared
  // element. layoutId leans on framer's global layout-projection tree, which a
  // Next route transition (and the recipe sheet's own layout animations) can
  // leave with a stale snapshot, making the pill briefly vanish and slide in
  // from the wrong place on the first tab change after one. A self-contained
  // element that just animates its own x/width has no shared state to corrupt.
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [pill, setPill] = useState<
    { left: number; top: number; width: number; height: number } | null
  >(null);

  const measurePill = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const active = row.querySelector<HTMLElement>('[data-nav-tab][data-active="true"]');
    // Wrap the label itself, not the (taller, tap-friendly) button, so the pill
    // carries a visible, even 5px of padding on every side rather than a fixed
    // inset the button padding can't influence.
    const label = active?.querySelector<HTMLElement>("[data-nav-label]");
    if (!active || !label) {
      setPill(null);
      return;
    }
    const l = label.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    // A pill reads best with more room on the sides than top/bottom. These wrap
    // the label so the active tab's highlight is visibly, comfortably padded.
    const PAD_X = 14;
    const PAD_Y = 11;
    // Relative to the row, so the nav's own transforms (menu push) don't matter.
    setPill({
      left: l.left - r.left - PAD_X,
      top: l.top - r.top - PAD_Y,
      width: l.width + PAD_X * 2,
      height: l.height + PAD_Y * 2,
    });
  }, []);

  useMeasureEffect(measurePill, [measurePill, pathname]);

  // Labels can reflow after web fonts load or on rotate/resize — re-measure so
  // the pill keeps hugging its tab.
  useEffect(() => {
    window.addEventListener("resize", measurePill);
    document.fonts?.ready.then(measurePill).catch(() => {});
    return () => window.removeEventListener("resize", measurePill);
  }, [measurePill]);

  /**
   * The on-screen keyboard shrinks the visual viewport without moving the
   * layout viewport, so a bottom-fixed bar ends up stranded above the keys.
   * Measuring the gap is the only reliable signal — focus alone would also
   * fire for a hardware keyboard, where there's nothing to get out of the way
   * of. The 150px floor clears a collapsing URL bar, which is much smaller.
   */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const measure = () => setKeyboardUp(window.innerHeight - vv.height > 150);
    measure();
    vv.addEventListener("resize", measure);
    return () => vv.removeEventListener("resize", measure);
  }, []);

  // The badge reacts when flying items land, so a tap is trustworthy from anywhere.
  useEffect(() => {
    const onAbsorb = () => setAbsorbed((n) => n + 1);
    window.addEventListener("grocery-absorbed", onAbsorb);
    return () => window.removeEventListener("grocery-absorbed", onAbsorb);
  }, []);

  if (pathname === "/login" || pathname.startsWith("/cook/")) return null;

  const groceryActive = pathname.startsWith("/grocery");

  // Tabs are sized to their own label rather than equal slices: with labels as
  // uneven as "Plan" and "Grocery List", equal slices centre each one in its own
  // box and the gaps between the words come out visibly lopsided.
  const tab = (
    href: string,
    label: string,
    active: boolean,
    extra?: Record<string, string>,
    onClick?: (e: MouseEvent<HTMLAnchorElement>) => void
  ) => (
    <Link
      href={href}
      data-nav-tab=""
      data-active={active ? "true" : undefined}
      {...extra}
      onClick={onClick}
      className={`relative flex h-full shrink-0 items-center justify-center whitespace-nowrap p-[5px] text-[13px] font-medium ${
        active ? "text-accent-ink" : "text-smoke"
      }`}
    >
      <span data-nav-label className="relative z-10">{label}</span>
    </Link>
  );

  return (
    <>
      <nav
        style={{ transform: keyboardUp ? "translateY(140%)" : shift }}
        /**
         * Sits under the menu's dim (z-35) while the drawer shows, so the bar
         * darkens with the rest of the page instead of floating over it lit —
         * it's a sibling of the page shell, so its z-index competes at the
         * root rather than being scoped under the shell like a page's sheets.
         * Keyed to `elevated` rather than `open` so it stays under the dim
         * until the dim has finished fading, not just until the tap.
         */
        className={`fixed inset-x-0 bottom-0 ${
          elevated ? "z-[32]" : "z-40"
        } mx-auto max-w-2xl px-4 pb-[max(env(safe-area-inset-bottom),12px)] ${SLIDE}`}
      >
        <div
          ref={rowRef}
          className="relative flex h-14 items-stretch justify-around rounded-full border border-char/10 bg-tile/90 shadow-lg shadow-scrim/10 backdrop-blur"
        >
          {/* The active-tab pill: one element that slides between tabs. `initial:
              false` so its first appearance snaps to the active tab instead of
              flying in from the corner; later moves animate. */}
          {pill && (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute left-0 top-0 z-0 rounded-full bg-flame"
              initial={false}
              animate={{ x: pill.left, y: pill.top, width: pill.width, height: pill.height }}
              transition={springUI}
            />
          )}
          {/* Tapping Library also closes an open recipe sheet — the sheet is
              client state pushed to /recipes/[id] via history, which a Link to
              "/" won't unwind on its own. */}
          {tab(
            "/",
            "Library",
            pathname === "/" || pathname.startsWith("/recipes"),
            undefined,
            (e) => {
              // With a recipe sheet open the URL is /recipes/[id], but that was a
              // shallow pushState — LibraryApp is still mounted, and closeDetail
              // pops it back to "/" the same shallow way. Letting the Link also
              // navigate would remount LibraryApp (refetching the grid, losing
              // scroll) just to land where we already are. Suppress it and let the
              // close handler alone drive the URL.
              if (pathname.startsWith("/recipes")) e.preventDefault();
              window.dispatchEvent(new CustomEvent("library-tab-tapped"));
            }
          )}
          {tab("/plan", "Plan", pathname.startsWith("/plan"))}
          {tab("/pantry", "Wing it", pathname.startsWith("/pantry"))}
          <div className="relative flex shrink-0">
            {tab("/grocery", "Grocery List", groceryActive, {
              "data-grocery-tab": "true",
            })}
            <AnimatePresence>
              {absorbed > 0 && (
                <motion.span
                  key={absorbed}
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: [0.4, 1.35, 1], opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={springOvershoot}
                  onAnimationComplete={() => setTimeout(() => setAbsorbed(0), 1200)}
                  // Flame on flame is invisible, so the dot flips to chalk once
                  // the pill is sitting underneath it.
                  className={`pointer-events-none absolute right-2 top-1.5 h-2.5 w-2.5 rounded-full ${
                    groceryActive ? "bg-chalk" : "bg-flame"
                  }`}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </nav>
    </>
  );
}
