"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { springUI, springSoft } from "@/lib/springs";
import { useEffect, useState } from "react";
import { useTheme } from "@/lib/useTheme";
import { clearUserDataCaches } from "@/lib/userCache";
import { getShuffleEnabled, setShuffleEnabled } from "@/lib/libraryShuffle";
import { THEMES } from "@/lib/theme";
import { DRAWER_WIDTH, useMenu } from "./AppFrame";

/** Drawn rather than imported — the app has no icon set, just these two. */
function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      className="h-5 w-5"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4.25" />
      {/* Eight rays, placed by rotation so the spacing can't drift. */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
        <line key={deg} x1="12" y1="2.5" x2="12" y2="4.75" transform={`rotate(${deg} 12 12)`} />
      ))}
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden
    >
      <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z" />
    </svg>
  );
}

const LINKS = [
  { href: "/", label: "Library", hint: "Everything you've saved" },
  { href: "/plan", label: "Plan", hint: "The week ahead" },
  { href: "/grocery", label: "Grocery List", hint: "The running list" },
  { href: "/staples", label: "Staples", hint: "What you always keep in" },
  { href: "/pantry", label: "Wing it", hint: "What can I make right now" },
];

const panel = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.035, delayChildren: 0.06 } },
};
const row = {
  hidden: { opacity: 0, x: -14 },
  shown: { opacity: 1, x: 0, transition: springSoft },
};

