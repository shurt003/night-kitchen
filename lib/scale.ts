// Servings scaling with sane rounding: ½ ⅓ ¼ etc., never "1.33 eggs".
// Pure functions — used by the client-side scaler.

const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75,
  "⅕": 0.2, "⅖": 0.4, "⅗": 0.6, "⅘": 0.8, "⅙": 1 / 6, "⅚": 5 / 6, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
};

const NICE_FRACTIONS: [number, string][] = [
  [0, ""], [0.125, "⅛"], [1 / 6, "⅙"], [0.25, "¼"], [1 / 3, "⅓"], [0.375, "⅜"],
  [0.5, "½"], [0.625, "⅝"], [2 / 3, "⅔"], [0.75, "¾"], [0.875, "⅞"], [1, ""],
];

export function parseQuantity(q: string | null): number | null {
  if (!q) return null;
  let s = q.trim();
  // ranges like "2-3" → use the first number
  const range = s.match(/^([\d\s./½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]+)\s*[-–—to]+\s*/);
  if (range) s = range[1].trim();

  let total = 0;
  let matched = false;
  for (const [ch, val] of Object.entries(UNICODE_FRACTIONS)) {
    if (s.includes(ch)) {
      total += val;
      s = s.replace(ch, "").trim();
      matched = true;
    }
  }
  const frac = s.match(/(\d+)\s*\/\s*(\d+)/);
  if (frac) {
    total += parseInt(frac[1]) / parseInt(frac[2]);
    s = s.replace(frac[0], "").trim();
    matched = true;
  }
  const whole = s.match(/\d+(\.\d+)?/);
  if (whole) {
    total += parseFloat(whole[0]);
    matched = true;
  }
  return matched ? total : null;
}

/** Format a number as whole + nice unicode fraction ("1½", "⅔", "3"). */
export function formatQuantity(n: number): string {
  if (n <= 0) return "0";
  const whole = Math.floor(n);
  const rest = n - whole;
  let best = NICE_FRACTIONS[0];
  let bestDist = Infinity;
  for (const cand of NICE_FRACTIONS) {
    const d = Math.abs(cand[0] - rest);
    if (d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  const [fracVal, fracStr] = best;
  const carried = fracVal === 1 ? whole + 1 : whole;
  const fraction = fracVal === 1 ? "" : fracStr;
  if (carried === 0 && !fraction) return formatDecimal(n);
  return `${carried > 0 ? carried : ""}${fraction}` || "0";
}

function formatDecimal(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

const WHOLE_ONLY = /egg|clove|onion|shallot|lemon|lime|orange|apple|banana|avocado|potato|pepper\b|chile|chili\b|tortilla|bun\b|roll\b|steak|thigh|breast|drumstick|sausage|can\b|jar\b|sheet|sprig/i;

export function scaleIngredientQuantity(
  quantity: string | null,
  item: string,
  factor: number
): { display: string | null; roundedNote: string | null } {
  const parsed = parseQuantity(quantity);
  if (parsed === null) return { display: quantity, roundedNote: null };
  const scaled = parsed * factor;

  if (WHOLE_ONLY.test(item)) {
    const rounded = Math.max(1, Math.round(scaled));
    const note = Math.abs(rounded - scaled) > 0.05 ? `rounded from ${formatQuantity(scaled)}` : null;
    return { display: String(rounded), roundedNote: note };
  }
  return { display: formatQuantity(scaled), roundedNote: null };
}
