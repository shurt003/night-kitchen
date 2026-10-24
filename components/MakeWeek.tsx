"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { Recipe } from "@/lib/types";
import type { Extraction } from "@/lib/schemas";
import { springUI } from "@/lib/springs";
import { draftRecipe } from "@/lib/draftRecipe";
import { MAKE_WEEK_SESSION_KEY } from "@/lib/userCache";
import { DAY_NAMES, WEEK_NIGHT_CHOICES, WEEK_PEOPLE_CHOICES, type WeekOutline } from "@/lib/weekPlan";
import { RecipeDetail } from "./RecipeDetail";
import { AddToListSheet } from "./AddToListSheet";
import { EditableTitle } from "./EditableTitle";
import { CyclingLine } from "./CyclingLine";
import { Spinner } from "./Spinner";
import { WeekView, type WeekSlot } from "./WeekView";

/**
 * Plan the week, on the Make page: quick taps for nights, people and a prep
 * day; one wait while the week is planned and every recipe written (in
 * parallel — a week is too much for one call); then the week laid out by
 * night, each night its own recipe so Swap means just that night.
 * docs/MAKE_PLAN.md, Phase 2.6.
 */

/** A recipe being written, written, or not — keyed "c:<component>" or "n:<night>". */
type Written = Extraction | "failed";
type Week = {
  request: string;
  people: number;
  prepDays: string[];
  outline: WeekOutline;
  recipes: Record<string, Written>;
};
type Job = { ref: string; label: string; write: { component: string } | { night: number } };
type Progress = { ref: string; label: string; state: "pending" | "done" | "failed" };

/** How many recipes are written at once — fast, without flooding the API. */
const CONCURRENCY = 6;
const SESSION_TTL = 12 * 60 * 60 * 1000;

const PLANNING_LINES = [
  "Looking at the whole week…",
  "Deciding what to cook ahead…",
  "Working out the leftovers…",
  "Mixing up the cuisines…",
  "Checking your staples…",
];

function jobsFor(outline: WeekOutline): Job[] {
  return [
    ...outline.components.map((c) => ({ ref: `c:${c.key}`, label: c.title, write: { component: c.key } })),
    ...outline.nights
      .filter((n) => n.kind !== "reheat")
      .map((n) => ({ ref: `n:${n.night}`, label: `${n.label} · ${n.title}`, write: { night: n.night } })),
  ];
}

