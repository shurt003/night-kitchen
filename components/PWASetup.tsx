"use client";

import { useEffect } from "react";

// Registers the service worker (production only — dev + SW caching is a
// debugging trap) and keeps it updated.
export function PWASetup() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      // A production run on this origin (e.g. `next start` on the same port)
      // leaves its worker behind, and its cache-first assets then poison dev
      // with stale chunks. Evict it.
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
      if ("caches" in window) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
      }
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
