"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Recipe } from "@/lib/types";
import { COURSES, COURSE_LABELS, type Course } from "@/lib/config";
import { RecipeCard, SkeletonCard } from "./RecipeCard";
import { RecipeDetail } from "./RecipeDetail";
import { UndoToast, useUndoToast } from "./UndoToast";
import { springSoft } from "@/lib/springs";
import {
  ensureSessionBaseline,
  getSessionBaseline,
  getSessionSeed,
  getShuffleEnabled,
  seededShuffle,
  SHUFFLE_CHANGED_EVENT,
} from "@/lib/libraryShuffle";

// Long enough that flipping between tabs doesn't refetch, short enough that
// coming back from Safari after a share always shows the new capture.
const RESYNC_THROTTLE_MS = 3000;

export function LibraryApp({ initialRecipeId }: { initialRecipeId?: string }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openRecipe, setOpenRecipe] = useState<Recipe | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  // "Shuffle library" preference — read after mount (localStorage isn't there on
  // the server) and kept in sync when it's toggled from the side menu.
  const [shuffle, setShuffle] = useState(false);
  const lastLoadAt = useRef(0);
  const { toast, show, undo } = useUndoToast();
  // Deletes are deferred through the undo window, so the row still exists
  // server-side. Hide it from any refetch that lands in the meantime.
  const pendingDeletes = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    lastLoadAt.current = Date.now();
    const res = await fetch("/api/recipes?sort=recent");
    if (!res.ok) return;
    const json = await res.json();
    const next = (json.recipes ?? []).filter(
      (r: Recipe) => !pendingDeletes.current.has(r.id)
    );
    // Snapshot the ids present now (once per session), so captures that arrive
    // later — Safari shortcut included — count as "new" and pin to the top.
    ensureSessionBaseline(next.map((r: Recipe) => r.id));
    setRecipes(next);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Pick up the shuffle preference on mount, and follow it live when it's
  // flipped in the side menu (a different component, so we sync via the event).
  useEffect(() => {
    setShuffle(getShuffleEnabled());
    const onChange = () => setShuffle(getShuffleEnabled());
    window.addEventListener(SHUFFLE_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(SHUFFLE_CHANGED_EVENT, onChange);
  }, []);

  // Open detail for deep links (/recipes/[id])
  useEffect(() => {
    if (initialRecipeId && loaded && !openRecipe) {
      const r = recipes.find((x) => x.id === initialRecipeId);
      if (r) setOpenRecipe(r);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRecipeId, loaded]);

  // Poll while anything is capturing — this is what turns the skeleton card
  // into the materialize moment without a refresh. The poll itself only asks
  // for statuses (bytes, not the whole library); the one full refetch happens
  // when a status actually changes. If the status call ever fails, fall back
  // to the old full-load poll rather than stalling the skeleton forever.
  const capturingIds = recipes
    .filter((r) => r.capture_status === "pending" || r.capture_status === "processing")
    .map((r) => r.id)
    .join(",");
  useEffect(() => {
    if (!capturingIds) return;
    const tick = async () => {
      try {
        const res = await fetch(`/api/recipes/status?ids=${capturingIds}`);
        if (!res.ok) throw new Error();
        const json = await res.json();
        const statuses: { id: string; capture_status: string }[] = json.statuses ?? [];
        const changed = statuses.some(
          (s) => s.capture_status !== "pending" && s.capture_status !== "processing"
        );
        // A deleted row disappears from the response; reconcile then too.
        if (changed || statuses.length !== capturingIds.split(",").length) load();
      } catch {
        load();
      }
    };
    const t = setInterval(tick, 2500);
    return () => clearInterval(t);
  }, [capturingIds, load]);

  // A capture just happened (from the capture sheet) — refetch immediately.
  useEffect(() => {
    const handler = () => load();
    window.addEventListener("recipe-captured", handler);
    return () => window.removeEventListener("recipe-captured", handler);
  }, [load]);

  /**
   * Captures can also arrive from outside the app entirely — the iOS share
   * sheet shortcut. Nothing in-page fires then, so coming back to a still-
   * running PWA would show a stale library until a cold start. Resync on
   * focus/visibility, throttled so tab-flipping doesn't hammer the API.
   */
  useEffect(() => {
    const resync = () => {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - lastLoadAt.current < RESYNC_THROTTLE_MS) return;
      lastLoadAt.current = Date.now();
      load();
    };
    window.addEventListener("focus", resync);
    window.addEventListener("pageshow", resync);
    document.addEventListener("visibilitychange", resync);
    return () => {
      window.removeEventListener("focus", resync);
      window.removeEventListener("pageshow", resync);
      document.removeEventListener("visibilitychange", resync);
    };
  }, [load]);

  function openDetail(r: Recipe) {
    setOpenRecipe(r);
    window.history.pushState({ recipeId: r.id }, "", `/recipes/${r.id}`);
  }
  const closeDetail = useCallback(() => {
    setOpenRecipe(null);
    if (window.location.pathname.startsWith("/recipes/")) {
      window.history.pushState({}, "", "/");
    }
  }, []);
  useEffect(() => {
    const onPop = () => setOpenRecipe(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // Tapping the Library tab while a recipe sheet is open closes the sheet.
  useEffect(() => {
    window.addEventListener("library-tab-tapped", closeDetail);
    return () => window.removeEventListener("library-tab-tapped", closeDetail);
  }, [closeDetail]);

  function onRecipeChanged(updated: Recipe) {
    setRecipes((rs) => rs.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
  }

  /**
   * Deferred delete: the row is untouched until the undo window closes, so
   * undo is lossless — nothing to half-restore, no orphaned image files.
   */
  function deleteRecipe(r: Recipe) {
    closeDetail();
    pendingDeletes.current.add(r.id);
    setRecipes((rs) => rs.filter((x) => x.id !== r.id));
    show(
      `Deleted ${r.title}`,
      () => {
        // Nothing was deleted server-side — just stop hiding it and refetch.
        pendingDeletes.current.delete(r.id);
        return load();
      },
      async () => {
        await fetch(`/api/recipes/${r.id}`, { method: "DELETE" });
        pendingDeletes.current.delete(r.id);
      }
    );
  }

  async function retry(r: Recipe) {
    setRecipes((rs) =>
      rs.map((x) => (x.id === r.id ? { ...x, capture_status: "pending" as const } : x))
    );
    await fetch(`/api/recipes/${r.id}/retry`, { method: "POST" });
  }

  // Order first: new→old as fetched, or a stable per-session shuffle when the
  // preference is on, so recipes buried at the bottom get surfaced each launch.
  // Recipes captured *this session* (not in the baseline) are pinned to the top
  // in recent order rather than scattered by the shuffle — so a just-saved
  // recipe is where you expect it. A cold start clears the baseline, folding
  // them back into the shuffle with everything else.
  const ordered = useMemo(() => {
    if (!shuffle) return recipes;
    const baseline = getSessionBaseline();
    const fresh = recipes.filter((r) => !baseline.has(r.id));
    const rest = recipes.filter((r) => baseline.has(r.id));
    return [...fresh, ...seededShuffle(rest, getSessionSeed())];
  }, [recipes, shuffle]);

  // Course filter. Null (a pre-backfill recipe) matches no pill, so it shows
  // only under All — never stranded, just uncategorized until classified.
  const shown = useMemo(
    () => (course ? ordered.filter((r) => r.course === course) : ordered),
    [ordered, course]
  );

  const duplicate = useMemo(() => {
    const flagged = recipes.find((r) => r.possible_duplicate_of && r.capture_status === "ready");
    if (!flagged) return null;
    const original = recipes.find((r) => r.id === flagged.possible_duplicate_of);
    return original ? { flagged, original } : null;
  }, [recipes]);

  async function dismissDuplicate(remove: boolean) {
    if (!duplicate) return;
    if (remove) {
      await fetch(`/api/recipes/${duplicate.flagged.id}`, { method: "DELETE" });
      setRecipes((rs) => rs.filter((r) => r.id !== duplicate.flagged.id));
    } else {
      await fetch(`/api/recipes/${duplicate.flagged.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ possible_duplicate_of: null }),
      });
      onRecipeChanged({ ...duplicate.flagged, possible_duplicate_of: null });
    }
  }

  return (
    <main className="px-4 pt-[max(env(safe-area-inset-top),16px)]">
      {/* pr-11 clears the fixed hamburger button */}
      <h1 className="pr-11 font-display text-3xl font-bold">Library</h1>

      {recipes.length > 0 && (
        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
          <button
            onClick={() => setCourse(null)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${
              course === null ? "bg-char text-tile" : "bg-char/5 text-smoke"
            }`}
          >
            All
          </button>
          {COURSES.map((c) => (
            <button
              key={c}
              onClick={() => setCourse((cur) => (cur === c ? null : c))}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${
                course === c ? "bg-char text-tile" : "bg-char/5 text-smoke"
              }`}
            >
              {COURSE_LABELS[c]}
            </button>
          ))}
        </div>
      )}

      {/* Soft, dismissible duplicate prompt */}
      <AnimatePresence>
        {duplicate && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={springSoft}
            className="mt-3 rounded-xl border border-yolk bg-yolk/20 p-3 text-sm"
          >
            You already have <strong>{duplicate.original.title}</strong> — same one as{" "}
            <strong>{duplicate.flagged.title}</strong>?
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => dismissDuplicate(true)}
                className="rounded-full bg-char px-3 py-1 text-xs font-semibold text-tile"
              >
                Yes, remove the new one
              </button>
              <button
                onClick={() => dismissDuplicate(false)}
                className="rounded-full bg-surface px-3 py-1 text-xs font-semibold"
              >
                No, keep both
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>


      {loaded && shown.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springSoft, delay: 0.1 }}
          className="mt-16 text-center text-smoke"
        >
          {course ? (
            <>
              <p className="font-display text-lg font-bold text-char/60">
                Nothing in {COURSE_LABELS[course]} yet.
              </p>
              <button
                onClick={() => setCourse(null)}
                className="mt-2 rounded-full bg-char/5 px-3.5 py-1.5 text-sm font-medium text-smoke"
              >
                Show all
              </button>
            </>
          ) : (
            <>
              <p className="font-display text-lg font-bold text-char/60">Almost there.</p>
              <p className="mt-1 text-sm">
                You just need the shortcut installed — takes less than 30 seconds. Then save
                recipes straight from Safari.
              </p>
            </>
          )}
        </motion.div>
      )}

      {/* Skeletons hold the grid's shape while the first load lands. The fade-in
          is delayed so a fast (cached) load never flashes them. */}
      <AnimatePresence>
        {!loaded && (
          <motion.div
            key="skeletons"
            initial={false}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            className="skeleton-enter mt-4 grid grid-cols-2 gap-3"
          >
            {[0, 1, 2, 3].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div layout className="mt-4 grid grid-cols-2 gap-3">
        <AnimatePresence mode="popLayout">
          {shown.map((r, i) => (
            <motion.div
              key={r.id}
              layout
              exit={{ opacity: 0, scale: 0.9 }}
              transition={springSoft}
            >
              {/* Entrance lives on an inner element so its stagger delay never
                  slows down layout moves (reordering, filtering). */}
              <motion.div
                initial={{ opacity: 0, y: 14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ ...springSoft, delay: Math.min(i, 12) * 0.03 }}
              >
                <RecipeCard
                  recipe={r}
                  onOpen={openDetail}
                  onRetry={retry}
                  onLongPress={deleteRecipe}
                />
              </motion.div>
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {openRecipe && (
          <RecipeDetail
            key={openRecipe.id}
            recipe={openRecipe}
            onClose={closeDetail}
            onChanged={onRecipeChanged}
            onDelete={deleteRecipe}
          />
        )}
      </AnimatePresence>

      <UndoToast toast={toast} onUndo={undo} />
    </main>
  );
}
