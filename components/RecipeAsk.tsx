"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import type { Recipe } from "@/lib/types";
import { springSoft, springUI } from "@/lib/springs";

type Turn = { role: "user" | "assistant"; text: string };

/** Space to leave above the panel so it clears the status bar / notch. */
const TOP_GAP = 56;

/**
 * The visible viewport, from the visualViewport API: `inset` is the keyboard
 * height (0 when closed), `height` is the visible height above it.
 *
 * The chat is bottom-anchored on the keyboard and sized by height — never given
 * a `top`. That's deliberate: `position: fixed; top` is unreliable on iOS while
 * the keyboard is up (iOS scrolls the page to reveal the focused input and
 * fixed elements shift with it, pushing a top-anchored header off-screen).
 * Anchoring to the keyboard and capping height to the space above it keeps the
 * header a fixed distance below the top, so it can never leave the viewport.
 */
function useViewport(active: boolean): { inset: number; height: number } {
  const [m, setM] = useState<{ inset: number; height: number }>(() => ({
    inset: 0,
    height: typeof window === "undefined" ? 0 : window.innerHeight,
  }));
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) {
      setM({ inset: 0, height: window.innerHeight });
      return;
    }
    const update = () =>
      setM({
        inset: Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)),
        height: Math.round(vv.height),
      });
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [active]);
  return m;
}

/**
 * "Ask about this recipe" — a cooking companion scoped to the one recipe you're
 * looking at. Tapping the button opens a full-height chat: header pinned at the
 * top (recipe name + close), conversation in the middle, composer above the
 * keyboard. While it's open the recipe sheet behind is frozen, so the only
 * thing that scrolls is the conversation. Saving an answer to notes collapses
 * everything (keyboard included). Closing keeps the conversation.
 */
