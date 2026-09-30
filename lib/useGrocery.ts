"use client";

// Local-first grocery state.
// Every mutation applies to localStorage-backed state instantly and enqueues a
// sync op; a flush loop replays the queue against the API whenever we're
// online and then refetches the server's canonical state. Grocery stores have
// terrible signal — the list must never spinner at the checkout.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { GroceryItem, GroceryTrip } from "./types";
import { normalizeName, mergeQuantities } from "./groceryShared";
import type { GrocerySection } from "./config";
import { GROCERY_CACHE_KEY } from "./userCache";

type Op =
  | { kind: "add"; tempId: string; name: string; quantity: string }
  | { kind: "restore"; tempId: string; item: Partial<GroceryItem> & { name: string } }
  | { kind: "toggle"; id: string; checked: boolean }
  | { kind: "section"; id: string; section: GrocerySection }
  | { kind: "edit"; id: string; name: string; quantity: string }
  | { kind: "delete"; id: string }
  | { kind: "archive"; opId: string; carryIds: string[]; archivedTripId: string }
  | { kind: "clear"; ids: string[] }
  | { kind: "restore-many"; items: (Partial<GroceryItem> & { name: string })[] };

type State = { trip: GroceryTrip | null; items: GroceryItem[]; queue: Op[] };

const STORAGE_KEY = GROCERY_CACHE_KEY;
const SYNC_THROTTLE_MS = 4000;
const tempId = () => `tmp-${crypto.randomUUID()}`;
const isTemp = (id: string) => id.startsWith("tmp-");

function nextSundayClient(): string {
  const d = new Date();
  const add = d.getDay() === 0 ? 0 : 7 - d.getDay();
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}

function matchKey(item: GroceryItem): string {
  return item.canonical_name ?? normalizeName(item.name);
}

/** Did the refetch actually bring anything new? (Server order is created_at asc.) */
function sameServerState(a: State, b: State): boolean {
  return (
    a.trip?.id === b.trip?.id &&
    a.trip?.shop_date === b.trip?.shop_date &&
    a.trip?.status === b.trip?.status &&
    JSON.stringify(a.items) === JSON.stringify(b.items)
  );
}

