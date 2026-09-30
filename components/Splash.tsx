"use client";

import { useEffect, useState } from "react";

/**
 * Cold-start splash: the mark alone on char. The bowl swings up, the crescent
 * climbs out of it, and then the two of them just… float — the moon bobbing
 * and rocking like a boat riding slow water, the bowl swaying in counterphase
 * beneath it. Every layer runs on its own period (2.7s / 3.7s / 3.1s / 4.2s),
 * so the composite motion never visibly repeats — it reads as drifting, not
 * looping.
 *
 * It lives in the SSR HTML and animates with pure CSS, because the moment it
 * exists for — the gap before React hydrates — is exactly the moment no JS
 * has run yet. Each nested <g> owns exactly one animation, since co-animating
 * transform on one element would overwrite rather than compose.
 *
 * The inline script hides it synchronously during parse when the app was
 * opened moments ago (login redirect, quick reload) — only a real cold start
 * gets the ceremony.
 */

const RECENT_MS = 60_000;
const EXIT_MS = 450;

const SPLASH_SKIP_SCRIPT = `(function(){try{
var k="nk-splash-at",el=document.getElementById("nk-splash"),now=Date.now();
if(now-(+sessionStorage.getItem(k)||0)<${RECENT_MS}){el.style.display="none";el.dataset.skipped="1";}
else{sessionStorage.setItem(k,String(now));}
}catch(e){}})();`;

export function Splash() {
  // The DOM node is React-managed, so React must be the one to remove it —
  // el.remove() here once left a stale node in React's tree, and the next
  // client-side navigation crashed reconciling against it.
  const [phase, setPhase] = useState<"showing" | "exiting" | "gone">("showing");

  useEffect(() => {
    const el = document.getElementById("nk-splash");
    if (!el || el.dataset.skipped) {
      setPhase("gone");
      return;
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hold = reduced ? 700 : 2300;

    let exitTimer: ReturnType<typeof setTimeout> | null = null;
    let exited = false;
    const exit = () => {
      if (exited) return;
      exited = true;
      setPhase("exiting");
      exitTimer = setTimeout(() => setPhase("gone"), EXIT_MS);
    };

    const t = setTimeout(exit, hold);
    // A tap skips the ceremony — never make the user wait for a logo.
    el.addEventListener("pointerdown", exit);
    return () => {
      clearTimeout(t);
      if (exitTimer) clearTimeout(exitTimer);
      el.removeEventListener("pointerdown", exit);
    };
  }, []);

  if (phase === "gone") return null;

  return (
    <>
      {/* suppressHydrationWarning: the inline script below mutates this
          element's attributes before React hydrates when the splash is
          skipped — that mismatch is intentional. */}
      <div
        id="nk-splash"
        aria-hidden="true"
        suppressHydrationWarning
        className={phase === "exiting" ? "nk-splash-out" : undefined}
      >
        <svg viewBox="0 0 512 512" className="nk-sp-mark">
          <defs>
            <mask id="nk-sp-crescent">
              <rect width="512" height="512" fill="#fff" />
              <circle cx="292" cy="172" r="64" fill="#000" />
            </mask>
          </defs>
          {/* entrance → bob → rock, one transform per layer. The static lift
              keeps the moon clear of the rim through most of the cycle, so it
              only kisses the bowl at the low extreme. */}
          <g transform="translate(0 -16)">
            <g className="nk-e-moon">
              <g className="nk-i-bob">
                <g className="nk-i-rock">
                  <g transform="rotate(-15 258 190)">
                    <circle cx="258" cy="190" r="74" fill="#ffc53d" mask="url(#nk-sp-crescent)" />
                  </g>
                </g>
              </g>
            </g>
          </g>
          <g className="nk-e-bowl">
            <g className="nk-i-breathe">
              <g className="nk-i-sway">
                <path d="M118 300h276a138 138 0 0 1-276 0z" fill="#e8430f" />
              </g>
            </g>
          </g>
        </svg>
      </div>
      <script dangerouslySetInnerHTML={{ __html: SPLASH_SKIP_SCRIPT }} />
    </>
  );
}
