"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { Recipe } from "@/lib/types";
import type { Extraction } from "@/lib/schemas";
import { springSoft, springUI } from "@/lib/springs";
import { RecipeImage } from "@/components/RecipeImage";
import { RecipeDetail } from "@/components/RecipeDetail";
import { Spinner } from "@/components/Spinner";
import { INVENT_CACHE_KEY, INVENT_SESSION_KEY } from "@/lib/userCache";

type Result = {
  can_make_now: { id: string; reason: string }[];
  nearly: { id: string; missing: string[]; reason: string }[];
  recipes: Recipe[];
};

type Idea = {
  title: string;
  hook: string;
  time_total_min: number | null;
  time_active_min: number | null;
  uses: string[];
  /** The side that makes it a meal, when the title doesn't already say it. */
  serve_with: string | null;
  cuisine: string | null;
};

/**
 * A device preference, not user data — deliberately outside the userCache wipe
 * set so logging out doesn't resurrect the explainer. Like the theme choice,
 * it belongs to the phone, not the account.
 */
const WINGIT_EXPLAINER_KEY = "nk-wingit-explainer-dismissed";

/**
 * Below this many staples, the pantry is thin enough to be the limiting factor
 * on what comes back. A blunt count rather than "do they have a starch?" — the
 * useful question, but not one you can answer without classifying every entry,
 * and a count is at least honest about being a rough proxy.
 */
const THIN_STAPLES = 8;

/** Null is "you pick" — the default, and one fewer decision before answering. */
const CUISINES = ["Italian", "Thai", "Mexican", "Indian", "Japanese", "Middle Eastern"];

/**
 * Caps on *active* time, which is the number that decides whether a weeknight
 * works — a three-hour braise with ten minutes of chopping is a Tuesday, and a
 * thirty-minute stir-fry that needs all thirty at the stove often isn't.
 */
const TIMES: { label: string; max: number | null }[] = [
  { label: "Any time", max: null },
  { label: "15m or less", max: 15 },
  { label: "30m or less", max: 30 },
  { label: "45m or less", max: 45 },
];

/**
 * Expanded recipes, kept so reopening a card is instant instead of a second
 * wait and a second bill for the same dish.
 *
 * In localStorage rather than component state because an iOS PWA gets evicted
 * on a background-and-return, and losing the cache to that is exactly the case
 * worth covering.
 *
 * The key includes what the recipe was generated from, so changing what's on
 * hand can't hand back an answer built for different ingredients — a stale
 * entry is unreachable rather than wrong.
 */
const CACHE_KEY = INVENT_CACHE_KEY;
const CACHE_LIMIT = 24;

type CacheEntry = { extraction: Extraction; saved?: Recipe };

function cacheKeyFor(onHand: string, cuisine: string | null, maxActive: number | null, title: string) {
  return [onHand.trim().toLowerCase(), cuisine ?? "", maxActive ?? "", title].join("|");
}

function readCache(): Record<string, CacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
  } catch {
    // Private mode, corrupt JSON, evicted quota — a cold cache is fine.
    return {};
  }
}

function writeCache(key: string, entry: CacheEntry) {
  try {
    const all = readCache();
    all[key] = entry;
    // Object key order is insertion order for string keys, so the oldest
    // entries fall off the front once it's full.
    const keys = Object.keys(all);
    for (const stale of keys.slice(0, Math.max(0, keys.length - CACHE_LIMIT))) delete all[stale];
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    // Out of quota or blocked — the feature just stops being faster.
  }
}

/**
 * Kitchen noises, not a progress report — none of this is what the model is
 * actually doing, and pretending otherwise would be a worse lie than the joke.
 * Kept short enough to hold one line at the modal's width.
 */
const COOKING_LINES = [
  "Warming up the pan…",
  "Chopping things finely…",
  "Consulting the spice rack…",
  "Deciding about the garlic…",
  "Measuring mostly by eye…",
  "Tasting, adjusting, tasting…",
  "Reducing something slowly…",
  "Wiping down the board…",
];

/**
 * The wait before three ideas land. Ordered, not shuffled — it opens on the
 * staples because that genuinely is the first thing the route reads, and ends
 * on the count the model was asked for.
 */