export function RecipeAsk({
  recipe,
  onAppendNote,
}: {
  recipe: Recipe;
  onAppendNote: (line: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const touchStartY = useRef(0);

  const { inset, height } = useViewport(open);
  const panelHeight = Math.max(240, height - TOP_GAP);

  useEffect(() => setMounted(true), []);

  // Raise the keyboard as the chat opens. Best-effort — if iOS declines the
  // programmatic focus, the first tap on the field brings it up.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // While the chat is open, the only thing that should scroll is the
  // conversation. The chat is portaled to <body>, but the element that actually
  // scrolls behind it is the recipe SHEET (an overflow-y-auto element, not the
  // page). Freeze that scroller directly — climb from the in-sheet trigger to
  // find it — and block touchmove anywhere outside the conversation list.
  useEffect(() => {
    if (!open) return;

    let node = triggerRef.current?.parentElement ?? null;
    let sheet: HTMLElement | null = null;
    while (node) {
      const oy = getComputedStyle(node).overflowY;
      if (oy === "auto" || oy === "scroll") {
        sheet = node;
        break;
      }
      node = node.parentElement;
    }

    const restore: Array<[HTMLElement, string]> = [];
    if (sheet) {
      restore.push([sheet, sheet.style.overflow]);
      sheet.style.overflow = "hidden";
    }
    restore.push([document.body, document.body.style.overflow]);
    document.body.style.overflow = "hidden";

    const onStart = (e: TouchEvent) => {
      touchStartY.current = e.touches[0]?.clientY ?? 0;
    };
    // Block every scroll gesture except one that a genuinely scrollable
    // conversation can actually consume. An "allowed" gesture on an empty or
    // edge-pinned list would otherwise leak to iOS's visual-viewport scroll
    // (which overflow:hidden can't stop) and drag the sheet — but only with the
    // keyboard up, hence the earlier keyboard-down-only success.
    const block = (e: TouchEvent) => {
      const list = scrollRef.current;
      if (!list || !list.contains(e.target as Node)) {
        e.preventDefault();
        return;
      }
      if (list.scrollHeight <= list.clientHeight) {
        e.preventDefault();
        return;
      }
      const atTop = list.scrollTop <= 0;
      const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
      const movingDown = (e.touches[0]?.clientY ?? 0) > touchStartY.current;
      if ((atTop && movingDown) || (atBottom && !movingDown)) e.preventDefault();
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", block, { passive: false });

    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", block);
      restore.forEach(([el, prev]) => (el.style.overflow = prev));
    };
  }, [open]);

  function close() {
    inputRef.current?.blur();
    setOpen(false);
  }

  /**
   * Condense an answer to a margin note and drop it into the recipe's notes,
   * then collapse everything (keyboard included) so the note is what you see.
   * Fire-and-forget — the condensed line lands in the notes a beat later.
   */
  function saveToNotes(i: number, text: string) {
    const question = turns[i - 1]?.role === "user" ? turns[i - 1].text : "";
    // If condensing fails, fall back to the first sentence rather than the wall.
    const fallback = (text.split(/(?<=[.!?])\s/)[0] || text).trim().slice(0, 120);
    close();
    fetch("/api/recipe-ask/note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: text, question }),
    })
      .then((res) => (res.ok ? res.json() : {}))
      .then((json: { note?: string }) => onAppendNote((json.note ?? "").trim() || fallback))
      .catch(() => onAppendNote(fallback));
  }

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    // The assistant turn is created empty and filled as tokens stream in.
    const history = [...turns, { role: "user" as const, text: q }];
    setTurns([...history, { role: "assistant", text: "" }]);
    setBusy(true);

    try {
      const res = await fetch("/api/recipe-ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipeId: recipe.id, messages: history }),
      });
      if (!res.ok || !res.body) throw new Error();

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setTurns((t) => {
          const next = [...t];
          next[next.length - 1] = { role: "assistant", text: acc };
          return next;
        });
        endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }
    } catch {
      setTurns((t) => {
        const next = [...t];
        next[next.length - 1] = {
          role: "assistant",
          text: "Something went wrong — try that again.",
        };
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  const overlay = (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
            className="fixed inset-0 z-50 bg-scrim/50"
          />
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24, transition: { duration: 0.16 } }}
            transition={springSoft}
            // The panel runs all the way to the physical bottom of the screen
            // (bottom: 0) as one opaque surface, and reserves the keyboard's
            // height as padding so the composer floats just above it. Its top
            // still lands at the same spot as a height-only layout would
            // (panelHeight + inset), so the header can't be pushed off-screen —
            // see useViewport. Filling to the bottom is what fixes the iOS gap:
            // when the keyboard reveal-scrolls the page, fixed elements shift and
            // a keyboard-anchored panel would leave a sliver of the dimmed page
            // showing between the composer and the keyboard. An opaque surface
            // that always reaches the bottom has no sliver to leak through.
            style={{ bottom: 0, height: panelHeight + inset, paddingBottom: inset }}
            className="fixed inset-x-2 z-50 mx-auto flex max-w-2xl flex-col overflow-hidden rounded-2xl bg-tile shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-char/10 px-4 py-3">
              <p className="truncate font-display text-base font-bold">{recipe.title}</p>
              <button
                onClick={close}
                aria-label="Close"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-char/5 text-smoke"
              >
                ✕
              </button>
            </div>

            <div
              ref={scrollRef}
              className="flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-4 py-3"
            >
              <AnimatePresence initial={false}>
                {turns.map((turn, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={springSoft}
                    className={turn.role === "user" ? "flex justify-end" : ""}
                  >
                    {turn.role === "user" ? (
                      <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-char px-3.5 py-2 text-[15px] text-tile">
                        {turn.text}
                      </p>
                    ) : (
                      <div className="max-w-[92%]">
                        <p className="whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-surface px-3.5 py-2.5 text-[15px] leading-relaxed">
                          {turn.text}
                          {busy && i === turns.length - 1 && (
                            <motion.span
                              animate={{ opacity: [0.2, 1, 0.2] }}
                              transition={{ duration: 1.2, repeat: Infinity }}
                              className="ml-0.5 inline-block"
                            >
                              ▍
                            </motion.span>
                          )}
                        </p>
                        {/* Save an answer to notes — collapses the chat and keyboard. */}
                        {turn.text && !(busy && i === turns.length - 1) && (
                          <button
                            onClick={() => saveToNotes(i, turn.text)}
                            className="mt-1 pl-1 text-xs font-semibold text-smoke"
                          >
                            Save to notes
                          </button>
                        )}
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              <div ref={endRef} />
            </div>

            <div className="flex gap-2 border-t border-char/10 px-4 py-3">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send(input)}
                placeholder="Ask anything about this recipe…"
                className="w-full rounded-xl border border-char/15 bg-surface px-3.5 py-2.5 text-base outline-none focus:border-flame"
              />
              <motion.button
                whileTap={{ scale: 0.92 }}
                transition={springUI}
                // Keep focus on the input so tapping send never drops the keyboard.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => send(input)}
                disabled={busy || !input.trim()}
                className="shrink-0 rounded-xl bg-flame px-4 font-display font-bold text-accent-ink disabled:opacity-40"
              >
                ↑
              </motion.button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return (
    <>
      {/* Trigger dressed as a labelled input: a header sits above a fake field
          whose placeholder lists what you can ask, with a send affordance in the
          corner. Tapping the field opens the real chat (which has its own live
          input). The whole box is the button; the ↑ is decorative. */}
      <div className="mt-4">
        <span className="mb-1.5 flex items-center gap-1.5 text-[15px] font-semibold text-char/80">
          {/* SVG rather than the ✦ glyph: a text star's size and baseline drift
              with the font, which left it oversized and riding high. */}
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-4 w-4 shrink-0 text-flame">
            <path d="M12 2c.5 6 3.5 9 9.5 9.5C15.5 12 12.5 15 12 21c-.5-6-3.5-9-9.5-9.5C8.5 11 11.5 8 12 2Z" />
          </svg>
          Ask anything about this recipe
        </span>
        <button
          ref={triggerRef}
          onClick={() => setOpen(true)}
          aria-label="Ask about this recipe"
          // flex-col, not block: a <button> vertically centres its content, which
          // left the placeholder floating mid-box. A flex column pins it top-left.
          // pb-12 keeps the text clear of the send button in the bottom corner.
          className="relative flex min-h-24 w-full flex-col rounded-xl border border-char/15 bg-surface px-3.5 pb-12 pt-3 text-left"
        >
          <span className="text-[15px] leading-snug text-smoke">
            substitutions, methods, marinades, leftovers, pairing ideas, etc
          </span>
          <span className="absolute bottom-2.5 right-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-flame text-accent-ink">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="h-5 w-5"
            >
              <path d="M12 19V6M6.5 11.5 12 6l5.5 5.5" />
            </svg>
          </span>
        </button>
      </div>

      {mounted && createPortal(overlay, document.body)}
    </>
  );
}
