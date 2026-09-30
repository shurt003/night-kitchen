// "Shuffle library" — an opt-in that reorders the library randomly on each cold
// start, so recipes near the bottom of new→old don't get forgotten. The setting
// is a persisted preference (localStorage); the randomness is a per-session seed
// (sessionStorage) so the order holds steady while the app is open — refetches
// and new captures don't reshuffle under you — but comes out fresh next launch.

const ENABLED_KEY = "nk:library-shuffle";
const SEED_KEY = "nk:library-shuffle-seed";
const BASELINE_KEY = "nk:library-shuffle-baseline";
export const SHUFFLE_CHANGED_EVENT = "library-shuffle-changed";

export function getShuffleEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ENABLED_KEY) === "1";
}

export function setShuffleEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  // Turning it on mid-session should reshuffle now rather than wait for a
  // relaunch, so mint a fresh seed each time it's enabled.
  if (enabled) window.sessionStorage.setItem(SEED_KEY, String(Math.random()));
  window.dispatchEvent(new CustomEvent(SHUFFLE_CHANGED_EVENT));
}

/** The seed for this app session, minted once on first read (i.e. cold start). */
export function getSessionSeed(): string {
  if (typeof window === "undefined") return "0";
  let seed = window.sessionStorage.getItem(SEED_KEY);
  if (!seed) {
    seed = String(Math.random());
    window.sessionStorage.setItem(SEED_KEY, seed);
  }
  return seed;
}

/**
 * Record the recipe ids present at this session's first load — once. Anything
 * captured *later* in the session (e.g. from the Safari share shortcut) is then
 * "new" and gets pinned to the top instead of being scattered by the shuffle,
 * so you never have to hunt for what you just saved. Idempotent: only the first
 * call per session writes, so later refetches don't absorb new captures into the
 * baseline. Lives in sessionStorage alongside the seed, so a cold start clears
 * it and the whole library — new captures included — reshuffles fresh.
 */
export function ensureSessionBaseline(ids: string[]): void {
  if (typeof window === "undefined") return;
  if (window.sessionStorage.getItem(BASELINE_KEY) !== null) return;
  window.sessionStorage.setItem(BASELINE_KEY, JSON.stringify(ids));
}

/** The set of ids that existed at this session's first load (empty until set). */
export function getSessionBaseline(): Set<string> {
  if (typeof window === "undefined") return new Set();
  const raw = window.sessionStorage.getItem(BASELINE_KEY);
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

// FNV-1a: a small, stable string hash. Good enough to scatter ids evenly.
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Order items by hash(id + seed) — a deterministic shuffle. Because it keys off
 * the id, the same seed always yields the same order regardless of the input
 * order, so a mid-session refetch or a new capture slots in at a stable spot
 * instead of jumbling everything.
 */
export function seededShuffle<T extends { id: string }>(items: T[], seed: string): T[] {
  return [...items].sort((a, b) => hash(a.id + seed) - hash(b.id + seed));
}
