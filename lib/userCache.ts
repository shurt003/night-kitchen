// localStorage keys that cache one user's server-derived data for instant paint
// and offline use. They are NOT scoped per user, so on a shared device they must
// be wiped whenever the account changes — otherwise the next person briefly sees
// the previous person's data before the server sync lands. Cleared on BOTH login
// and logout. Anything that's a device preference rather than user data (theme)
// is deliberately kept.
//
// This is the single source of truth for these key names — import from here
// rather than re-declaring the string, so a version bump can't leave a stale
// cache uncleared.
export const GROCERY_CACHE_KEY = "nk-grocery-v1";
export const INVENT_CACHE_KEY = "nk-invent-cache";
export const INVENT_SESSION_KEY = "nk-invent-session";
export const PLAN_DRAFTS_KEY = "nk-plan-drafts";
export const PLAN_SOURCE_KEY = "nk-plan-source";

const USER_DATA_CACHE_KEYS = [
  GROCERY_CACHE_KEY,
  INVENT_CACHE_KEY,
  INVENT_SESSION_KEY,
  PLAN_DRAFTS_KEY,
  PLAN_SOURCE_KEY,
];

/** Wipe every localStorage cache that holds a single user's data. */
export function clearUserDataCaches() {
  try {
    for (const key of USER_DATA_CACHE_KEYS) localStorage.removeItem(key);
  } catch {
    // private mode / storage disabled — nothing to clear
  }
}
