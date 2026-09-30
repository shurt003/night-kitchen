"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Staple } from "@/lib/types";
import { springSoft, springUI } from "@/lib/springs";
import { UndoToast, useUndoToast } from "@/components/UndoToast";

/**
 * The standing list you maintain once — olive oil, eggs, rice.
 * Used three ways: the Sunday restock check, "assumed on hand" by pantry mode,
 * and to pre-untick things you already own when adding a recipe to the list.
 */
export default function StaplesPage() {
  const [staples, setStaples] = useState<Staple[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const { toast, show, undo } = useUndoToast();
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/staples");
    if (!res.ok) return;
    const json = await res.json();
    const list: Staple[] = json.staples ?? [];
    setStaples(list);
    setSelected(new Set(list.filter((s) => s.overdue).map((s) => s.id)));
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setName("");
    // Adding is a burst activity — the keyboard stays up between items. This
    // has to run before the await, or the round trip lands after the blur.
    inputRef.current?.focus();
    await fetch("/api/staples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    load();
  }

  function remove(staple: Staple) {
    setStaples((prev) => prev.filter((s) => s.id !== staple.id));
    show(`Removed ${staple.name}`, async () => {
      await fetch("/api/staples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: staple.name,
          section: staple.section,
          typical_cadence_days: staple.typical_cadence_days,
        }),
      });
      load();
    });
    fetch(`/api/staples/${staple.id}`, { method: "DELETE" });
  }

  async function restock() {
    if (!selected.size || busy) return;
    setBusy(true);
    const rect = addButtonRef.current?.getBoundingClientRect();
    if (rect) {
      window.dispatchEvent(
        new CustomEvent("fly-to-list", {
          detail: {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            count: selected.size,
          },
        })
      );
    }
    await fetch("/api/staples", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected] }),
    });
    window.dispatchEvent(new CustomEvent("grocery-changed"));
    setBusy(false);
    setSelected(new Set());
    load();
  }

  const overdue = staples.filter((s) => s.overdue);

  return (
    <main className="px-4 pt-[max(env(safe-area-inset-top),16px)]">
      <h1 className="pr-11 font-display text-3xl font-bold">Staples</h1>
      <p className="mt-1 text-sm text-smoke">
        Things you keep stocked. Assumed on hand, so recipes won&apos;t add them to your list.
      </p>

      <div className="mt-3 flex gap-2">
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          enterKeyHint="go"
          placeholder="olive oil, eggs, rice…"
          className="w-full rounded-xl border border-char/15 bg-surface px-4 py-3 text-base outline-none placeholder:text-smoke/70 focus:border-flame"
        />
        <motion.button
          whileTap={{ scale: 0.9 }}
          transition={springUI}
          onClick={add}
          // Cancelling pointerdown stops the button stealing focus from the
          // input, so the keyboard stays up across a burst of adds.
          onPointerDown={(e) => e.preventDefault()}
          disabled={!name.trim()}
          className="shrink-0 rounded-xl bg-flame px-4 font-display text-xl font-bold text-accent-ink disabled:opacity-40"
        >
          +
        </motion.button>
      </div>

      {overdue.length > 0 && (
        <p className="mt-3 rounded-xl bg-yolk/20 px-3 py-2 text-sm">
          {overdue.length} due for a restock — already ticked below.
        </p>
      )}

      <ul className="mt-3 space-y-1 pb-4">
        <AnimatePresence initial={false}>
          {staples.map((staple) => (
            <motion.li
              key={staple.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={springSoft}
              className="flex items-center gap-3 rounded-xl border border-char/8 bg-surface px-3 py-2.5"
            >
              <input
                type="checkbox"
                checked={selected.has(staple.id)}
                onChange={(e) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(staple.id);
                    else next.delete(staple.id);
                    return next;
                  })
                }
                aria-label={`Restock ${staple.name}`}
                className="h-5 w-5 shrink-0 accent-[#e8430f]"
              />
              <span className="min-w-0 flex-1 truncate text-[15px]">{staple.name}</span>
              {staple.overdue && (
                <span className="shrink-0 rounded-full bg-yolk px-2 py-[3px] text-[10px] font-bold leading-none text-scrim">
                  due
                </span>
              )}
              <button
                onClick={() => remove(staple)}
                aria-label={`Remove ${staple.name}`}
                className="shrink-0 px-1 text-smoke/60"
              >
                ✕
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {loaded && !staples.length && (
        <p className="mt-10 text-center text-sm text-smoke">
          Nothing yet. Add the things you always keep around — they&apos;ll stop turning up on
          your grocery list.
        </p>
      )}

      {/* Only appears when there's something to do with it. */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={springUI}
            className="fixed inset-x-0 bottom-[92px] z-30 mx-auto max-w-2xl px-4"
          >
            <motion.button
              ref={addButtonRef}
              whileTap={{ scale: 0.97 }}
              transition={springUI}
              onClick={restock}
              disabled={busy}
              className="w-full rounded-xl bg-char py-3.5 font-display font-bold text-tile shadow-lg shadow-scrim/20 disabled:opacity-40"
            >
              {busy ? "Adding…" : `Add ${selected.size} to the list`}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      <UndoToast toast={toast} onUndo={undo} />
    </main>
  );
}