export function MakeWeek({
  ask,
  presetNights,
  resetSignal,
}: {
  ask: string;
  /** Nights the cook's words named, when Make switched here from "Cook something". */
  presetNights: number | null;
  /** Bumped when the text box is cleared — start over. */
  resetSignal: number;
}) {
  const [nights, setNights] = useState<number>(5);
  const [people, setPeople] = useState<number>(2);
  /** Any days; empty is "None". */
  const [prepDays, setPrepDays] = useState<string[]>([]);
  const [week, setWeek] = useState<Week | null>(null);
  const [saved, setSaved] = useState<Record<string, Recipe>>({});
  const [title, setTitle] = useState<string | null>(null);
  const [mealId, setMealId] = useState<string | null>(null);

  const [phase, setPhase] = useState<null | "planning" | "writing">(null);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [swapping, setSwapping] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const [sheet, setSheet] = useState<string | null>(null);
  const [savingRef, setSavingRef] = useState<string | null>(null);
  const [savingWeek, setSavingWeek] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  /** The recipes the confirm sheet adds — set when it opens. */
  const [addIds, setAddIds] = useState<string[]>([]);
  const [addedCount, setAddedCount] = useState<number | null>(null);

  useEffect(() => {
    if (presetNights) setNights(Math.min(7, Math.max(3, presetNights)));
  }, [presetNights]);

  // The week survives leaving the page (or the PWA being evicted) — it's a
  // minute-long wait you don't want to repeat.
  const skipSave = useRef(true);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(MAKE_WEEK_SESSION_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (!s.saved_at || Date.now() - s.saved_at > SESSION_TTL) return;
      setNights(s.nights ?? 5);
      setPeople(s.people ?? 2);
      // An older session held one prep day.
      setPrepDays(Array.isArray(s.prepDays) ? s.prepDays : s.prepDay ? [s.prepDay] : []);
      setWeek(s.week ?? null);
      setSaved(s.saved ?? {});
      setTitle(s.title ?? null);
      setMealId(s.mealId ?? null);
    } catch {
      // corrupt/blocked storage — start clean
    }
  }, []);
  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    try {
      localStorage.setItem(
        MAKE_WEEK_SESSION_KEY,
        JSON.stringify({ nights, people, prepDays, week, saved, title, mealId, saved_at: Date.now() })
      );
    } catch {
      // out of quota or private mode — the page just forgets on leave
    }
  }, [nights, people, prepDays, week, saved, title, mealId]);

  const firstReset = useRef(true);
  useEffect(() => {
    if (firstReset.current) {
      firstReset.current = false;
      return;
    }
    setWeek(null);
    setSaved({});
    setTitle(null);
    setMealId(null);
    setError(null);
    setAddedCount(null);
  }, [resetSignal]);

  async function writeOne(w: Week, job: Job, signal: AbortSignal): Promise<Written> {
    try {
      const res = await fetch("/api/make/week/recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: w.request, outline: w.outline, people: w.people, write: job.write }),
        signal,
      });
      const json = await res.json();
      return res.ok ? (json.recipe as Extraction) : "failed";
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      return "failed";
    }
  }

  async function planWeek() {
    if (!ask.trim() || phase) return;
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setAddedCount(null);
    setPhase("planning");
    try {
      const res = await fetch("/api/make/week/outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: ask, nights, people, prep_days: prepDays, today_dow: new Date().getDay() }),
        signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't plan that week.");
      const draft: Week = { request: ask.trim(), people, prepDays, outline: json.outline, recipes: {} };

      // Every recipe at once (a few at a time), each against the outline.
      const jobs = jobsFor(draft.outline);
      setProgress(jobs.map((j) => ({ ref: j.ref, label: j.label, state: "pending" })));
      setPhase("writing");
      const recipes: Record<string, Written> = {};
      let next = 0;
      const worker = async () => {
        while (next < jobs.length) {
          const job = jobs[next++];
          const r = await writeOne(draft, job, controller.signal);
          recipes[job.ref] = r;
          setProgress((p) => p.map((x) => (x.ref === job.ref ? { ...x, state: r === "failed" ? "failed" : "done" } : x)));
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));

      if (jobs.length && jobs.every((j) => recipes[j.ref] === "failed")) {
        throw new Error("None of the recipes would write — try again.");
      }
      setWeek({ ...draft, recipes });
      setSaved({});
      setTitle(draft.outline.title);
      setMealId(null);
    } catch (e) {
      // Cancelling is a choice, not a failure — no banner for it.
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : "Couldn't plan that week.");
    } finally {
      abort.current = null;
      setPhase(null);
    }
  }

  /** Rewrite one recipe that failed, in place. */
  async function retry(ref: { component: string } | { night: number }) {
    if (!week) return;
    const key = "component" in ref ? `c:${ref.component}` : `n:${ref.night}`;
    const job = jobsFor(week.outline).find((j) => j.ref === key);
    if (!job) return;
    // Clearing the slot shows it as "Writing…" while it's redone.
    setWeek((w) => {
      if (!w) return w;
      const recipes = { ...w.recipes };
      delete recipes[key];
      return { ...w, recipes };
    });
    const r = await writeOne(week, job, new AbortController().signal);
    setWeek((w) => (w ? { ...w, recipes: { ...w.recipes, [key]: r } } : w));
  }

  /** Replace one night — and only that night. */
  async function swapNight(night: number, hint: string) {
    if (!week || swapping) return;
    const label = week.outline.nights.find((n) => n.night === night)?.label ?? "";
    setSwapping(`A new ${label} dinner`);
    setError(null);
    try {
      const res = await fetch("/api/make/week/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: week.request, outline: week.outline, night, hint, people: week.people }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't swap that night.");
      const key = `n:${night}`;
      setWeek((w) => {
        if (!w) return w;
        const recipes = { ...w.recipes };
        if (json.recipe) recipes[key] = json.recipe as Extraction;
        else delete recipes[key];
        return {
          ...w,
          outline: { ...w.outline, nights: w.outline.nights.map((n) => (n.night === night ? json.night : n)) },
          recipes,
        };
      });
      // The old dinner, if it was saved, stays in the library — a swap never deletes.
      setSaved((s) => {
        const next = { ...s };
        delete next[key];
        return next;
      });
      setAddedCount(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't swap that night.");
    } finally {
      setSwapping(null);
    }
  }

  async function saveOne(ref: string): Promise<Recipe | null> {
    const r = week?.recipes[ref];
    if (!r || r === "failed") return null;
    if (saved[ref]) return saved[ref];
    const res = await fetch("/api/recipes/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipe: r }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Couldn't save that.");
      return null;
    }
    const row = json.recipe as Recipe;
    setSaved((s) => ({ ...s, [ref]: row }));
    return row;
  }

  /**
   * Save every written recipe, then keep the week together in the Library.
   * Resolves the week's recipe ids, or null if anything didn't save.
   */
  async function saveWeek(): Promise<string[] | null> {
    if (!week || savingWeek) return null;
    setSavingWeek(true);
    setError(null);
    const rows: Record<string, Recipe> = {};
    for (const job of jobsFor(week.outline)) {
      if (week.recipes[job.ref] === "failed" || !week.recipes[job.ref]) continue;
      const row = saved[job.ref] ?? (await saveOne(job.ref));
      if (!row) {
        setSavingWeek(false);
        return null;
      }
      rows[job.ref] = row;
    }
    const dishes = Object.entries(rows).map(([ref, row]) =>
      ref.startsWith("c:")
        ? { recipe_id: row.id, night: 0, note: ref.slice(2) }
        : { recipe_id: row.id, night: Number(ref.slice(2)), note: null }
    );
    const body = {
      title: (title ?? "").trim() || week.outline.title,
      request: week.request,
      servings: week.people,
      // The prep sessions live in the outline (one per prep day).
      game_plan: null,
      week: week.outline,
      dishes,
    };
    const res = await fetch(mealId ? `/api/meals/${mealId}` : "/api/meals", {
      method: mealId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mealId ? { ...body, request: undefined } : body),
    });
    const json = await res.json().catch(() => ({}));
    setSavingWeek(false);
    if (!res.ok) {
      setError(json.error ?? "The recipes saved, but the week didn't — try again.");
      return null;
    }
    setMealId(json.meal.id);
    return Object.values(rows).map((r) => r.id);
  }

  /**
   * The master button: everything the week needs, onto the list in one
   * confirm step. A week has to be saved for its ingredients to reach the list,
   * so an unsaved one is saved first — same tap.
   */
  async function addEverything() {
    if (!week || savingWeek) return;
    const ids = allSaved ? writtenRefs.map((r) => saved[r].id) : await saveWeek();
    if (ids?.length) {
      setAddIds(ids);
      setAddOpen(true);
    }
  }

  function slot(ref: string): WeekSlot {
    const r = week?.recipes[ref];
    if (r === "failed") return { state: "failed" };
    if (!r) return { state: "missing" };
    return { state: "ready", saved: !!saved[ref] };
  }

  const writtenRefs = week ? jobsFor(week.outline).filter((j) => week.recipes[j.ref] && week.recipes[j.ref] !== "failed").map((j) => j.ref) : [];
  const allSaved = writtenRefs.length > 0 && writtenRefs.every((r) => saved[r]);
  const sheetRecipe = sheet && week ? week.recipes[sheet] : null;

  return (
    <>
      <OptionRow label="Nights">
        {WEEK_NIGHT_CHOICES.map((n) => (
          <Chip key={n} active={nights === n} onClick={() => setNights(n)}>
            {n}
          </Chip>
        ))}
      </OptionRow>
      <OptionRow label="People">
        {WEEK_PEOPLE_CHOICES.map((n) => (
          <Chip key={n} active={people === n} onClick={() => setPeople(n)}>
            {n}
          </Chip>
        ))}
      </OptionRow>
      {/* Pick any days — two prep days split the week's bulk cooking. */}
      <OptionRow label="Prep days" wrap>
        <Chip active={prepDays.length === 0} onClick={() => setPrepDays([])}>
          None
        </Chip>
        {DAY_NAMES.map((d) => (
          <Chip
            key={d}
            active={prepDays.includes(d)}
            onClick={() =>
              setPrepDays((cur) =>
                cur.includes(d) ? cur.filter((x) => x !== d) : DAY_NAMES.filter((x) => x === d || cur.includes(x))
              )
            }
          >
            {d}
          </Chip>
        ))}
      </OptionRow>

      <motion.button
        whileTap={{ scale: 0.97 }}
        transition={springUI}
        onClick={planWeek}
        disabled={!ask.trim() || !!phase}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-flame py-3.5 font-display font-bold text-accent-ink disabled:opacity-40"
      >
        {week ? "Plan a new week" : "Plan my week"}
      </motion.button>
      {error && <p className="mt-2 text-sm text-flame">{error}</p>}

      {week && (
        <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6">
          <h2 className="font-display text-xs font-bold uppercase tracking-widest text-flame">Your week</h2>
          <EditableTitle
            value={title || week.outline.title}
            onChange={(t) => {
              setTitle(t);
              if (mealId) {
                fetch(`/api/meals/${mealId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ title: t }),
                }).catch(() => {});
              }
            }}
            className="mt-1 font-display text-xl font-bold leading-tight"
          />
          <p className="mt-1 text-sm text-smoke">
            {week.outline.nights.length} nights · {week.people} {week.people === 1 ? "person" : "people"}
          </p>

          <motion.button
            whileTap={{ scale: 0.97 }}
            transition={springUI}
            onClick={addEverything}
            disabled={savingWeek}
            className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3 font-display font-bold disabled:opacity-60 ${
              addedCount ? "bg-herb text-chalk" : "bg-flame text-accent-ink"
            }`}
          >
            {savingWeek && <Spinner className="h-4 w-4" />}
            {savingWeek
              ? "Saving the week…"
              : addedCount
                ? `✓ ${addedCount} on the list`
                : "Add everything to grocery list"}
          </motion.button>

          <div className="mt-4">
            <WeekView
              outline={week.outline}
              componentSlot={(k) => slot(`c:${k}`)}
              nightSlot={(n) => slot(`n:${n}`)}
              onOpenComponent={(k) => setSheet(`c:${k}`)}
              onOpenNight={(n) => setSheet(`n:${n}`)}
              onSwapNight={swapNight}
              onRetry={retry}
            />
          </div>

          <div className="mt-4 space-y-2">
            {!allSaved && (
              <motion.button
                whileTap={{ scale: 0.97 }}
                transition={springUI}
                onClick={saveWeek}
                disabled={savingWeek}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-char py-3 font-display font-bold text-tile disabled:opacity-50"
              >
                {savingWeek && <Spinner className="h-4 w-4" />}
                {savingWeek ? "Saving…" : mealId ? "Save the changes" : "Save the week"}
              </motion.button>
            )}
            {allSaved && mealId && (
              <p className="text-center text-xs text-smoke">
                ✓ Kept together in your Library —{" "}
                <Link href={`/?meal=${mealId}`} className="font-semibold text-char underline underline-offset-2">
                  open it under Meals
                </Link>
              </p>
            )}
          </div>
        </motion.section>
      )}

      {/* One wait for the whole week: planning, then every recipe with a tick
          as it lands — real progress, not a spinner. */}
      <AnimatePresence>
        {(phase || swapping) && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-scrim/50"
            />
            <motion.div
              role="dialog"
              aria-live="polite"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={springUI}
              className="fixed left-1/2 top-1/2 z-50 max-h-[80dvh] w-[min(90vw,22rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-tile p-5 shadow-2xl"
            >
              {phase === "writing" ? (
                <>
                  <p className="font-display text-lg font-bold leading-tight">
                    Writing {Math.min(progress.filter((p) => p.state !== "pending").length + 1, progress.length)} of{" "}
                    {progress.length}…
                  </p>
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {progress.map((p) => (
                      <li key={p.ref} className="flex items-center gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                          {p.state === "pending" ? (
                            <Spinner className="h-3.5 w-3.5 text-smoke" />
                          ) : p.state === "done" ? (
                            <span className="text-herb">✓</span>
                          ) : (
                            <span className="text-flame">!</span>
                          )}
                        </span>
                        <span className={`truncate ${p.state === "pending" ? "text-smoke" : ""}`}>{p.label}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="text-center">
                  <Spinner className="mx-auto h-7 w-7 text-flame" />
                  <p className="mt-3 font-display text-lg font-bold leading-tight">{swapping ?? "Planning your week"}</p>
                  <CyclingLine lines={PLANNING_LINES} className="mt-1 h-5 text-sm text-smoke" />
                </div>
              )}
              {phase && (
                <button
                  onClick={() => abort.current?.abort()}
                  className="mt-4 w-full rounded-xl border border-char/15 py-2.5 text-sm font-semibold text-smoke"
                >
                  Cancel
                </button>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sheet && sheetRecipe && sheetRecipe !== "failed" && (
          <RecipeDetail
            key={sheet}
            recipe={saved[sheet] ?? draftRecipe(sheetRecipe)}
            draft={!saved[sheet]}
            saving={savingRef === sheet}
            onSave={async () => {
              setSavingRef(sheet);
              await saveOne(sheet);
              setSavingRef(null);
            }}
            onClose={() => setSheet(null)}
            onChanged={(r) => setSaved((s) => ({ ...s, [sheet]: r }))}
            onDelete={() => {
              setSaved((s) => {
                const next = { ...s };
                delete next[sheet];
                return next;
              });
              setSheet(null);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {addOpen && addIds.length > 0 && (
          <AddToListSheet
            source={{ recipe_ids: addIds }}
            title="Add the whole week to your list"
            onClose={() => setAddOpen(false)}
            onAdded={(n) => setAddedCount(n)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function OptionRow({
  label,
  wrap = false,
  children,
}: {
  label: string;
  /** Wrap onto a second line instead of scrolling — every choice stays in view. */
  wrap?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`mt-2 flex gap-3 ${wrap ? "items-start" : "items-center"}`}>
      <span
        className={`w-[4.5rem] shrink-0 text-xs font-semibold uppercase tracking-wide text-smoke ${wrap ? "pt-2.5" : ""}`}
      >
        {label}
      </span>
      <div
        className={wrap ? "flex flex-wrap gap-1.5" : "no-scrollbar -mr-4 flex gap-1.5 overflow-x-auto pr-4"}
      >
        {children}
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`h-9 min-w-9 shrink-0 rounded-full px-3 text-sm font-medium ${
        active ? "bg-char text-tile" : "bg-char/5 text-smoke"
      }`}
    >
      {children}
    </button>
  );
}
