// Pure grocery helpers shared by server routes and the client-side
// local-first store. No imports with server-only dependencies here.
import { parseQuantity, formatQuantity } from "./scale";

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** "2 cloves" + "3 cloves" = "5 cloves"; otherwise "2 cloves + 1 head". */
export function mergeQuantities(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  const unitOf = (q: string) => q.replace(/^[\d\s./½⅓⅔¼¾⅛⅜⅝⅞-]+/, "").trim().toLowerCase();
  const na = parseQuantity(a);
  const nb = parseQuantity(b);
  if (na !== null && nb !== null && unitOf(a) === unitOf(b)) {
    const unit = unitOf(a);
    return `${formatQuantity(na + nb)}${unit ? " " + unit : ""}`;
  }
  return `${a} + ${b}`;
}

/**
 * Display only — "2 tablespoons" becomes "2 Tbsp". The stored text keeps the
 * full word on purpose: mergeQuantities matches units by string, so writing
 * the short form would stop a later "1 tablespoon" merging into it.
 *
 * Tbsp capitalised and tsp not is the usual convention, and the only thing
 * telling them apart at a glance on a list you're reading one-handed.
 */
export function abbreviateUnits(quantity: string): string {
  return quantity
    .replace(/\btablespoons?\b/gi, "Tbsp")
    .replace(/\bteaspoons?\b/gi, "tsp")
    // Recipes that already stored the short form get their casing evened out,
    // so one list can't show both "Tbsp" and "tbsp".
    .replace(/\btbsps?\b/gi, "Tbsp")
    .replace(/\btsps?\b/gi, "tsp");
}
