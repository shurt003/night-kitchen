"use client";

import { useEffect } from "react";

/**
 * Catches failures in the root layout itself, where no app CSS is guaranteed —
 * hence inline styles. Same self-healing as app/error.tsx: a stale-deploy
 * chunk failure clears caches and reloads once; anything else gets a button.
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

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    if (!isStaleDeploy(error)) return;
    try {
      if (sessionStorage.getItem(RELOADED_KEY)) return;
      sessionStorage.setItem(RELOADED_KEY, "1");
    } catch {
      return;
    }
    void recover();
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          background: "#f2f1ec",
          color: "#191512",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "0 2rem",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", margin: 0 }}>Something went sideways.</h1>
        <p style={{ fontSize: "0.9rem", color: "#8b857c", margin: 0 }}>
          Usually this just means the app is out of date after an update.
        </p>
        <button
          onClick={() => void recover()}
          style={{
            border: "none",
            borderRadius: "999px",
            background: "#191512",
            color: "#f2f1ec",
            padding: "0.7rem 1.4rem",
            fontSize: "1rem",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
