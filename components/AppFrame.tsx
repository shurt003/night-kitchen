"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { SideMenu } from "./SideMenu";
import { Nav } from "./Nav";
import { FlyToList } from "./FlyToList";

/**
 * The menu is a *push* drawer: the page slides right to reveal a drawer sitting
 * underneath it, rather than the drawer sliding in on top. That means the drawer
 * and everything that has to travel with the page (the page itself, the bottom
 * nav, the hamburger) need to share one open state — hence this frame.
 */
export const DRAWER_WIDTH = "min(78vw, 20rem)";

type MenuState = {
  open: boolean;
  setOpen: (v: boolean) => void;
  shift?: string;
  /** True while the drawer is showing, including the slide back. */
  elevated: boolean;
};
const MenuContext = createContext<MenuState>({
  open: false,
  setOpen: () => {},
  elevated: false,
});
export const useMenu = () => useContext(MenuContext);

/** The easing and duration everything that slides shares, so nothing drifts apart. */
export const SLIDE =
  "transition-transform duration-[420ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";

export function AppFrame({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // Lags `open` by the slide duration so the shell keeps covering the drawer
  // while it travels back, then drops its z-index again.
  const [elevated, setElevated] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (open) {
      setElevated(true);
      return;
    }
    const t = setTimeout(() => setElevated(false), 450);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Left undefined when closed on purpose: a transform — even translateX(0) —
  // makes this element the containing block for its fixed descendants, which
  // would break any full-screen overlay rendered inside a page.
  const shift = open ? `translateX(${DRAWER_WIDTH})` : undefined;

  return (
    <MenuContext.Provider value={{ open, setOpen, shift, elevated }}>
      <SideMenu />

      {/* Full-width and opaque so it hides the drawer completely when closed,
          at any viewport width — the page itself stays centred inside it.
          The z-index is only applied while the drawer shows: a z-index creates
          a stacking context, which would trap every sheet rendered inside a
          page below the bottom nav. */}
      <div
        className={`relative min-h-dvh w-full bg-tile ${elevated ? "z-30" : ""} ${SLIDE}`}
        style={{ transform: shift }}
      >
        <div className="mx-auto max-w-2xl pb-24">{children}</div>
      </div>

      {/* Dims the pushed-aside page and catches taps on it. Starts where the
          drawer ends so the drawer itself stays interactive, and sits below
          the close button (z-40) so that stays lit and tappable above it.
          Anything fixed *inside* the page is already covered without help:
          the shell's own transform makes it a stacking context, so a sheet's
          z-40 is scoped under the shell's z-30 rather than competing here.

          Always mounted rather than toggled, so the dim can fade both ways in
          step with the slide instead of snapping in on mount. Animated here
          rather than by CSS transition like the slide is: a cross-fade isn't
          the kind of motion reduce-motion is protecting against, and every
          other scrim in the app fades this way. */}
      <motion.button
        aria-label="Close menu"
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        onClick={() => setOpen(false)}
        initial={false}
        animate={{ opacity: open ? 0.5 : 0 }}
        transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
        className={`fixed inset-y-0 right-0 z-[35] cursor-default bg-scrim ${
          open ? "" : "pointer-events-none"
        }`}
        style={{ left: DRAWER_WIDTH }}
      />

      <Nav />
      <FlyToList />
    </MenuContext.Provider>
  );
}
