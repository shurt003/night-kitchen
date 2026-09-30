"use client";

import { useEffect } from "react";

// Sheets can stack (Sunday flow opens the add-to-list sheet on top), so the
// lock is refcounted — the page unfreezes only when the last sheet leaves.
let locks = 0;

/** Freeze page scrolling while the calling component is mounted. */
export function useBodyScrollLock() {
  useEffect(() => {
    locks++;
    if (locks === 1) {
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
    }
    return () => {
      locks--;
      if (locks === 0) {
        document.documentElement.style.overflow = "";
        document.body.style.overflow = "";
      }
    };
  }, []);
}
