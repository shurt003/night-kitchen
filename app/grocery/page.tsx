"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { GroceryItem } from "@/lib/types";
import { GROCERY_SECTIONS, SECTION_LABELS, type GrocerySection } from "@/lib/config";
import { springUI, springOvershoot } from "@/lib/springs";
import { RollingNumber } from "@/components/RollingNumber";
import { UndoToast, useUndoToast } from "@/components/UndoToast";
import { useGrocery } from "@/lib/useGrocery";
import { PullToRefresh } from "@/components/PullToRefresh";
import { abbreviateUnits } from "@/lib/groceryShared";

export default function GroceryPage() {
  const g = useGrocery();
  const { toast, show, undo } = useUndoToast();
  const [input, setInput] = useState("");
  const [mergedFlash, setMergedFlash] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<GroceryItem | null>(null);
  // The add button's "got it" flash: `justAdded` swaps + → ✓ for a beat.
  const [justAdded, setJustAdded] = useState(false);
  const addFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function addManual() {
    const name = input.trim();
    if (!name) return;
    setInput("");
    // Adding is a burst activity — the keyboard stays up between items. The
    // ✓ key in the keyboard's accessory bar is how a session ends.
    inputRef.current?.focus();
    const { merged, itemId } = g.add(name);
    // Quiet "got it" right at the button — it flips to a white ✓ for 500ms, so a
    // burst of adds each register even when the new row lands below the keyboard.
    setJustAdded(true);
    if (addFlashTimer.current) clearTimeout(addFlashTimer.current);
    addFlashTimer.current = setTimeout(() => setJustAdded(false), 500);
    if (merged) {
      // show the merge: pulse the surviving row while its quantity rolls up
      setMergedFlash(new Set([itemId]));
      setTimeout(() => setMergedFlash(new Set()), 900);
    }
  }

  function removeItem(item: GroceryItem) {
    const undo = g.remove(item);
    show(`Removed ${item.name}`, undo);
  }

  function saveEdit(name: string, quantity: string, section: GrocerySection) {
    const item = editing;
    setEditing(null);
    if (!item || !name.trim()) return;
    if (name.trim() !== item.name || quantity.trim() !== (item.quantity ?? "")) {
      g.edit(item, name.trim(), quantity.trim());
    }
    // Separate op: this one also teaches the categorizer where the item belongs.
    if (section !== item.section) {
      g.setSection(item, section);
      show(`Moved to ${SECTION_LABELS[section]}`, () => g.setSection(item, item.section));
    }
  }

  function clearList() {
    const count = g.items.length;
    const undo = g.clearAll();
    show(`Cleared ${count} item${count === 1 ? "" : "s"}`, undo);
  }

  const unchecked = useMemo(() => g.items.filter((i) => !i.checked), [g.items]);
  const checked = useMemo(() => g.items.filter((i) => i.checked), [g.items]);

  const sectionsWithItems = GROCERY_SECTIONS.map((s) => ({
    section: s,
    items: unchecked.filter((i) => i.section === s),
  })).filter((group) => group.items.length > 0);

  return (
    // select-none stops accidental text highlighting (and the iOS long-press
    // callout) while tapping around the list; the inputs opt back in with
    // select-text so typing and editing still work.
    <main className="select-none">
      {/* The sheet and the toast stay outside the pull wrapper on purpose: its
          transform would become their containing block and drag them down
          with the gesture. */}
      <PullToRefresh onRefresh={() => g.refresh({ force: true })}>
        <div className="px-4 pt-[max(env(safe-area-inset-top),16px)]">
          {/* pr-11 keeps the title clear of the fixed menu button */}
          <div className="pr-11">
            <h1 className="font-display text-3xl font-bold">Grocery List</h1>
            {/* Only offline is worth saying. A queued write is already on screen
                and needs nothing from you, so "syncing…" was noise — and being
                noise on every single tap is what forced this row to a fixed
                height to stop it shoving the list up and down. Offline is rare
                enough that it can just take the space when it happens. */}
            {!g.online && (
              <p className="mt-1">
                <span className="rounded-full bg-yolk/60 px-2 py-[3px] text-[11px] font-semibold leading-none text-scrim">
                  offline — saved
                </span>
              </p>
            )}
          </div>

          {/* Its own row: crowded against the menu button it read as part of the
              title. Left, so it lines up with the title and the list it acts on
              rather than stacking under the menu button. Quiet, because it throws
              the whole list away — the undo toast is the safety net, so it doesn't
              need to shout for confirmation. */}
          {g.items.length > 0 && (
            <div className="mt-2 flex justify-start">
              <button
                onClick={clearList}
                className="rounded-full bg-char/5 px-3.5 py-1.5 text-sm font-medium text-smoke"
              >
                Clear list
              </button>
            </div>
          )}

          {/* Manual add — the common case, the fastest path */}
          <div className="mt-3 flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addManual()}
              enterKeyHint="go"
              placeholder="paper towels, coffee, 3 lemons…"
              className="w-full select-text rounded-xl border border-char/15 bg-surface px-4 py-3 text-base outline-none placeholder:text-smoke/70 focus:border-flame"
            />
            <motion.button
              whileTap={{ scale: 0.9 }}
              transition={springUI}
              onClick={addManual}
              // Cancelling pointerdown stops the button stealing focus from the
              // input, so the keyboard stays up across a burst of adds.
              onPointerDown={(e) => e.preventDefault()}
              disabled={!input.trim()}
              // On add it flips to a white background with a brand-coloured check for
              // 500ms, then eases back. Kept fully lit during the flash even though
              // the emptied input has technically disabled the button. A fixed 24px
              // box keeps the + and ✓ on one footprint so the width can't jump.
              className={`flex shrink-0 items-center justify-center rounded-xl px-4 font-display text-xl font-bold transition-colors duration-200 ${
                justAdded ? "bg-chalk text-flame" : "bg-flame text-accent-ink"
              } ${!input.trim() && !justAdded ? "opacity-40" : ""}`}
            >
              <span className="flex h-6 w-6 items-center justify-center">
                {justAdded ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    className="h-6 w-6"
                  >
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    className="h-6 w-6"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                )}
              </span>
            </motion.button>
          </div>

          <div>
            {g.hydrated && g.items.length === 0 && (
              <p className="mt-16 text-center text-smoke">The list is empty. Add anything.</p>
            )}

            {/* Grouped by store section — walk the store once */}
            {sectionsWithItems.map(({ section, items: sectionItems }) => (
              <section key={section} className="mt-5">
                <h2 className="font-display text-xs font-bold uppercase tracking-widest text-smoke">
                  {SECTION_LABELS[section]}
                </h2>
                <motion.ul layout className="mt-1.5 space-y-1">
                  <AnimatePresence mode="popLayout">
                    {sectionItems.map((item) => (
                      <Row
                        key={item.id}
                        item={item}
                        merged={mergedFlash.has(item.id)}
                        onToggle={() => g.toggle(item)}
                        onRemove={() => removeItem(item)}
                        onEdit={() => setEditing(item)}
                      />
                    ))}
                  </AnimatePresence>
                </motion.ul>
              </section>
            ))}

            {/* Checked items demote here rather than disappear */}
            {checked.length > 0 && (
              <section className="mt-7 border-t border-dashed border-char/20 pt-4">
                <h2 className="font-display text-xs font-bold uppercase tracking-widest text-herb">
                  In the cart
                </h2>
                <motion.ul layout className="mt-1.5 space-y-1">
                  <AnimatePresence mode="popLayout">
                    {checked.map((item) => (
                      <Row
                        key={item.id}
                        item={item}
                        merged={false}
                        onToggle={() => g.toggle(item)}
                        onRemove={() => removeItem(item)}
                        onEdit={() => setEditing(item)}
                      />
                    ))}
                  </AnimatePresence>
                </motion.ul>
              </section>
            )}
          </div>
        </div>
      </PullToRefresh>

      <AnimatePresence>
        {editing && (
          <EditSheet
            key={editing.id}
            item={editing}
            onCancel={() => setEditing(null)}
            onSave={saveEdit}
          />
        )}
      </AnimatePresence>

      <UndoToast toast={toast} onUndo={undo} />
    </main>
  );
}

