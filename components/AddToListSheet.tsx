"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { springSoft, springUI } from "@/lib/springs";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

type Item = {
  name: string;
  quantity: string;
  source_label: string | null;
  likely_owned: boolean;
  reason: string | null;
};

/** What to preview: exactly one of these. */
export type AddSource =
  | { recipe_id: string }
  | { planned_meal_id: string }
  | { planned_meal_ids: string[] };

/**
 * The confirm step before anything reaches the list.
 *
 * Items you likely already have (matched against your staples) start unticked
 * with the reason shown — never hidden, never silently dropped. A wrong guess
 * costs one tap here, rather than a missing ingredient on a Tuesday night.
 */
export function AddToListSheet({
  source,
  title,
  onClose,
  onAdded,
}: {
  source: AddSource;
  title: string;
  onClose: () => void;
  onAdded: (count: number) => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useBodyScrollLock();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/grocery/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(source),
    })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const list: Item[] = json.items ?? [];
        setItems(list);
        setSelected(new Set(list.filter((i) => !i.likely_owned).map((i) => i.name)));
      })
      .catch(() => !cancelled && setError("Couldn't work out what to add."));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const owned = useMemo(() => (items ?? []).filter((i) => i.likely_owned), [items]);

  async function confirm() {
    if (!selected.size || busy) return;
    setBusy(true);

    const rect = confirmRef.current?.getBoundingClientRect();
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

    await fetch("/api/grocery/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...source, only: [...selected] }),
    });
    window.dispatchEvent(new CustomEvent("grocery-changed"));
    setBusy(false);
    onAdded(selected.size);
    onClose();
  }

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-scrim/50"
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={springUI}
        className="fixed inset-x-0 bottom-0 z-[60] mx-auto flex max-h-[85dvh] max-w-2xl flex-col rounded-t-3xl bg-tile p-5 pb-[max(env(safe-area-inset-bottom),20px)]"
      >
        <h2 className="shrink-0 font-display text-xl font-bold">{title}</h2>
        {owned.length > 0 && (
          <p className="shrink-0 text-sm text-smoke">
            {owned.length} unticked — you keep {owned.length === 1 ? "it" : "them"} stocked. Tick
            anything you&apos;re actually out of.
          </p>
        )}

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {error && <p className="text-sm text-flame">{error}</p>}
          {!items && !error && (
            <p className="animate-pulse py-6 text-center text-sm text-smoke">
              Checking against your staples…
            </p>
          )}
          {items && items.length === 0 && (
            <p className="py-6 text-center text-sm text-smoke">
              This one has no ingredients listed.
            </p>
          )}

          <ul className="space-y-1">
            {(items ?? []).map((item, i) => {
              const on = selected.has(item.name);
              return (
                <motion.li
                  key={`${item.name}-${i}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...springSoft, delay: Math.min(i, 10) * 0.02 }}
                >
                  <label
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                      on ? "bg-surface" : "bg-char/5"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(item.name)}
                      className="h-5 w-5 shrink-0 accent-[#e8430f]"
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-[15px] ${on ? "" : "text-smoke line-through"}`}
                      >
                        {item.name}
                        {item.quantity && (
                          <span className="ml-2 text-sm text-smoke">{item.quantity}</span>
                        )}
                      </span>
                      {item.reason && (
                        <span className="block truncate text-xs text-smoke">{item.reason}</span>
                      )}
                      {!item.reason && item.source_label && (
                        <span className="block truncate text-xs text-smoke">
                          {item.source_label}
                        </span>
                      )}
                    </span>
                  </label>
                </motion.li>
              );
            })}
          </ul>
        </div>

        <motion.button
          ref={confirmRef}
          whileTap={{ scale: 0.97 }}
          transition={springUI}
          onClick={confirm}
          disabled={busy || !selected.size}
          className="mt-3 w-full shrink-0 rounded-xl bg-flame py-3.5 font-display font-bold text-accent-ink disabled:opacity-40"
        >
          {busy
            ? "Adding…"
            : selected.size
              ? `Add ${selected.size} item${selected.size === 1 ? "" : "s"}`
              : "Nothing selected"}
        </motion.button>
      </motion.div>
    </>
  );
}
