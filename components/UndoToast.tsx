"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { springOvershoot } from "@/lib/springs";

// Undo instead of confirmation: destructive actions just happen, and this
// toast offers a few seconds to take them back.
//
// Two modes:
//  - show(msg, onUndo)             the action already happened; onUndo reverses it.
//  - show(msg, onUndo, onCommit)   the action is DEFERRED — onCommit performs it
//                                  for real once the window closes. Undo simply
//                                  cancels, so nothing was ever destroyed.
// The deferred mode is what delete uses: a cancelled delete can't half-restore.

const WINDOW_MS = 6000;

type Toast = {
  id: number;
  message: string;
  onUndo: () => void | Promise<void>;
};

export function useUndoToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCommit = useRef<(() => void | Promise<void>) | null>(null);

  const flushCommit = useCallback(() => {
    const commit = pendingCommit.current;
    pendingCommit.current = null;
    if (commit) void commit();
  }, []);

  const show = useCallback(
    (
      message: string,
      onUndo: () => void | Promise<void>,
      onCommit?: () => void | Promise<void>
    ) => {
      if (timer.current) clearTimeout(timer.current);
      flushCommit(); // a new toast finalizes whatever was still pending
      pendingCommit.current = onCommit ?? null;
      setToast({ id: Date.now(), message, onUndo });
      timer.current = setTimeout(() => {
        flushCommit();
        setToast(null);
      }, WINDOW_MS);
    },
    [flushCommit]
  );

  const undo = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    pendingCommit.current = null; // cancel the deferred action outright
    const current = toast;
    setToast(null);
    if (current) await current.onUndo();
  }, [toast]);

  // Leaving the page finalizes a pending delete rather than silently dropping it.
  useEffect(() => () => flushCommit(), [flushCommit]);

  return { toast, show, undo };
}

export function UndoToast({
  toast,
  onUndo,
  raised = false,
}: {
  toast: Toast | null;
  onUndo: () => void | Promise<void>;
  /** Sit above a bottom action bar (e.g. the plan page's commit bar). */
  raised?: boolean;
}) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          initial={{ opacity: 0, y: 24, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.97 }}
          transition={springOvershoot}
          className={`fixed inset-x-4 z-[60] mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-char px-4 py-3 text-tile shadow-xl ${
            raised ? "bottom-44" : "bottom-24"
          }`}
        >
          <span className="min-w-0 flex-1 truncate text-sm">{toast.message}</span>
          <button
            onClick={() => void onUndo()}
            className="shrink-0 rounded-full bg-yolk px-3.5 py-1.5 text-sm font-bold text-scrim"
          >
            Undo
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
