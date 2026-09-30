// The app's week runs Sunday → Saturday, because Sunday is the shopping ritual.

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** The Sunday that starts the week containing `from` (today counts if it's Sunday). */
export function weekStart(from = new Date()): Date {
  const d = new Date(from);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

/** Seven ISO dates, Sunday first. */
export function weekDates(from = new Date()): string[] {
  const start = weekStart(from);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return toISODate(d);
  });
}

export function isSunday(d = new Date()): boolean {
  return d.getDay() === 0;
}

/** "Tuesday" — for sheet headers, where there's room to say the whole day. */
export function weekdayLong(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" });
}

export function dayLabel(iso: string): { weekday: string; day: string } {
  const d = new Date(iso + "T12:00:00");
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: "short" }),
    day: String(d.getDate()),
  };
}

export function isToday(iso: string): boolean {
  return iso === toISODate(new Date());
}