export function useGrocery() {
  const ref = useRef<State>({ trip: null, items: [], queue: [] });
  const [, force] = useReducer((c: number) => c + 1, 0);
  const [hydrated, setHydrated] = useState(false);
  const [online, setOnline] = useState(true);
  const flushing = useRef(false);

  // Set when a sync is requested while one is already running, so the later
  // request isn't silently dropped (the reason a slow add could be missed).
  const resyncWanted = useRef(false);
  const lastSyncAt = useRef(0);

  const commit = useCallback((next: State) => {
    ref.current = next;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage full/unavailable — state still lives in memory
    }
    force();
  }, []);

  // ------------------------------------------------------------------
  // Sync: replay the op queue, then adopt the server's canonical state
  // ------------------------------------------------------------------
  /**
   * `force` means "the server definitely changed" (an add landed elsewhere).
   * Everything else — focus, visibility, reconnect — is a hint, and hints are
   * throttled so noisy platform events can't turn into a fetch storm on a phone.
   */
  const flush = useCallback(async (opts: { force?: boolean } = {}) => {
    if (typeof navigator === "undefined" || !navigator.onLine) return;
    if (flushing.current) {
      resyncWanted.current = true;
      return;
    }
    const idle = ref.current.queue.length === 0;
    if (!opts.force && idle && Date.now() - lastSyncAt.current < SYNC_THROTTLE_MS) return;
    lastSyncAt.current = Date.now();
    flushing.current = true;
    try {
      while (ref.current.queue.length > 0) {
        const op = ref.current.queue[0];
        let mapping: { from: string; to: string } | null = null;

        try {
          const outcome = await runOp(op);
          if (outcome === "retry-later") return;
          if (outcome) mapping = outcome;
        } catch {
          return; // network failure — keep the op, retry on reconnect
        }

        const st = ref.current;
        const remap = (id: string) => (mapping && id === mapping.from ? mapping.to : id);
        commit({
          trip: st.trip,
          items: st.items.map((i) => ({ ...i, id: remap(i.id) })),
          queue: st.queue.slice(1).map((o) => remapOp(o, remap)),
        });
      }

      // Queue drained — the server is now canonical.
      const res = await fetch("/api/grocery/trip");
      if (res.ok) {
        const json = await res.json();
        if (ref.current.queue.length === 0) {
          const next: State = { trip: json.trip, items: json.items ?? [], queue: [] };
          // Most syncs bring back exactly what's already on screen — a pull to
          // refresh when nobody changed anything, a focus resync. Committing
          // that identical payload would re-render the whole list for nothing.
          if (!sameServerState(ref.current, next)) commit(next);
        }
      }
    } catch {
      // refetch failed — local state stands
    } finally {
      flushing.current = false;
    }
    // A sync was asked for while this one was running (e.g. an add landed
    // mid-flight) — run once more so it isn't lost.
    if (resyncWanted.current) {
      resyncWanted.current = false;
      void flushRef.current?.();
    }
  }, [commit]);

  // Lets flush re-enter itself without a circular useCallback dependency.
  const flushRef = useRef<typeof flush | null>(null);
  flushRef.current = flush;

  async function runOp(op: Op): Promise<{ from: string; to: string } | null | "retry-later"> {
    const drop = null; // 4xx → drop the op rather than poison the queue
    switch (op.kind) {
      case "add": {
        const res = await fetch("/api/grocery/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: [{ name: op.name, quantity: op.quantity }] }),
        });
        if (res.status >= 500) return "retry-later";
        if (!res.ok) return drop;
        const json = await res.json();
        const target = json.added?.[0] ?? json.merged?.[0];
        return target ? { from: op.tempId, to: target.id } : drop;
      }
      case "restore": {
        const res = await fetch("/api/grocery/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ full_items: [op.item] }),
        });
        if (res.status >= 500) return "retry-later";
        if (!res.ok) return drop;
        const json = await res.json();
        const target = json.added?.[0];
        return target ? { from: op.tempId, to: target.id } : drop;
      }
      case "toggle":
      case "section":
      case "edit": {
        if (isTemp(op.id)) return drop; // its add op was dropped
        const patch =
          op.kind === "toggle"
            ? { checked: op.checked }
            : op.kind === "section"
              ? { section: op.section }
              : { name: op.name, quantity: op.quantity };
        const res = await fetch(`/api/grocery/items/${op.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (res.status >= 500) return "retry-later";
        return drop;
      }
      case "delete": {
        if (isTemp(op.id)) return drop;
        const res = await fetch(`/api/grocery/items/${op.id}`, { method: "DELETE" });
        if (res.status >= 500) return "retry-later";
        return drop;
      }
      case "clear": {
        const ids = op.ids.filter((id) => !isTemp(id));
        // Nothing ever reached the server, so there's nothing to delete there.
        if (!ids.length) return drop;
        const res = await fetch("/api/grocery/clear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (res.status >= 500) return "retry-later";
        return drop;
      }
      case "restore-many": {
        const res = await fetch("/api/grocery/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ full_items: op.items }),
        });
        if (res.status >= 500) return "retry-later";
        // Ids are reassigned server-side; the refetch right after the queue
        // drains reconciles them.
        return drop;
      }
      case "archive": {
        const carry = op.carryIds.filter((id) => !isTemp(id));
        const res = await fetch("/api/grocery/archive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ carry_over_ids: carry }),
        });
        if (res.status >= 500) return "retry-later";
        return drop;
      }
    }
  }

  function remapOp(op: Op, remap: (id: string) => string): Op {
    switch (op.kind) {
      case "toggle":
      case "section":
      case "edit":
      case "delete":
        return { ...op, id: remap(op.id) };
      case "archive":
        return { ...op, carryIds: op.carryIds.map(remap) };
      default:
        return op;
    }
  }

  // ------------------------------------------------------------------
  // Boot: hydrate from localStorage instantly, then sync
  // ------------------------------------------------------------------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) ref.current = JSON.parse(raw) as State;
    } catch {
      // corrupt cache — start clean
    }
    setHydrated(true);
    force();
    setOnline(navigator.onLine);
    flush();

    const goOnline = () => {
      setOnline(true);
      flush();
    };
    const goOffline = () => setOnline(false);
    // Recipe detail, the planner and the Sunday flow write to the list
    // directly; this is how they tell us the server changed underneath us.
    const onChanged = () => flush({ force: true });
    // Coming back to the screen re-syncs — without this, a list that rendered
    // stale once stayed stale until the app was fully restarted. Throttled,
    // since these fire freely and often mean nothing changed.
    const onReturn = () => {
      if (document.visibilityState === "visible") flush();
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    window.addEventListener("grocery-changed", onChanged);
    window.addEventListener("focus", onReturn);
    window.addEventListener("pageshow", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("grocery-changed", onChanged);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("pageshow", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [flush]);

  // ------------------------------------------------------------------
  // Mutations — apply locally, enqueue, kick the flush
  // ------------------------------------------------------------------
  const enqueue = useCallback(
    (nextItems: GroceryItem[], op: Op, nextTrip?: GroceryTrip | null) => {
      const st = ref.current;
      commit({
        trip: nextTrip !== undefined ? nextTrip : st.trip,
        items: nextItems,
        queue: [...st.queue, op],
      });
      flush();
    },
    [commit, flush]
  );

  const add = useCallback(
    (rawName: string): { merged: boolean; itemId: string } => {
      const st = ref.current;
      const name = rawName.trim();
      const norm = normalizeName(name);
      const existing = st.items.find((i) => !i.checked && matchKey(i) === norm);
      const op: Op = { kind: "add", tempId: tempId(), name, quantity: "" };

      if (existing) {
        // local merge by name; the server merges by canonical name on sync
        const items = st.items.map((i) =>
          i.id === existing.id ? { ...i, quantity: mergeQuantities(i.quantity, "") } : i
        );
        enqueue(items, op);
        return { merged: true, itemId: existing.id };
      }

      const item: GroceryItem = {
        id: op.kind === "add" ? op.tempId : "",
        trip_id: st.trip?.id ?? "",
        name,
        canonical_name: null, // server assigns via Haiku on sync
        quantity: "",
        section: "other", // provisional; refetch brings the real section
        checked: false,
        source_type: "manual",
        source_id: null,
        sources: [{ type: "manual", id: null, label: null, quantity: "" }],
        carried_over_from: null,
        created_at: new Date().toISOString(),
      };
      enqueue([...st.items, item], op);
      return { merged: false, itemId: item.id };
    },
    [enqueue]
  );

  const toggle = useCallback(
    (item: GroceryItem) => {
      const st = ref.current;
      const next = !item.checked;
      enqueue(
        st.items.map((i) => (i.id === item.id ? { ...i, checked: next } : i)),
        { kind: "toggle", id: item.id, checked: next }
      );
    },
    [enqueue]
  );

  const setSection = useCallback(
    (item: GroceryItem, section: GrocerySection) => {
      const st = ref.current;
      enqueue(
        st.items.map((i) => (i.id === item.id ? { ...i, section } : i)),
        { kind: "section", id: item.id, section }
      );
    },
    [enqueue]
  );

  /** Rename / re-quantity an item ("coconut water" → "coconut water", "2 cans"). */
  const edit = useCallback(
    (item: GroceryItem, name: string, quantity: string) => {
      const st = ref.current;
      enqueue(
        st.items.map((i) => (i.id === item.id ? { ...i, name, quantity } : i)),
        { kind: "edit", id: item.id, name, quantity }
      );
    },
    [enqueue]
  );

  /** Removes immediately; returns an undo function (for the toast). */
  const remove = useCallback(
    (item: GroceryItem): (() => void) => {
      const st = ref.current;
      enqueue(
        st.items.filter((i) => i.id !== item.id),
        { kind: "delete", id: item.id }
      );
      return () => {
        const cur = ref.current;
        const op: Op = {
          kind: "restore",
          tempId: tempId(),
          item: {
            name: item.name,
            canonical_name: item.canonical_name,
            quantity: item.quantity,
            section: item.section,
            checked: item.checked,
            source_type: item.source_type,
            source_id: item.source_id,
            sources: item.sources,
          },
        };
        enqueue([...cur.items, { ...item, id: op.tempId }], op);
      };
    },
    [enqueue]
  );

  /**
   * Empties the list immediately; returns an undo that puts every item back.
   * Distinct from archiving: the trip stays open, and nothing is filed as
   * purchase history — this is "start this list over".
   */
  const clearAll = useCallback((): (() => void) => {
    const st = ref.current;
    const snapshot = st.items;
    if (!snapshot.length) return () => {};
    enqueue([], { kind: "clear", ids: snapshot.map((i) => i.id) });
    return () => {
      enqueue(snapshot, {
        kind: "restore-many",
        items: snapshot.map((i) => ({
          name: i.name,
          canonical_name: i.canonical_name,
          quantity: i.quantity,
          section: i.section,
          checked: i.checked,
          source_type: i.source_type,
          source_id: i.source_id,
          sources: i.sources,
        })),
      });
    };
  }, [enqueue]);

  /** Archives immediately; returns an undo function (for the toast). */
  const archive = useCallback(
    (carryIds: string[]): (() => Promise<void>) => {
      const st = ref.current;
      if (!st.trip) return async () => {};
      const snapshot: State = { trip: st.trip, items: st.items, queue: [] };
      const opId = tempId();
      const carried = st.items
        .filter((i) => carryIds.includes(i.id))
        .map((i) => ({
          ...i,
          id: tempId(),
          checked: false,
          carried_over_from: i.id,
        }));
      const newTrip: GroceryTrip = {
        id: tempId(),
        shop_date: nextSundayClient(),
        status: "open",
      };
      enqueue(carried, { kind: "archive", opId, carryIds, archivedTripId: st.trip.id }, newTrip);

      return async () => {
        const cur = ref.current;
        const queuedIndex = cur.queue.findIndex((o) => o.kind === "archive" && o.opId === opId);
        if (queuedIndex >= 0) {
          // never reached the server — drop the op, restore the snapshot
          commit({
            trip: snapshot.trip,
            items: snapshot.items,
            queue: cur.queue.filter((_, i) => i !== queuedIndex),
          });
          return;
        }
        // already synced — reverse it server-side, then re-adopt server state
        if (cur.trip && !isTemp(cur.trip.id)) {
          await fetch("/api/grocery/archive/undo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ archived_trip_id: snapshot.trip!.id, new_trip_id: cur.trip.id }),
          }).catch(() => {});
        }
        await flush();
      };
    },
    [commit, enqueue, flush]
  );

  return {
    hydrated,
    online,
    pendingCount: ref.current.queue.length,
    trip: ref.current.trip,
    items: ref.current.items,
    add,
    toggle,
    setSection,
    edit,
    remove,
    clearAll,
    archive,
    refresh: flush,
  };
}