export function SideMenu() {
  const pathname = usePathname();
  const router = useRouter();
  const { open, setOpen, elevated } = useMenu();
  const { setTheme, mounted, resolved, name, setThemeName, style, setThemeStyle } = useTheme();
  const isDark = resolved === "dark";

  // Local mirror of the "shuffle library" preference. Read after mount so it
  // matches what's stored without tripping SSR (localStorage is client-only).
  const [shuffle, setShuffle] = useState(false);
  useEffect(() => setShuffle(getShuffleEnabled()), []);
  function toggleShuffle() {
    const next = !shuffle;
    setShuffle(next);
    setShuffleEnabled(next);
  }

  if (pathname === "/login") return null;

  return (
    <>
      {/* Deliberately does NOT ride along with the page: it turns into the
          close button, and a control that changes meaning under your finger
          should at least stay under it. Pinned to the right edge, which the
          drawer never reaches — it sits in the strip of page still showing,
          above the dim (z-35). */}
      <div className="fixed right-3 top-[max(env(safe-area-inset-top),12px)] z-40">
        <motion.button
          whileTap={{ scale: 0.88 }}
          transition={springUI}
          onClick={() => setOpen(!open)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className="flex h-11 w-11 items-center justify-center"
        >
          {/* The button stays 44px for the touch target while the circle it
              draws is 36px, which is the size that sits right next to the page
              title. Shrinking the button itself would drop below the minimum. */}
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-flame text-accent-ink">
            {/* Two bars, positioned rather than stacked so they rotate about a
                shared centre into an X. The lower bar is short on purpose: two
                equal bars at this size read as an equals sign, not a menu.
                It grows to full width on open so the X comes out symmetrical. */}
            <span className="relative h-3 w-[15px]">
              {[-4, 4].map((offset, i) => (
                <motion.span
                  key={offset}
                  style={{ marginTop: -0.75 }}
                  className="absolute left-0 top-1/2 h-[1.5px] rounded-full bg-current"
                  initial={false}
                  animate={
                    open
                      ? { y: 0, rotate: i === 0 ? 45 : -45, width: 15 }
                      : { y: offset, rotate: 0, width: i === 0 ? 15 : 10 }
                  }
                  transition={springUI}
                />
              ))}
            </span>
          </span>
        </motion.button>
      </div>

      {/* Always mounted and parked under the page, which slides off it to
          reveal. Hidden outright once the page has slid back, because the shell
          drops its z-index then and would no longer cover it. aria-hidden so
          it isn't read out or tabbed into while covered. */}
      <aside
        aria-hidden={!open}
        style={{ width: DRAWER_WIDTH }}
        className={`fixed inset-y-0 left-0 z-20 flex flex-col bg-tile px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-[max(env(safe-area-inset-top),24px)] ${
          elevated ? "" : "invisible"
        }`}
      >
        {/* min-h-0 is what lets a flex child actually shrink and scroll;
                  without it the column just grows and the overflow is
                  unreachable. Log out stays pinned below this. */}
        <motion.div
          variants={panel}
          initial="hidden"
          animate={open ? "shown" : "hidden"}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4"
        >
          <motion.div variants={row} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-2xl font-bold leading-none">Night Kitchen</h2>
              <p className="mt-1 font-hand text-xl text-smoke">what are we cooking?</p>
            </div>
            {/* The icon is the mode you're in, and tapping it swaps to the
                other. 44px for the touch target though the glyph is 20px.
                Empty until mounted — the resolved theme isn't knowable
                server-side, and an icon that corrects itself reads as a
                flicker.

                Pulled up to sit level with the close button across the gap:
                that anchors to max(safe-area, 12px) while this column starts
                at max(safe-area, 24px), so the offset is the difference —
                nothing on a notched phone, -12px where there's no inset. */}
            <motion.button
              whileTap={{ scale: 0.9 }}
              transition={springUI}
              onClick={() => setTheme(isDark ? "light" : "dark")}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              className="-mr-1 mt-[calc(max(env(safe-area-inset-top),12px)_-_max(env(safe-area-inset-top),24px))] flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-char"
            >
              <AnimatePresence mode="wait" initial={false}>
                {mounted && (
                  <motion.span
                    key={isDark ? "moon" : "sun"}
                    initial={{ opacity: 0, rotate: -70, scale: 0.7 }}
                    animate={{ opacity: 1, rotate: 0, scale: 1 }}
                    exit={{ opacity: 0, rotate: 70, scale: 0.7 }}
                    transition={springUI}
                    className="flex items-center justify-center"
                  >
                    {isDark ? <MoonIcon /> : <SunIcon />}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          </motion.div>

          {/* Capture used to be the + in the bottom nav. Most captures now
                    arrive via the Safari share sheet, so it lives here for the
                    times you're already in the app. */}
          <motion.button
            variants={row}
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              setOpen(false);
              router.push("/add");
            }}
            className="mt-6 block w-full rounded-xl px-3 py-3 text-left hover:bg-char/5"
          >
            <span className="block font-display text-base font-bold">Add a recipe</span>
            <span className="block text-sm text-smoke">Photos or paste it in</span>
          </motion.button>

          <nav className="mt-2 space-y-1">
            {LINKS.map((link) => {
              const active =
                link.href === "/"
                  ? pathname === "/" || pathname.startsWith("/recipes")
                  : pathname.startsWith(link.href);
              return (
                <motion.div key={link.href} variants={row}>
                  <Link
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className={`block rounded-xl px-3 py-3 ${
                      active ? "bg-char text-tile" : "hover:bg-char/5"
                    }`}
                  >
                    <span className="block font-display text-base font-bold">{link.label}</span>
                    <span className={`block text-sm ${active ? "text-tile/60" : "text-smoke"}`}>
                      {link.hint}
                    </span>
                  </Link>
                </motion.div>
              );
            })}

            {/* Shuffle library — reorders the grid on each launch so recipes at
                the bottom of new→old don't get forgotten. */}
            <motion.div variants={row}>
              <button
                type="button"
                role="switch"
                aria-checked={shuffle}
                onClick={toggleShuffle}
                className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left hover:bg-char/5"
              >
                <span className="min-w-0">
                  <span className="block font-display text-base font-bold">Shuffle library</span>
                  <span className="block text-sm text-smoke">
                    Reshuffle on each launch so nothing stays buried
                  </span>
                </span>
                <span
                  className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
                    shuffle ? "bg-flame" : "bg-char/20"
                  }`}
                >
                  <motion.span
                    className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-chalk shadow-sm"
                    initial={false}
                    animate={{ x: shuffle ? 16 : 0 }}
                    transition={springUI}
                  />
                </span>
              </button>
            </motion.div>
          </nav>

          {/* Appearance — pick a brand family and whether the brand colour
              floods the surface. The light/dark toggle lives up top by the
              title. Only shown once mounted so the stored choice isn't a
              flash of the default. */}
          {mounted && (
            <motion.div variants={row} className="mt-4 rounded-xl px-3 py-3">
              <span className="block font-display text-base font-bold">Theme</span>
              <div className="mt-2.5 flex items-center gap-3">
                {THEMES.map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => setThemeName(t.name)}
                    aria-label={t.label}
                    aria-pressed={name === t.name}
                    className={`h-8 w-8 shrink-0 rounded-full border border-char/20 transition-transform ${
                      name === t.name ? "ring-2 ring-char ring-offset-2 ring-offset-tile" : ""
                    }`}
                    style={{ backgroundColor: t.swatch }}
                  />
                ))}
              </div>
              <div className="mt-3 flex rounded-full bg-char/8 p-1 text-sm font-semibold">
                {(["standard", "flooded"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setThemeStyle(s)}
                    aria-pressed={style === s}
                    className={`flex-1 rounded-full py-1.5 capitalize ${
                      style === s ? "bg-flame text-accent-ink" : "text-smoke"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </motion.div>

        {/* Utility actions live at the foot, label-only, sharing the log-out
            button's outline so they read as controls rather than destinations. */}
        <motion.div
          variants={row}
          initial="hidden"
          animate={open ? "shown" : "hidden"}
          className="mb-2 flex gap-2"
        >
          <Link
            href="/health"
            onClick={() => setOpen(false)}
            className="flex-1 rounded-xl border border-char/15 py-2.5 text-center text-sm font-semibold text-smoke"
          >
            Status
          </Link>
          <a
            href="/api/export"
            onClick={() => setOpen(false)}
            className="flex-1 rounded-xl border border-char/15 py-2.5 text-center text-sm font-semibold text-smoke"
          >
            Export
          </a>
        </motion.div>

        <motion.form
          variants={row}
          initial="hidden"
          animate={open ? "shown" : "hidden"}
          action="/api/logout"
          method="post"
          onSubmit={() => clearUserDataCaches()}
        >
          <button
            type="submit"
            className="w-full rounded-xl border border-char/15 py-2.5 text-sm font-semibold text-smoke"
          >
            Log out
          </button>
        </motion.form>
      </aside>
    </>
  );
}
