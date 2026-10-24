// "Plan the week" in Make: the outline the model plans first, and the labels
// its nights are shown under. Pure helpers — shared by the page, the routes and
// a saved week.

import type { GamePlanStep } from "./gamePlan";

/** Something cooked in bulk (a veg tray, a pot of rice) that several nights use. */
export type WeekComponent = {
  key: string;
  title: string;
  /** What the batch comes to — "2 sheet pans, about 8 cups". */
  makes: string;
  /** Night numbers (1-based) that use it. */
  used_on: number[];
  /** The prep day it's cooked on ("Sun"), or null when there's no prep day. */
  prep_day?: string | null;
};

/**
 * One night. "cook" is a dinner from scratch (using any components); "remix"
 * turns an earlier night's leftovers into something new; "reheat" is that
 * night's leftovers as they are — a note, not a recipe.
 */
export type WeekNight = {
  night: number;
  label: string;
  title: string;
  hook: string;
  /** Component keys this dinner uses. */
  uses: string[];
  /** Hands-on cooking that night, in minutes. */
  tonight_min: number | null;
  kind: "cook" | "remix" | "reheat";
  from_night: number | null;
};

export type WeekOutline = {
  /** What the week is called until the cook renames it — "Veggie-tray week". */
  title: string;
  components: WeekComponent[];
  nights: WeekNight[];
  /** One cooking session per prep day, in week order. */
  prep_sessions?: { day: string; plan: GamePlanStep[] }[];
  /** The prep days the cook chose ("Sun", "Wed"); empty means none. */
  prep_days?: string[];
  /** Older saved weeks: a single session and a single prep day. */
  prep_plan: GamePlanStep[] | null;
  prep_day?: string | null;
};

export const WEEK_NIGHT_CHOICES = [3, 4, 5, 6, 7] as const;
export const WEEK_PEOPLE_CHOICES = [1, 2, 3, 4, 6] as const;
/** Any days can be prep days (none is fine — bulk items then cook on night 1). */
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * The weekday the week starts on: the chosen prep day that comes soonest from
 * today (today counts) — you cook in bulk and eat that night too — or today
 * when there's no prep day.
 */
export function weekStartDay(prepDays: string[], today = new Date()): number {
  const t = today.getDay();
  const idx = prepDays.map((d) => DAY_NAMES.indexOf(d as (typeof DAY_NAMES)[number])).filter((i) => i >= 0);
  if (!idx.length) return t;
  return idx.sort((a, b) => ((a - t + 7) % 7) - ((b - t + 7) % 7))[0];
}

/** Weekday labels for the nights, starting from `weekStartDay`. */
export function nightLabels(nights: number, prepDays: string[], today = new Date()): string[] {
  const start = weekStartDay(prepDays, today);
  return Array.from({ length: nights }, (_, i) => DAY_NAMES[(start + i) % 7]);
}

/**
 * The prep sessions to show, oldest saved shape included: per-day sessions
 * when there are any, else the single session under the single prep day.
 */
export function prepSessions(outline: WeekOutline): { day: string | null; plan: GamePlanStep[] }[] {
  if (outline.prep_sessions?.length) return outline.prep_sessions;
  if (outline.prep_plan?.length) return [{ day: outline.prep_day ?? null, plan: outline.prep_plan }];
  return [];
}

/** The prep days a week was planned with (older saved weeks had one). */
export function weekPrepDays(outline: WeekOutline): string[] {
  if (outline.prep_days) return outline.prep_days;
  return outline.prep_day ? [outline.prep_day] : [];
}

/** The components a night uses, by title — for its "uses" line. */
export function usesTitles(outline: WeekOutline, night: WeekNight): string[] {
  return night.uses
    .map((k) => outline.components.find((c) => c.key === k)?.title)
    .filter((t): t is string => !!t);
}
