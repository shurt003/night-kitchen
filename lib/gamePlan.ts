// A Make meal's game plan: ordered steps, each timed relative to eating.
// Structured (minutes before serving) so the page can show clock times once
// the cook says when dinner is — pure arithmetic, no model call, works offline.

export type GamePlanStep = {
  /** Minutes before eating that the step starts; null for "To serve". */
  offset_min: number | null;
  /** The timing in words — "4 hours before", "To serve". */
  label: string;
  text: string;
};

/**
 * Read a timing phrase into minutes before eating. Covers what the model
 * writes ("4.5 hours before", "30 min before", "1 hour 15 min before",
 * "The day before"); anything else is null and the label shows as written.
 */
export function parseOffset(label: string): number | null {
  const l = label.toLowerCase();
  if (/day before|night before|the day ahead/.test(l)) return 24 * 60;
  if (!/before|ahead/.test(l)) return null;
  let total = 0;
  let found = false;
  const hours = l.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  if (hours) {
    total += parseFloat(hours[1]) * 60;
    found = true;
  }
  const mins = l.match(/(\d+)\s*(?:minutes?|mins?|m)\b/);
  if (mins) {
    total += parseInt(mins[1], 10);
    found = true;
  }
  return found ? Math.round(total) : null;
}

/**
 * Accept the structured shape, or the older plain strings ("2 hours before:
 * sear the ribs") from before the plan was structured — a session saved then
 * still renders.
 */
export function normalizeGamePlan(items: unknown): GamePlanStep[] | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const steps: GamePlanStep[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      const at = item.indexOf(":");
      // Only a short lead-in counts as a timing — not a colon deep in a sentence.
      if (at > 0 && at <= 24) {
        const label = item.slice(0, at).trim();
        steps.push({ offset_min: parseOffset(label), label, text: item.slice(at + 1).trim() });
      } else {
        steps.push({ offset_min: null, label: "", text: item.trim() });
      }
    } else if (item && typeof item === "object" && "text" in item) {
      const o = item as { offset_min?: unknown; label?: unknown; text?: unknown };
      const label = typeof o.label === "string" ? o.label.trim() : "";
      const offset =
        typeof o.offset_min === "number" && Number.isFinite(o.offset_min) && o.offset_min >= 0
          ? Math.round(o.offset_min)
          : parseOffset(label);
      steps.push({ offset_min: offset, label, text: String(o.text ?? "").trim() });
    }
  }
  return steps.length ? steps : null;
}

/** "19:00" → minutes after midnight, or null if it isn't a time. */
export function parseServeTime(t: string | null | undefined): number | null {
  const m = t?.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** 900 → "3:00 pm". */
export function formatClock(minutesAfterMidnight: number): string {
  const m = ((minutesAfterMidnight % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(m % 60).padStart(2, "0")} ${h24 < 12 ? "am" : "pm"}`;
}

/**
 * The timing to show for a step: its clock time when dinner's time is set,
 * else its label. "To serve" lands on the serve time itself.
 */
export function stepTiming(step: GamePlanStep, serveMin: number | null): string {
  if (serveMin === null) return step.label;
  if (step.offset_min === null) {
    return /serve|eat|table/i.test(step.label) ? formatClock(serveMin) : step.label;
  }
  // "The day before" is make-ahead work with no particular hour — pinning it
  // to "7:00 pm yesterday" would be false precision, so it keeps its words.
  if (step.offset_min >= 1440) return step.label || "The day before";
  const at = serveMin - step.offset_min;
  const clock = formatClock(at);
  // An early dinner can push a same-day step past midnight.
  return at >= 0 ? clock : `Day before · ${clock}`;
}
