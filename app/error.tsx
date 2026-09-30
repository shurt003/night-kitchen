"use client";

import { useEffect } from "react";

/**
 * A long-lived PWA eventually navigates while holding chunks from a previous
 * deploy; the request 404s and lands here. That case is self-inflicted and
 * self-healing: clear caches and reload once, automatically. Anything else
 * (or a second failure in the same session) gets a human-sized button
 * instead of a dead screen.
 */
const RELOADED_KEY = "nk-stale-reload";

function isStaleDeploy(err: unknown): boolean {
  const msg = String((err as Error | undefined)?.message ?? err ?? "");
  return /chunk|css|failed to fetch|import|module/i.test(msg);
}

async function recover(): Promise<void> {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.update().catch(() => {})));
    }
  } finally {
    window.location.reload();
  }
}

export default function RouteError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    if (!isStaleDeploy(error)) return;
    try {
      if (sessionStorage.getItem(RELOADED_KEY)) return; // avoid reload loops
      sessionStorage.setItem(RELOADED_KEY, "1");
    } catch {
      return;
    }
    void recover();
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
      <h1 className="font-display text-2xl font-bold">Something went sideways.</h1>
      <p className="text-sm text-smoke">
        Usually this just means the app is out of date after an update.
      </p>
      <button
        onClick={() => void recover()}
        className="rounded-full bg-char px-5 py-2.5 font-display font-bold text-tile"
      >
        Reload
      </button>
    </main>
  );
}
