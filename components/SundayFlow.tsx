"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { GroceryItem, PlannedMeal, Staple } from "@/lib/types";
import { mealLabel } from "@/lib/types";
import { SECTION_LABELS, GROCERY_SECTIONS } from "@/lib/config";
import { springSoft, springUI } from "@/lib/springs";
import { dayLabel } from "@/lib/week";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import { AddToListSheet } from "./AddToListSheet";

const STEPS = ["Plan", "List", "Staples", "Shop", "Archive"] as const;
type Step = (typeof STEPS)[number];

/**
 * §5: one guided sequence, reachable in a tap. "I should be able to jump into
 * or out of any step. It's a suggested path, not a wizard I'm trapped in."
 * Every step is directly selectable and closing is always available.
 */
export function SundayFlow({
  startDate,
  meals,
  emptyCount,
  onClose,
  onGenerate,
  onRefresh,
}: {
  startDate: string;
  meals: PlannedMeal[];
  emptyCount: number;
  onClose: () => void;
  onGenerate: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [step, setStep] = useState<Step>("Plan");
  const [items, setItems] = useState<GroceryItem[]>([]);
  useBodyScrollLock();
  const [staples, setStaples] = useState<Staple[]>([]);
  const [restock, setRestock] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [addSheetOpen, setAddSheetOpen] = useState(false);

  const loadList = useCallback(async () => {
    const res = await fetch("/api/grocery/trip");
    if (res.ok) {
      const j = await res.json();
      setItems(j.items ?? []);
    }
  }, []);

  useEffect(() => {
    loadList();
    fetch("/api/staples")
      .then((r) => r.json())
      .then((j) => {
        const list: Staple[] = j.staples ?? [];
        setStaples(list);
        // Overdue staples are pre-selected — a checklist, not a memory test.
        setRestock(new Set(list.filter((s) => s.overdue).map((s) => s.id)));
      })
      .catch(() => {});
  }, [loadList]);

  // The week's whole shop in one confirm — the place duplicates add up most.
  // Freeform nights carry ingredients too when they came from an AI idea;
  // quick meals count only when they actually have an ingredient list.
  const mealsWithIngredients = meals.filter(
    (m) =>
      m.recipes ||
      (m.quick_meals?.ingredients?.length ?? 0) > 0 ||
      (m.ingredients?.length ?? 0) > 0
  );

  async function applyRestock() {
    if (!restock.size) return setStep("Shop");
    setBusy(true);
    await fetch("/api/staples", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...restock] }),
    });
    await loadList();
    setBusy(false);
    setStep("Shop");
  }

  async function toggleItem(item: GroceryItem) {
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i))
    );
    await fetch(`/api/grocery/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checked: !item.checked }),
    });
  }

  async function archive() {
    setBusy(true);
    const carry = items.filter((i) => !i.checked).map((i) => i.id);
    await fetch("/api/grocery/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carry_over_ids: carry }),
    });
    await Promise.all([loadList(), onRefresh()]);
    setBusy(false);
    setDone(true);
  }

  const unchecked = items.filter((i) => !i.checked);
  const grouped = GROCERY_SECTIONS.map((s) => ({
    section: s,
    items: unchecked.filter((i) => i.section === s),
  })).filter((g) => g.items.length);

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-50 bg-scrim/50"
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={springUI}
        className="fixed inset-x-0 bottom-0 top-[max(env(safe-area-inset-top),12px)] z-50 mx-auto flex max-w-2xl flex-col rounded-t-3xl bg-tile"
      >
        <div className="shrink-0 px-5 pt-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-bold">Sunday</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-char/5 text-smoke"
            >
              ✕
            </button>
          </div>

          {/* Every step is tappable — jump in or out at will. */}
          <div className="no-scrollbar -mx-5 mt-3 flex gap-1.5 overflow-x-auto px-5 pb-1">
            {STEPS.map((s) => (
              <button
                key={s}
                onClick={() => setStep(s)}
                className={`relative shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${
                  step === s ? "text-tile" : "bg-char/5 text-smoke"
                }`}
              >
                {step === s && (
                  <motion.span
                    layoutId="sunday-step"
                    transition={springUI}
                    className="absolute inset-0 rounded-full bg-char"
                  />
                )}
                <span className="relative">{s}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={springSoft}
            >
              {step === "Plan" && (
                <div>
                  <p className="text-sm text-smoke">
                    {emptyCount
                      ? `${emptyCount} night${emptyCount === 1 ? "" : "s"} still open. Fill what you leave blank.`
                      : "Every night has a plan."}
                  </p>
                  <ul className="mt-3 space-y-1.5">
                    {meals
                      .slice()
                      .sort((a, b) => a.date.localeCompare(b.date))
                      .map((m) => {
                        const { weekday } = dayLabel(m.date);
                        return (
                          <li
                            key={m.id}
                            className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2.5"
                          >
                            <span className="w-9 shrink-0 text-xs font-semibold uppercase text-smoke">
                              {weekday}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[15px]">
                              {mealLabel(m)}
                            </span>
                          </li>
                        );
                      })}
                  </ul>
                  {emptyCount > 0 && (
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      transition={springUI}
                      onClick={async () => {
                        setBusy(true);
                        await onGenerate();
                        await onRefresh();
                        setBusy(false);
                      }}
                      disabled={busy}
                      className="mt-4 w-full rounded-xl bg-char py-3 font-display font-bold text-tile disabled:opacity-40"
                    >
                      {busy ? "Thinking…" : "Fill the open nights"}
                    </motion.button>
                  )}
                  <button
                    onClick={() => setStep("List")}
                    className="mt-2 w-full rounded-xl bg-char/5 py-3 font-display font-bold"
                  >
                    Next: review the list
                  </button>
                </div>
              )}

              {step === "List" && (
                <div>
                  <p className="text-sm text-smoke">
                    Everything from the week&apos;s meals, merged with what you added all week.
                  </p>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    transition={springUI}
                    onClick={() => setAddSheetOpen(true)}
                    disabled={busy || !mealsWithIngredients.length}
                    className="mt-3 w-full rounded-xl bg-flame py-3 font-display font-bold text-accent-ink disabled:opacity-40"
                  >
                    Review the week&apos;s ingredients
                  </motion.button>
                  <p className="mt-3 text-sm text-smoke">
                    {items.length} item{items.length === 1 ? "" : "s"} on the list
                  </p>
                  <button
                    onClick={() => setStep("Staples")}
                    className="mt-3 w-full rounded-xl bg-char/5 py-3 font-display font-bold"
                  >
                    Next: check staples
                  </button>
                </div>
              )}

              {step === "Staples" && (
                <div>
                  <p className="text-sm text-smoke">
                    Which need restocking? Anything overdue is already ticked.
                  </p>
                  <ul className="mt-3 space-y-1">
                    {staples.map((s) => (
                      <li key={s.id}>
                        <label className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={restock.has(s.id)}
                            onChange={(e) =>
                              setRestock((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(s.id);
                                else next.delete(s.id);
                                return next;
                              })
                            }
                            className="h-5 w-5 accent-[#e8430f]"
                          />
                          <span className="min-w-0 flex-1 text-[15px]">{s.name}</span>
                          {s.overdue && (
                            <span className="rounded-full bg-yolk px-2 py-0.5 text-[10px] font-bold text-scrim">
                              due
                            </span>
                          )}
                        </label>
                      </li>
                    ))}
                  </ul>
                  {!staples.length && (
                    <p className="mt-4 text-sm text-smoke">
                      No staples yet — add them from the Grocery screen.
                    </p>
                  )}
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    transition={springUI}
                    onClick={applyRestock}
                    disabled={busy}
                    className="mt-4 w-full rounded-xl bg-char py-3 font-display font-bold text-tile disabled:opacity-40"
                  >
                    {restock.size ? `Add ${restock.size} to the list` : "Nothing to restock"}
                  </motion.button>
                </div>
              )}

              {step === "Shop" && (
                <div>
                  <p className="text-sm text-smoke">
                    Grouped so you walk the store once. Tap to check off.
                  </p>
                  {grouped.map((g) => (
                    <section key={g.section} className="mt-4">
                      <h3 className="font-display text-xs font-bold uppercase tracking-widest text-smoke">
                        {SECTION_LABELS[g.section]}
                      </h3>
                      <ul className="mt-1.5 space-y-1">
                        {g.items.map((item) => (
                          <li key={item.id}>
                            <button
                              onClick={() => toggleItem(item)}
                              className="flex w-full items-center gap-3 rounded-xl bg-surface px-3 py-3 text-left"
                            >
                              <span className="h-6 w-6 shrink-0 rounded-full border-2 border-char/25" />
                              <span className="min-w-0 flex-1 truncate text-[15px]">
                                {item.name}
                                {item.quantity && (
                                  <span className="ml-2 text-sm text-smoke">{item.quantity}</span>
                                )}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                  {!unchecked.length && (
                    <p className="mt-6 text-center text-sm text-smoke">
                      Everything&apos;s in the cart.
                    </p>
                  )}
                  <button
                    onClick={() => setStep("Archive")}
                    className="mt-5 w-full rounded-xl bg-char/5 py-3 font-display font-bold"
                  >
                    Next: archive the trip
                  </button>
                </div>
              )}

              {step === "Archive" && (
                <div>
                  {done ? (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={springSoft}
                      className="rounded-xl bg-herb/15 p-4 text-center"
                    >
                      <p className="font-display text-lg font-bold text-herb">Filed away.</p>
                      <p className="mt-1 text-sm text-smoke">
                        Next Sunday&apos;s trip is open and anything unchecked carried over.
                      </p>
                      <Link
                        href="/grocery"
                        onClick={onClose}
                        className="mt-3 inline-block rounded-full bg-char px-4 py-2 text-sm font-semibold text-tile"
                      >
                        See the new list
                      </Link>
                    </motion.div>
                  ) : (
                    <>
                      <p className="text-sm text-smoke">
                        {unchecked.length
                          ? `${unchecked.length} unchecked will carry over to next Sunday.`
                          : "Everything's checked off."}
                      </p>
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        transition={springUI}
                        onClick={archive}
                        disabled={busy}
                        className="mt-4 w-full rounded-xl bg-char py-3.5 font-display font-bold text-tile disabled:opacity-40"
                      >
                        {busy ? "Filing…" : "Archive this trip"}
                      </motion.button>
                    </>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>

      <AnimatePresence>
        {addSheetOpen && (
          <AddToListSheet
            source={{ planned_meal_ids: mealsWithIngredients.map((m) => m.id) }}
            title="This week's ingredients"
            onClose={() => setAddSheetOpen(false)}
            onAdded={() => loadList()}
          />
        )}
      </AnimatePresence>
    </>
  );
}
