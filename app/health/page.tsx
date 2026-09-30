import { db } from "@/lib/db";
import { anthropic } from "@/lib/anthropic";
import { MODELS } from "@/lib/config";

// A plain-language status page: open /health on the phone to see exactly what's
// wired up. Behind the password gate (middleware), so it's safe to be candid.

export const dynamic = "force-dynamic";

const EXPECTED_TABLES = [
  "recipes",
  "cook_log",
  "quick_meals",
  "planned_meals",
  "grocery_trips",
  "grocery_items",
  "staples",
  "pending_captures",
  "item_section_prefs",
  "ingredient_aliases",
  "usage",
  "extraction_cache",
];

type Check = { label: string; ok: boolean; detail: string; optional?: boolean };

async function runChecks(): Promise<{ checks: Check[]; tables: Check[] }> {
  const checks: Check[] = [];

  // --- Environment ---
  const envs: [string, string, boolean][] = [
    ["APP_PASSWORD", "Login password", true],
    ["CAPTURE_API_KEY", "Capture key (iOS Shortcut)", true],
    ["NEXT_PUBLIC_SUPABASE_URL", "Supabase URL", true],
    ["SUPABASE_SERVICE_ROLE_KEY", "Supabase secret key", true],
    ["ANTHROPIC_API_KEY", "Anthropic key (recipe extraction)", true],
    ["VOYAGE_API_KEY", "Voyage key (semantic search)", false],
  ];
  for (const [name, label, required] of envs) {
    const present = !!process.env[name];
    checks.push({
      label,
      ok: present || !required,
      optional: !present && !required,
      detail: present
        ? "set"
        : required
          ? `missing — add ${name} in Vercel`
          : "not set (optional — search falls back to keywords)",
    });
  }

  // --- Database ---
  const tables: Check[] = [];
  let dbOk = false;
  try {
    const supabase = db();
    const results = await Promise.all(
      EXPECTED_TABLES.map(async (table) => {
        const { count, error } = await supabase
          .from(table)
          .select("*", { count: "exact", head: true });
        return { table, count: count ?? 0, error: error?.message };
      })
    );
    dbOk = results.every((r) => !r.error);
    for (const r of results) {
      tables.push({
        label: r.table,
        ok: !r.error,
        detail: r.error ? r.error : `${r.count} row${r.count === 1 ? "" : "s"}`,
      });
    }
    checks.push({
      label: "Database connection",
      ok: dbOk,
      detail: dbOk
        ? `connected — all ${EXPECTED_TABLES.length} tables reachable`
        : "connected, but some tables are missing or blocked (see below)",
    });
  } catch (err) {
    checks.push({
      label: "Database connection",
      ok: false,
      detail: err instanceof Error ? err.message : "could not reach Supabase",
    });
  }

  // --- Anthropic (free metadata calls; no tokens spent) ---
  // Both models get their own check. Probing only one used to report "using
  // claude-haiku-4-5" and say nothing about the other, which read as though
  // that were the only model the app runs on.
  if (process.env.ANTHROPIC_API_KEY) {
    const models: [string, string][] = [
      [MODELS.fast, "extraction, tagging, grocery sorting"],
      [MODELS.smart, "planning, Wing it, inventing, Ask"],
    ];
    for (const [model, used_for] of models) {
      try {
        await anthropic().models.retrieve(model);
        checks.push({ label: `Anthropic — ${model}`, ok: true, detail: used_for });
      } catch (err) {
        checks.push({
          label: `Anthropic — ${model}`,
          ok: false,
          detail: err instanceof Error ? err.message.slice(0, 200) : "key rejected",
        });
      }
    }
  }

  return { checks, tables };
}

function Row({ check }: { check: Check }) {
  return (
    <li className="flex items-start gap-3 border-b border-char/8 py-2.5 last:border-0">
      <span
        className={`mt-0.5 text-lg leading-none ${
          check.optional ? "text-smoke/50" : check.ok ? "text-herb" : "text-flame"
        }`}
      >
        {check.optional ? "–" : check.ok ? "✓" : "✕"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{check.label}</span>
        <span className="block break-words text-sm text-smoke">{check.detail}</span>
      </span>
    </li>
  );
}

export default async function HealthPage() {
  const { checks, tables } = await runChecks();
  const allGood = checks.every((c) => c.ok) && tables.every((t) => t.ok);

  return (
    <main className="px-4 pt-[max(env(safe-area-inset-top),16px)]">
      <h1 className="pr-11 font-display text-3xl font-bold">Status</h1>
      <p
        className={`mt-2 rounded-xl px-4 py-3 font-display font-bold ${
          allGood ? "bg-herb/15 text-herb" : "bg-flame/10 text-flame"
        }`}
      >
        {allGood ? "Everything's connected. Go cook." : "Something needs attention — see below."}
      </p>

      <h2 className="mt-6 font-display text-xs font-bold uppercase tracking-widest text-smoke">
        Setup
      </h2>
      <ul className="mt-1 rounded-xl border border-char/10 bg-surface px-3">
        {checks.map((c) => (
          <Row key={c.label} check={c} />
        ))}
      </ul>

      <h2 className="mt-6 font-display text-xs font-bold uppercase tracking-widest text-smoke">
        Tables
      </h2>
      <ul className="mt-1 rounded-xl border border-char/10 bg-surface px-3">
        {tables.map((t) => (
          <Row key={t.label} check={t} />
        ))}
      </ul>

      <p className="mt-6 text-sm text-smoke">
        After changing environment variables in Vercel, redeploy — variables only take effect
        on a fresh build.
      </p>
    </main>
  );
}