const THINKING_LINES = [
  "Checking your staples…",
  "Pairing things up…",
  "Ruling out the obvious…",
  "Considering method…",
  "Almost there…",
  "Narrowing it to three…",
];

/**
 * Cycles a line so a wait has a pulse to it. Fixed height and one absolutely
 * positioned line: the copy swaps without anything resizing under it, and
 * nothing can wrap onto a second.
 */
function CyclingLine({
  lines,
  start = 0,
  className,
}: {
  lines: readonly string[];
  /** The button wants to open on its first line; the modal would rather not. */
  start?: number;
  className: string;
}) {
  const [i, setI] = useState(start);

  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % lines.length), 2400);
    return () => clearInterval(t);
  }, [lines.length]);

  return (
    <span className={`relative block ${className}`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.22 }}
          className="absolute inset-x-0 block truncate"
        >
          {lines[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * An invented recipe has no row yet, but the detail sheet renders a Recipe.
 * These are the fields it reads; the rest are the neutral defaults a recipe
 * would have the instant after it was saved.
 */
function draftRecipe(e: Extraction): Recipe {
  return {
    id: "draft",
    title: e.title,
    description: e.description,
    ingredients: e.ingredients,
    steps: e.steps,
    servings: e.servings,
    time_total_min: e.time_total_min,
    time_active_min: e.time_active_min,
    status: "want_to_try",
    hearts: null,
    effort: null,
    notes: "",
    tags: e.tags,
    cuisine: e.cuisine,
    course: e.course,
    season: e.season,
    occasion: e.occasion,
    main_ingredients: e.main_ingredients,
    source_url: null,
    source_name: e.source_name ?? "Night Kitchen",
    source_type: "manual",
    image_url: null,
    image_thumb_url: null,
    capture_status: "ready",
    capture_error: null,
    capture_gaps: e.gaps,
    possible_duplicate_of: null,
    created_at: "",
    updated_at: "",
  };
}

export default function PantryPage() {
  const [onHand, setOnHand] = useState("");
  const [cuisine, setCuisine] = useState<string | null>(null);
  const [maxActive, setMaxActive] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which pitch is being expanded — the tap that costs a round trip.
  const [opening, setOpening] = useState<string | null>(null);
  // `key` is the cache entry this sheet came from. Carried explicitly rather
  // than re-derived from the title on save: the written recipe is free to be
  // titled differently from the pitch, and matching on that would silently miss.
  const [sheet, setSheet] = useState<{
    recipe: Recipe;
    extraction?: Extraction;
    key?: string;
  } | null>(null);
  const openAbort = useRef<AbortController | null>(null);
  const onHandRef = useRef<HTMLTextAreaElement | null>(null);
  // Null until it lands — the line reads normally rather than flashing the
  // thin-pantry version at someone who has plenty.
  const [staplesCount, setStaplesCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/staples")
      .then((r) => r.json())
      .then((j) => setStaplesCount(Array.isArray(j.staples) ? j.staples.length : null))
      .catch(() => {
        // Not worth surfacing — the line just stays in its normal form.
      });
  }, []);

  // Null until storage is read, so a dismissed user never sees the card flash.
  const [explainerShown, setExplainerShown] = useState(false);
  useEffect(() => {
    try {
      setExplainerShown(localStorage.getItem(WINGIT_EXPLAINER_KEY) !== "1");
    } catch {
      // Storage blocked — showing it every visit with no way to dismiss it would
      // nag, so treat that as already dismissed.
    }
  }, []);
  function dismissExplainer() {
    setExplainerShown(false);
    try {
      localStorage.setItem(WINGIT_EXPLAINER_KEY, "1");
    } catch {
      // Can't persist — it'll return next visit, but that's the private-mode cost.
    }
  }
  const [saving, setSaving] = useState(false);

  // Every title shown this session. Passed back on "three more" so the model
  // doesn't hand back near-duplicates of what you already rejected.
  const [seen, setSeen] = useState<string[]>([]);
  /**
   * The question the ideas on screen answer. While the form still says exactly
   * this, asking again would spend a call to get the same answer — so the
   * button goes quiet until something about the question changes. The chips
   * count as part of it: swapping to Italian is a new question even if the
   * ingredients didn't move.
   */
  const [asked, setAsked] = useState<string | null>(null);

  // ------------------------------------------------------------------
  // The screen survives leaving: inputs + results live in localStorage so
  // navigating away (or the PWA being evicted) doesn't eat three ideas you
  // paid for. Deliberately NOT the database — these are throwaway
  // suggestions, not saved data. Expires after 12h: yesterday's fridge
  // isn't today's. Wiped on login/logout via clearUserDataCaches.
  // ------------------------------------------------------------------
  const skipSave = useRef(true);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(INVENT_SESSION_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as {
        onHand?: string;
        cuisine?: string | null;
        maxActive?: number | null;
        ideas?: Idea[] | null;
        seen?: string[];
        result?: Result | null;
        asked?: string | null;
        saved_at?: number;
      };
      if (!s.saved_at || Date.now() - s.saved_at > 12 * 60 * 60 * 1000) return;
      setOnHand(s.onHand ?? "");
      setCuisine(s.cuisine ?? null);
      setMaxActive(s.maxActive ?? null);
      setIdeas(s.ideas ?? null);
      setSeen(s.seen ?? []);
      setResult(s.result ?? null);
      setAsked(s.asked ?? null);
    } catch {
      // corrupt/blocked storage — start clean
    }
  }, []);
  useEffect(() => {
    // The mount run fires with initial empty state — writing it would clobber
    // the stored session before the restore's setState lands. Skip it once.
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    try {
      localStorage.setItem(
        INVENT_SESSION_KEY,
        JSON.stringify({
          onHand,
          cuisine,
          maxActive,
          ideas,
          seen,
          result,
          asked,
          saved_at: Date.now(),
        })
      );
    } catch {
      // out of quota or private mode — the page just forgets on leave, as before
    }
  }, [onHand, cuisine, maxActive, ideas, seen, result, asked]);

  async function invent(avoid: string[]): Promise<Idea[]> {
    const res = await fetch("/api/invent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on_hand: onHand, cuisine, max_active_min: maxActive, avoid }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Couldn't think of anything.");
    return json.ideas ?? [];
  }

  /** What's being asked right now, as one comparable string. */
  const question = [onHand.trim().toLowerCase(), cuisine ?? "", maxActive ?? ""].join("|");
  const alreadyAnswered = asked !== null && asked === question;

  /**
   * Emptying the box is starting over, so the ideas it produced shouldn't hang
   * around underneath a blank prompt. Wipe them (and the library results and the
   * answered-question marker) so the board is a clean slate for the next thing.
   */
  function resetIdeas() {
    setIdeas(null);
    setResult(null);
    setAsked(null);
    setSeen([]);
    setError(null);
    setMore(false);
  }

  async function run() {
    if (!onHand.trim() || busy || alreadyAnswered) return;
    setBusy(true);
    setError(null);
    setIdeas(null);
    setResult(null);
    setSeen([]);

    try {
      const fresh = await invent([]);
      setIdeas(fresh);
      setSeen(fresh.map((i) => i.title));
      setAsked(question);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't think of anything.");
      // Left unset on failure: nothing was answered, so the button stays live
      // and the obvious thing — tapping it again — is allowed to work.
    }
    setBusy(false);
  }

  /**
   * Searching the saved library is a separate, opt-in step under the ideas.
   * It answers a different question — what have I already vouched for — and
   * most of the time you're here for the ideas, not that.
   */
  async function searchLibrary() {
    if (searching) return;
    setSearching(true);
    const res = await fetch("/api/pantry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on_hand: onHand, max_active_min: maxActive }),
    });
    const json = await res.json();
    setSearching(false);
    if (res.ok) setResult(json as Result);
    else setError(json.error ?? "Library search failed.");
  }

  async function regenerate() {
    if (more) return;
    setMore(true);
    setError(null);
    try {
      const fresh = await invent(seen);
      // Add to what's already on screen rather than replacing it — "more ideas"
      // keeps the originals so nothing you liked disappears. Guard against a
      // repeated title (would collide on the list key) even though `seen` tells
      // invent to avoid them.
      setIdeas((prev) => {
        const existing = prev ?? [];
        const have = new Set(existing.map((i) => i.title));
        return [...existing, ...fresh.filter((i) => !have.has(i.title))];
      });
      setSeen((s) => [...s, ...fresh.map((i) => i.title)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't think of anything.");
    }
    setMore(false);
  }

  async function openIdea(idea: Idea) {
    if (opening) return;
    const key = cacheKeyFor(onHand, cuisine, maxActive, idea.title);

    // Seen this one already — reopen it without the wait. If it was saved, the
    // saved row wins, so tapping the card again can't produce a second copy.
    const hit = readCache()[key];
    if (hit) {
      setSheet(
        hit.saved
          ? { recipe: hit.saved, key }
          : { recipe: draftRecipe(hit.extraction), extraction: hit.extraction, key }
      );
      return;
    }

    const controller = new AbortController();
    openAbort.current = controller;
    setOpening(idea.title);
    setError(null);
    try {
      const res = await fetch("/api/invent/recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea, on_hand: onHand }),
        signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok) return setError(json.error ?? "Couldn't write that one out.");
      writeCache(key, { extraction: json.recipe });
      setSheet({ recipe: draftRecipe(json.recipe), extraction: json.recipe, key });
    } catch (e) {
      // Cancelling is a choice, not a failure — no error banner for it.
      if ((e as Error).name !== "AbortError") {
        setError("Couldn't write that one out.");
      }
    } finally {
      openAbort.current = null;
      setOpening(null);
    }
  }

  async function save() {
    if (!sheet?.extraction || saving) return;
    setSaving(true);
    const res = await fetch("/api/recipes/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipe: sheet.extraction }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) return setError(json.error ?? "Couldn't save that.");
    // Record the saved row against the same key, so reopening the card lands on
    // the real recipe rather than offering to save a duplicate of it.
    if (sheet.key) writeCache(sheet.key, { extraction: sheet.extraction, saved: json.recipe });
    // Swap the draft for the real row: same sheet, now with a photo button,
    // hearts, and a cook log, because there's finally something to attach them to.
    setSheet({ recipe: json.recipe, key: sheet.key });
  }

  const byId = new Map((result?.recipes ?? []).map((r) => [r.id, r]));

  function Card({ id, reason, missing, i }: { id: string; reason: string; missing?: string[]; i: number }) {
    const recipe = byId.get(id);
    if (!recipe) return null;
    return (
      <motion.li
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springSoft, delay: i * 0.04 }}
      >
        <Link
          href={`/recipes/${recipe.id}`}
          className="flex gap-3 rounded-[14px] border border-char/10 bg-surface p-3"
        >
          <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-char/5">
            {recipe.image_url && <RecipeImage src={recipe.image_url} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-[15px] font-bold">
              {recipe.title}
            </span>
            {missing && missing.length > 0 && (
              <span className="mt-0.5 block text-xs font-semibold text-flame">
                need {missing.join(", ")}
              </span>
            )}
            <span className="mt-0.5 block text-xs text-smoke">{reason}</span>
          </span>
        </Link>
      </motion.li>
    );
  }

  return (
    <main className="px-4 pt-[max(env(safe-area-inset-top),16px)]">
      <h1 className="pr-11 font-display text-3xl font-bold">Wing it</h1>
      {/* Staples is the one thing this screen silently depends on, and it no
          longer has a bottom-nav tab — so the sentence that mentions it is the
          natural way in. When the list is thin it says so here, before any
          effort is spent: nothing gets bought for these ideas, so a bare pantry
          is the whole ceiling on what comes back. Said here rather than over
          the finished recipe, where it would be asking someone who's about to
          start cooking to go do data entry. */}
      <p className="mt-1 text-sm text-smoke">
        {staplesCount !== null && staplesCount < THIN_STAPLES ? (
          <>
            What have you got? Worth filling in your{" "}
            <Link href="/staples" className="font-semibold text-char underline underline-offset-2">
              staples
            </Link>{" "}
            — ideas are built from those plus whatever you type.
          </>
        ) : (
          <>
            What have you got? Your{" "}
            <Link href="/staples" className="font-semibold text-char underline underline-offset-2">
              staples
            </Link>{" "}
            will be factored in.
          </>
        )}
      </p>

      {/* One-time explainer: a friend read "staples" and thought tonight's
          ingredients went there too. The subheader above is the standing short
          version; this is the fuller note, dismissible once it's landed.
          explainerShown starts null (unknown) so a dismissed user never sees a
          flash before the effect reads storage. */}
      <AnimatePresence>
        {explainerShown && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative mt-3 rounded-xl border border-char/10 bg-surface p-4 pr-11 text-sm"
          >
            <p className="font-display text-sm font-bold">A bit more on how this works</p>
            <p className="mt-1 text-smoke">
              Standing in front of the fridge? Type the random stuff you&apos;ve actually got
              tonight — half a cabbage, a chicken breast — and we&apos;ll find dinner in it. No
              need to add it to your staples; those are the pantry basics you always keep, already
              factored in.
            </p>
            <button
              onClick={dismissExplainer}
              aria-label="Got it"
              className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full text-smoke/70"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* pr-11 is reserved whether or not the ✕ is showing, so the text doesn't
          reflow the moment you start typing. */}
      <div className="relative mt-3">
        <textarea
          ref={onHandRef}
          value={onHand}
          onChange={(e) => {
            const v = e.target.value;
            setOnHand(v);
            if (!v.trim()) resetIdeas();
          }}
          rows={3}
          placeholder="half a cabbage, two eggs, some bacon, sour cream, soy sauce…"
          className="w-full resize-none rounded-xl border border-char/15 bg-surface py-3 pl-4 pr-11 text-base outline-none focus:border-flame"
        />
        {onHand && (
          <button
            onClick={() => {
              setOnHand("");
              resetIdeas();
              // Straight back to typing — clearing is almost always a redo,
              // not an exit.
              onHandRef.current?.focus();
            }}
            aria-label="Clear what you have"
            className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full text-smoke/70"
          >
            ✕
          </button>
        )}
      </div>

      {/* Chips rather than a follow-up question: one optional tap, skippable,
          and no second round trip before you get an answer. */}
      <div className="no-scrollbar -mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
        {[null, ...CUISINES].map((c) => {
          const active = cuisine === c;
          return (
            <button
              key={c ?? "any"}
              onClick={() => setCuisine(c)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${
                active ? "bg-char text-tile" : "bg-char/5 text-smoke"
              }`}
            >
              {c ?? "Anything"}
            </button>
          );
        })}
      </div>

      <div className="no-scrollbar -mx-4 mt-1.5 flex gap-2 overflow-x-auto px-4 pb-1">
        {TIMES.map((t) => {
          const active = maxActive === t.max;
          return (
            <button
              key={t.label}
              onClick={() => setMaxActive(t.max)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${
                active ? "bg-char text-tile" : "bg-char/5 text-smoke"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <motion.button
        whileTap={{ scale: 0.97 }}
        transition={springUI}
        onClick={run}
        disabled={busy || !onHand.trim() || alreadyAnswered}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-flame py-3.5 font-display font-bold text-accent-ink disabled:opacity-40"
      >
        {busy && <Spinner />}
        {busy ? (
          // Fixed width so the spinner beside it holds still while the copy
          // swaps — the pair stays centred as one group.
          <CyclingLine lines={THINKING_LINES} className="h-6 w-52 text-center" />
        ) : (
          "What can I make?"
        )}
      </motion.button>
      {error && <p className="mt-2 text-sm text-flame">{error}</p>}

      <AnimatePresence>
        {ideas && ideas.length === 0 && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-6 rounded-xl border border-char/10 bg-surface p-4 text-sm text-smoke"
          >
            There isn&apos;t a dinner in that yet — and nothing here is worth sending you to the
            shop for. Tell me a bit more, or add to your{" "}
            <Link href="/staples" className="font-semibold text-char underline underline-offset-2">
              staples
            </Link>{" "}
            so there&apos;s a pantry behind it.
          </motion.p>
        )}
        {ideas && ideas.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6">
            <h2 className="font-display text-xs font-bold uppercase tracking-widest text-flame">
              Ideas for tonight
            </h2>
            <ul className="mt-2 space-y-2">
              {ideas.map((idea, i) => (
                <motion.li
                  key={idea.title}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...springSoft, delay: i * 0.04 }}
                >
                  <button
                    onClick={() => openIdea(idea)}
                    disabled={!!opening}
                    className="w-full rounded-[14px] border border-char/10 bg-surface p-3 text-left disabled:opacity-60"
                  >
                    <span className="block font-display text-[15px] font-bold">{idea.title}</span>
                    <span className="mt-0.5 block text-xs text-smoke">{idea.hook}</span>
                    <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {idea.time_active_min != null ? (
                        <span className="text-smoke">
                          {idea.time_active_min}m active
                          {idea.time_total_min != null &&
                            idea.time_total_min !== idea.time_active_min &&
                            ` · ${idea.time_total_min}m total`}
                        </span>
                      ) : (
                        idea.time_total_min != null && (
                          <span className="text-smoke">{idea.time_total_min}m</span>
                        )
                      )}
                      {/* Constant by design — nothing gets suggested that you'd
                          have to shop for, so this is true of every card. It's
                          reassurance, not information. The starch belongs in the
                          hook, where it reads as part of the dish.

                          ml-auto rather than justify-between on the row: an idea
                          with no times at all leaves this the only child, and
                          justify-between would park it back on the left. */}
                      <span className="ml-auto font-semibold text-herb">you have everything</span>
                    </span>
                  </button>
                </motion.li>
              ))}
            </ul>
            <button
              onClick={regenerate}
              disabled={more || !!opening}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-char/15 py-2.5 text-sm font-semibold text-smoke disabled:opacity-40"
            >
              {more && <Spinner className="h-3.5 w-3.5" />}
              {more ? "Thinking…" : "Three more ideas"}
            </button>

            {/* Opt-in second question. Hidden once answered — the results
                themselves are the acknowledgement. */}
            {!result && (
              <button
                onClick={searchLibrary}
                disabled={searching}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-char/15 py-2.5 text-sm font-semibold text-smoke disabled:opacity-40"
              >
                {searching && <Spinner className="h-3.5 w-3.5" />}
                {searching ? "Looking…" : "Search my library too"}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6">
            <h2 className="font-display text-xs font-bold uppercase tracking-widest text-herb">
              Already in your library
            </h2>
            <ul className="mt-2 space-y-2">
              {result.can_make_now.map((r, i) => (
                <Card key={r.id} id={r.id} reason={r.reason} i={i} />
              ))}
              {!result.can_make_now.length && (
                <li className="text-sm text-smoke">Nothing you can make outright.</li>
              )}
            </ul>

            {result.nearly.length > 0 && (
              <>
                <h2 className="mt-6 font-display text-xs font-bold uppercase tracking-widest text-smoke">
                  One or two things short
                </h2>
                <ul className="mt-2 space-y-2">
                  {result.nearly.map((r, i) => (
                    <Card key={r.id} id={r.id} reason={r.reason} missing={r.missing} i={i} />
                  ))}
                </ul>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Writing the recipe is the one wait long enough to look like a hang, so
          it gets a modal rather than an inline label — and a way out, since the
          only alternative is staring at a card that won't open. */}
      <AnimatePresence>
        {opening && (
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
              className="fixed left-1/2 top-1/2 z-50 w-[min(88vw,20rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-tile p-5 text-center shadow-2xl"
            >
              <Spinner className="mx-auto h-7 w-7 text-flame" />
              <p className="mt-3 font-display text-lg font-bold leading-tight">{opening}</p>
              <CyclingLine
                lines={COOKING_LINES}
                // Random start so the same lines don't open every recipe.
                start={Math.floor(Math.random() * COOKING_LINES.length)}
                className="mt-1 h-5 text-sm text-smoke"
              />
              <button
                onClick={() => openAbort.current?.abort()}
                className="mt-4 w-full rounded-xl border border-char/15 py-2.5 text-sm font-semibold text-smoke"
              >
                Cancel
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sheet && (
          <RecipeDetail
            recipe={sheet.recipe}
            draft={!!sheet.extraction}
            saving={saving}
            onSave={save}
            onClose={() => setSheet(null)}
            onChanged={(r) => setSheet((s) => (s ? { ...s, recipe: r } : s))}
            onDelete={() => setSheet(null)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
