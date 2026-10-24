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
  /** The bulk-cooking session, in order. Null when nothing is cooked ahead. */
  prep_plan: GamePlanStep[] | null;
  /** The prep day the cook chose, or null (bulk items then cook on night 1). */
  prep_day: "Sat" | "Sun" | null;
};

export const WEEK_NIGHT_CHOICES = [3, 4, 5, 6, 7] as const;
export const WEEK_PEOPLE_CHOICES = [1, 2, 3, 4, 6] as const;
/** Null is "no prep day" — bulk items are then cooked on the first night. */
export const WEEK_PREP_DAYS = [null, "Sat", "Sun"] as const;
export type PrepDay = (typeof WEEK_PREP_DAYS)[number];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Weekday labels for the nights. The week starts on the prep day when there is
 * one (you cook in bulk and eat that night too) — the next one, or today if
 * today is it — and otherwise today.
 */
export function nightLabels(nights: number, prepDay: PrepDay, today = new Date()): string[] {
  // Only the weekday matters for a label, so "the next Sunday, or today" and
  // "Sunday" come to the same thing.
  const start = prepDay ? DAY_NAMES.indexOf(prepDay) : today.getDay();
  return Array.from({ length: nights }, (_, i) => DAY_NAMES[(start + i) % 7]);
}

/** The components a night uses, by title — for its "uses" line. */
export function usesTitles(outline: WeekOutline, night: WeekNight): string[] {
  return night.uses
    .map((k) => outline.components.find((c) => c.key === k)?.title)
    .filter((t): t is string => !!t);
}
