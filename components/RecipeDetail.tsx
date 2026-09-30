"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { Recipe } from "@/lib/types";
import { scaleIngredientQuantity } from "@/lib/scale";
import { springSoft, springUI } from "@/lib/springs";
import { LoveButton } from "./LoveButton";
import { RollingNumber } from "./RollingNumber";
import { AddToListSheet } from "./AddToListSheet";
import { COURSES, COURSE_LABELS } from "@/lib/config";
import { RecipeImage } from "./RecipeImage";
import { RecipeAsk } from "./RecipeAsk";
import { UndoToast, useUndoToast } from "./UndoToast";

/** Horizontal travel that dismisses the sheet; a fast flick also counts. */
const SWIPE_CLOSE_PX = 90;

export function RecipeDetail({
  recipe: initial,
  onClose,
  onChanged,
  onDelete,
  draft = false,
  onSave,
  saving = false,
}: {
  recipe: Recipe;
  onClose: () => void;
  onChanged: (r: Recipe) => void;
  onDelete: (r: Recipe) => void;
  /**
   * An invented recipe that hasn't been saved yet. It has no row behind it, so
   * everything that reads or writes by id is off: no fetch, no patching, no
   * cook log, no delete. Save is the only action.
   */
  draft?: boolean;
  onSave?: () => void;
  saving?: boolean;
}) {
  const [recipe, setRecipe] = useState<Recipe>(initial);
  const [servings, setServings] = useState<number>(initial.servings ?? 4);
  const [notes, setNotes] = useState(initial.notes);
  const [notesFocused, setNotesFocused] = useState(false);
  const { toast, show: showToast, undo } = useUndoToast();
  const [addedToList, setAddedToList] = useState(false);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [imageStatus, setImageStatus] = useState<"idle" | "working" | "failed">("idle");
  const [imageError, setImageError] = useState<string | null>(null);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  // Notes box hugs its content — grow to fit, never scroll. The container's
  // min-height gives it a floor so a short note still has room to write in.
  useEffect(() => {
    const el = notesRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [notes]);

  // Load the full record (cook log) once open. A draft has no row to load.
  useEffect(() => {
    if (draft) return;
    fetch(`/api/recipes/${initial.id}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.recipe) {
          setRecipe(json.recipe);
          setNotes(json.recipe.notes);
          if (json.recipe.servings) setServings(json.recipe.servings);
        }
      });
  }, [initial.id, draft]);

  async function patch(fields: Partial<Recipe>) {
    if (draft) return;
    const before = recipe;
    const optimistic = { ...recipe, ...fields } as Recipe;
    setRecipe(optimistic);
    onChanged(optimistic);
    // If the save fails, roll the optimistic change back — a silent failure
    // here once made course edits look saved until the next reopen reverted
    // them (the field was missing from the PATCH allowlist).
    try {
      const res = await fetch(`/api/recipes/${recipe.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error();
    } catch {
      setRecipe(before);
      onChanged(before);
    }
  }

  function onNotesChange(v: string) {
    setNotes(v);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => patch({ notes: v }), 700);
  }

  /** Wipe the notes, drop the keyboard, and offer an undo for a few seconds. */
  function clearNotes() {
    const before = notes;
    if (!before.trim()) return;
    if (notesTimer.current) clearTimeout(notesTimer.current);
    setNotes("");
    patch({ notes: "" });
    notesRef.current?.blur();
    setNotesFocused(false);
    showToast("Notes cleared", () => {
      setNotes(before);
      patch({ notes: before });
    });
  }

  /** Tuck an Ask answer into the notes — visible immediately, saved now. */
  function appendNote(line: string) {
    const clean = line.trim();
    if (!clean) return;
    if (notesTimer.current) clearTimeout(notesTimer.current);
    const next = notes.trim() ? `${notes.trim()}\n${clean}` : clean;
    setNotes(next);
    patch({ notes: next });
  }

  async function fetchImage() {
    setImageStatus("working");
    const res = await fetch(`/api/recipes/${recipe.id}/image`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.recipe) {
      setRecipe(json.recipe);
      onChanged(json.recipe);
      setImageStatus("idle");
    } else {
      setImageError(json.error ?? "Couldn't find an image on that page.");
      setImageStatus("failed");
    }
  }

  async function uploadImage(file: File) {
    setImageStatus("working");
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`/api/recipes/${recipe.id}/image`, { method: "PUT", body });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.recipe) {
      setRecipe(json.recipe);
      onChanged(json.recipe);
      setImageStatus("idle");
    } else {
      setImageError(json.error ?? "Upload failed.");
      setImageStatus("failed");
    }
  }

  // The sheet handles the flight animation and the re-sync on confirm.

  const factor = recipe.servings ? servings / recipe.servings : 1;

  const sections = useMemo(() => {
    const groups = new Map<string, typeof recipe.ingredients>();
    for (const ing of recipe.ingredients) {
      const key = ing.section ?? "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(ing);
    }
    return [...groups.entries()];
  }, [recipe.ingredients]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-scrim/50"
      />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24, transition: { duration: 0.18 } }}
        transition={springSoft}
        /**
         * Swipe sideways to dismiss, either direction.
         *
         * Deliberately NO dragDirectionLock: it commits to an axis within the
         * first few pixels, so a swipe that begins with any downward drift
         * locked to vertical and threw away every horizontal pixel after it.
         * Instead the whole gesture is judged at release — the horizontal
         * travel merely has to dominate, within a wide cone. Vertical
         * scrolling stays native (touch-action: pan-y), and the browser
         * cancels the drag once it takes the gesture over as a scroll.
         */
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.55}
        onDragEnd={(_, info) => {
          const dx = info.offset.x;
          const dy = info.offset.y;
          // ~59° cone: sideways only has to beat 0.6× the vertical travel.
          const mostlySideways = Math.abs(dx) > Math.abs(dy) * 0.6;
          const far = Math.abs(dx) > SWIPE_CLOSE_PX;
          const fast = Math.abs(info.velocity.x) > 350;
          if (mostlySideways && (far || fast)) onClose();
        }}
        className="fixed inset-x-0 bottom-0 top-[max(env(safe-area-inset-top),12px)] z-40 mx-auto max-w-2xl overflow-y-auto rounded-t-3xl bg-tile shadow-2xl"
      >
        <div className="relative">
          {recipe.image_url ? (
            <RecipeImage
              src={recipe.image_url}
              layoutId={`img-${recipe.id}`}
              className="h-56 w-full rounded-t-3xl object-cover"
            />
          ) : (
            <motion.div
              layoutId={`img-${recipe.id}`}
              className="flex h-40 w-full items-end rounded-t-3xl bg-gradient-to-br from-yolk/40 to-flame/25"
            />
          )}
          {/* Photo controls. Plenty of recipes legitimately have no image —
              these are quiet options, never an error state. */}
          {/* Fetch-from-source stays a labelled button, bottom-left — it's a rare
              one-off (only when there's no image yet). Replace/own-photo moved to
              the top-right control stack as an icon. */}
          {!recipe.image_url && recipe.source_url && !draft && (
            <div className="absolute bottom-3 left-3">
              <motion.button
                whileTap={{ scale: 0.96 }}
                transition={springUI}
                onClick={fetchImage}
                disabled={imageStatus === "working"}
                className="rounded-full bg-scrim/70 px-3 py-1.5 text-xs font-semibold text-chalk backdrop-blur disabled:opacity-60"
              >
                {imageStatus === "working" ? "Looking…" : "Fetch from source"}
              </motion.button>
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // allow re-picking the same file
              if (file) uploadImage(file);
            }}
          />
          {/* Top-right control stack: close, then love, then replace-photo — the
              things you can do to a recipe without scrolling, 16px apart. Love
              and replace are hidden on a draft (no row yet, no photo to swap). */}
          <div className="absolute right-3 top-3 flex flex-col items-center gap-4">
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-scrim/60 text-chalk backdrop-blur"
            >
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
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            {!draft && (
              <LoveButton
                loved={(recipe.hearts ?? 0) > 0}
                onToggle={() => patch({ hearts: (recipe.hearts ?? 0) > 0 ? null : 5 })}
              />
            )}
            {!draft && (
              <motion.button
                whileTap={{ scale: 0.96 }}
                transition={springUI}
                onClick={() => fileInput.current?.click()}
                disabled={imageStatus === "working"}
                aria-label={recipe.image_url ? "Replace photo" : "Use my own photo"}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-scrim/60 text-chalk backdrop-blur disabled:opacity-60"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                  className="h-5 w-5"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2.5" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
              </motion.button>
            )}
          </div>
        </div>

        <div className="p-5 pb-28">
          <motion.h1
            layoutId={`title-${recipe.id}`}
            className="font-display text-2xl font-bold leading-tight"
          >
            {recipe.title}
          </motion.h1>
          {recipe.description && <p className="mt-1.5 text-[15px] text-char/70">{recipe.description}</p>}
          {imageStatus === "failed" && imageError && (
            <p className="mt-2 rounded-lg bg-flame/10 px-3 py-2 text-sm text-flame">
              {imageError} You can still add your own photo.
            </p>
          )}

          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-smoke">
            {recipe.time_active_min != null && <span>{recipe.time_active_min}m active</span>}
            {recipe.time_total_min != null && <span>{recipe.time_total_min}m total</span>}
            {recipe.cuisine && <span>{recipe.cuisine}</span>}
            {recipe.source_url && (
              <a href={recipe.source_url} target="_blank" className="underline underline-offset-2">
                {recipe.source_name ?? "source"} ↗
              </a>
            )}
          </div>

          {recipe.capture_gaps.length > 0 && (
            <p className="mt-3 rounded-lg bg-yolk/25 px-3 py-2 text-sm text-char/80">
              {draft ? "Worth knowing" : "This capture might be incomplete"}:{" "}
              {recipe.capture_gaps.join("; ")}
            </p>
          )}

          {draft && (
            <div className="mt-4">
              <motion.button
                whileTap={{ scale: 0.97 }}
                transition={springUI}
                onClick={onSave}
                disabled={saving}
                className="w-full rounded-xl bg-flame py-3.5 font-display font-bold text-accent-ink disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save to my library"}
              </motion.button>
              <p className="mt-2 text-center text-xs text-smoke">
                Nobody&apos;s cooked this yet. Save it and you can add a photo once you have.
              </p>
            </div>
          )}

          {/* Category — hand-fix what the model guessed. Same patch() as every
              other field, so a tap writes immediately. */}
          {!draft && (
            <div className="mt-4">
              <p className="px-1 text-xs font-semibold uppercase tracking-wide text-smoke">Category</p>
              {/* Wraps rather than scrolls: this is a pick-one control, so all
                  options should be visible at once, not discovered by scrolling. */}
              <div className="mt-1.5 flex flex-wrap gap-2">
                {COURSES.map((c) => {
                  const active = (recipe.course ?? "misc") === c;
                  return (
                    <button
                      key={c}
                      onClick={() => patch({ course: c })}
                      className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${
                        active ? "bg-char text-tile" : "bg-char/5 text-smoke"
                      }`}
                    >
                      {COURSE_LABELS[c]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* My notes — first-class, always visible, handwriting on yolk */}
          {!draft && (
          <div className="mt-4 min-h-[75px] -rotate-[0.4deg] rounded-xl bg-yolk/40 p-3 shadow-sm">
            <div className="flex items-start justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-char/60">My notes</p>
              <AnimatePresence>
                {notesFocused && notes.trim() && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={springUI}
                    // Fire on pointer-down and keep focus so the tap isn't lost
                    // when the button unmounts; clearNotes drops the keyboard itself.
                    onPointerDown={(e) => {
                      e.preventDefault();
                      clearNotes();
                    }}
                    className="-my-1 shrink-0 rounded-full px-2 py-1 text-xs font-semibold text-flame"
                  >
                    Clear
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
            <textarea
              ref={notesRef}
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              onFocus={() => setNotesFocused(true)}
              onBlur={() => setNotesFocused(false)}
              placeholder="halve the sugar, needs acid at the end…"
              rows={1}
              className="mt-1 w-full resize-none overflow-hidden bg-transparent font-hand text-2xl leading-snug text-char outline-none placeholder:text-char/30"
            />
          </div>
          )}

          {/* Ask about this recipe — substitutions, scaling, method. Grounded in
              this dish and this cook's notes; answers can be saved back to them. */}
          {!draft && <RecipeAsk recipe={recipe} onAppendNote={appendNote} />}

          {/* Servings scaler */}
          {recipe.servings != null && (
            <div className="mt-5 flex items-center gap-4">
              <span className="font-display text-sm font-bold uppercase tracking-wide">Servings</span>
              <div className="flex items-center gap-3 rounded-full bg-surface px-2 py-1">
                <motion.button
                  whileTap={{ scale: 0.85 }}
                  transition={springUI}
                  onClick={() => setServings((s) => Math.max(1, s - 1))}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-char/60"
                >
                  −
                </motion.button>
                <RollingNumber
                  value={String(servings)}
                  className="min-w-6 justify-center font-display text-xl font-bold"
                />
                <motion.button
                  whileTap={{ scale: 0.85 }}
                  transition={springUI}
                  onClick={() => setServings((s) => s + 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-char/60"
                >
                  +
                </motion.button>
              </div>
              {factor !== 1 && (
                <button onClick={() => setServings(recipe.servings!)} className="text-sm text-smoke underline">
                  reset
                </button>
              )}
            </div>
          )}

          {/* Ingredients */}
          <h2 className="mt-5 font-display text-lg font-bold">Ingredients</h2>
          {sections.map(([sectionName, ings]) => (
            <div key={sectionName || "_"} className="mt-2">
              {sectionName && (
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-smoke">{sectionName}</p>
              )}
              <ul className="space-y-1.5">
                {ings.map((ing, i) => {
                  const { display, roundedNote } = scaleIngredientQuantity(ing.quantity, ing.item, factor);
                  // One flowing line with a bold quantity, rather than a quantity
                  // column — amounts like "1 14-ounce can/jar" vary so much in
                  // width that a column leaves every row starting at a different
                  // x.
                  return (
                    <li key={i} className="text-[15px]">
                      {(display || ing.unit) && (
                        <span className="font-semibold">
                          {display && <RollingNumber value={display} />}
                          {ing.unit ? ` ${ing.unit}` : ""}
                        </span>
                      )}{" "}
                      {ing.item}
                      {ing.note && <span className="text-smoke"> — {ing.note}</span>}
                      {roundedNote && <span className="text-flame/80"> ({roundedNote})</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {!draft && (
          <motion.button
            whileTap={{ scale: 0.97 }}
            transition={springUI}
            onClick={() => setAddSheetOpen(true)}
            className={`mt-3 rounded-full px-4 py-2 text-sm font-semibold ${
              // char flips between themes, so its text must be tile (the inverse),
              // not chalk (always light) — that's invisible in dark mode.
              addedToList ? "bg-herb text-chalk" : "bg-char text-tile"
            }`}
          >
            {addedToList ? "✓ On the list" : "Add ingredients to grocery list"}
          </motion.button>
          )}

          {/* Steps */}
          <div className="mt-6 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">Steps</h2>
            {recipe.steps.length > 0 && (
              <Link
                href={`/cook/${recipe.id}`}
                className="rounded-full bg-flame px-4 py-2 font-display text-sm font-bold text-accent-ink"
              >
                Cook mode
              </Link>
            )}
          </div>
          <ol className="mt-2 space-y-3">
            {recipe.steps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-char/8 font-display text-xs font-bold">
                  {i + 1}
                </span>
                <p className="text-[15px] leading-relaxed">
                  {step.text}
                  {step.timer_seconds != null && (
                    <span className="ml-2 rounded-full bg-flame/10 px-2 py-0.5 text-xs font-semibold text-flame">
                      ⏱ {Math.round(step.timer_seconds / 60)}m
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ol>

          {/* Cook log */}
          {!draft && (
          <>
          {/* Delete — no confirm dialog; the undo toast is the safety net. */}
          <div className="mt-8 border-t border-char/10 pt-4">
            <button
              onClick={() => onDelete(recipe)}
              className="text-sm font-semibold text-flame"
            >
              Delete this recipe
            </button>
            <p className="mt-1 text-xs text-smoke">
              Removes it and its photos for good. You&apos;ll get a few seconds to undo.
            </p>
          </div>
          </>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {addSheetOpen && (
          <AddToListSheet
            source={{ recipe_id: recipe.id }}
            title={`Add for ${recipe.title}`}
            onClose={() => setAddSheetOpen(false)}
            onAdded={() => setAddedToList(true)}
          />
        )}
      </AnimatePresence>

      <UndoToast toast={toast} onUndo={undo} />

    </>
  );
}