/**
 * Long press opens this — everything about an item is edited in one place:
 * the quantity you forgot at add time ("coconut water" → "2 cans"), the name,
 * and the aisle it belongs in.
 */
function EditSheet({
  item,
  onCancel,
  onSave,
}: {
  item: GroceryItem;
  onCancel: () => void;
  onSave: (name: string, quantity: string, section: GrocerySection) => void;
}) {
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(item.quantity ?? "");
  const [section, setSection] = useState<GrocerySection>(item.section);
  const qtyRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    qtyRef.current?.focus();
  }, []);

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onCancel}
        className="fixed inset-0 z-50 bg-scrim/40"
      />
      <motion.form
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={springUI}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(name, quantity, section);
        }}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-2xl rounded-t-3xl bg-tile p-5 pb-[max(env(safe-area-inset-bottom),20px)]"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-char/15" />
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Item"
            className="min-w-0 flex-1 select-text rounded-xl border border-char/15 bg-surface px-4 py-3 text-base outline-none focus:border-flame"
          />
          <input
            ref={qtyRef}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="2 cans"
            aria-label="How much"
            className="w-28 shrink-0 select-text rounded-xl border border-char/15 bg-surface px-3 py-3 text-base outline-none placeholder:text-smoke/70 focus:border-flame"
          />
        </div>
        <p className="mt-4 px-1 text-xs font-bold uppercase tracking-widest text-smoke">Aisle</p>
        <div className="no-scrollbar -mx-5 mt-2 flex gap-2 overflow-x-auto px-5 pb-1">
          {GROCERY_SECTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSection(s)}
              className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-medium ${
                section === s ? "bg-char text-tile" : "bg-surface text-smoke"
              }`}
            >
              {SECTION_LABELS[s]}
            </button>
          ))}
        </div>
        {section !== item.section && (
          <p className="mt-2 text-xs text-smoke">
            Corrections stick — {item.name} will land in {SECTION_LABELS[section]} from now on.
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-char/15 py-3 text-sm font-semibold text-smoke"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="flex-[2] rounded-xl bg-char py-3 font-display font-bold text-tile disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </motion.form>
    </>
  );
}

/** Past this much horizontal travel, letting go deletes. */
const SWIPE_KILL = 96;
/** Hold this long and the editor opens. */

function Row({
  item,
  merged,
  onToggle,
  onRemove,
  onEdit,
}: {
  item: GroceryItem;
  merged: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onEdit: () => void;
}) {
  const sourceLabels = (item.sources ?? []).map((s) => s.label).filter(Boolean) as string[];

  // Set by a swipe, so the click that trails it is ignored.
  const gestured = useRef(false);

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={
        merged ? { opacity: 1, y: 0, scale: [1, 1.03, 1] } : { opacity: 1, y: 0, scale: 1 }
      }
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.15 } }}
      transition={merged ? { duration: 0.7 } : springOvershoot}
      whileTap={{ scale: 0.985 }}
      drag="x"
      dragDirectionLock
      dragConstraints={{ left: -200, right: 0 }}
      dragElastic={{ left: 0.6, right: 0 }}
      onDragStart={() => {
        gestured.current = true;
      }}
      onDragEnd={(_, info) => {
        if (info.offset.x < -SWIPE_KILL || info.velocity.x < -600) onRemove();
      }}
      onClick={() => {
        // Swallow the click that trails a swipe.
        if (gestured.current) {
          gestured.current = false;
          return;
        }
        // Ticking off is the circle's job now, so the row itself opens the
        // sheet — the thing that used to need a 450ms hold to discover.
        onEdit();
      }}
      style={{ touchAction: "pan-y" }}
      className={`relative flex cursor-pointer select-none items-center gap-3 rounded-xl border border-char/8 bg-surface px-3 py-2.5 ${
        item.checked ? "opacity-60" : ""
      } ${merged ? "bg-yolk/30" : ""}`}
    >
      {/* The negative margin cancels the padding for layout, so the button
          carries a 44px touch target without the row growing around it. */}
      <button
        onClick={(e) => {
          // Without this the row's handler fires too and opens the sheet.
          e.stopPropagation();
          onToggle();
        }}
        aria-label={item.checked ? `Uncheck ${item.name}` : `Check off ${item.name}`}
        aria-pressed={item.checked}
        className="-m-1.5 shrink-0 p-1.5"
      >
        <span
          aria-hidden
          className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold ${
            item.checked ? "border-herb bg-herb text-chalk" : "border-char/25 text-transparent"
          }`}
        >
          ✓
        </span>
      </button>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[15px] ${item.checked ? "line-through" : ""}`}>
          {item.name}
          {item.quantity && (
            <span className="ml-2 text-sm text-smoke">
              <RollingNumber value={abbreviateUnits(item.quantity)} />
            </span>
          )}
        </span>
        {(sourceLabels.length > 0 || item.carried_over_from) && (
          <span className="block truncate text-xs text-smoke">
            {item.carried_over_from && (
              <span className="mr-1 rounded bg-yolk/50 px-1 text-[10px] font-semibold">
                carried over
              </span>
            )}
            {sourceLabels.join(" · ")}
          </span>
        )}
      </span>
    </motion.li>
  );
}
