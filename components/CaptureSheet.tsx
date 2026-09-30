"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { springUI } from "@/lib/springs";

/** Share sheets often hand over "Some Title https://…" — take the link out. */
function extractUrl(text: string): string {
  return text.match(/https?:\/\/[^\s<>"']+/)?.[0] ?? text.trim();
}

// In-app capture: paste a URL or recipe text. (Screenshots/PDF come in via the
// iOS Shortcut hitting POST /api/capture directly.)
//
// NOTE (2026-07-20): currently unused — "Add a recipe" now routes to the /add
// page (photos + paste text). Kept intentionally because it holds the in-app URL
// capture UI, which we removed from the surface but may bring back. To restore
// URL capture, render this again or lift its "Link" mode into /add.
export function CaptureSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"url" | "text">("url");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState(false);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  /**
   * Reading the clipboard needs a user gesture, so it lives on a button rather
   * than firing when the sheet opens. iOS shows its own confirmation the first
   * time; if it's refused or unsupported we focus the field so the normal
   * long-press → Paste still works.
   */
  async function pasteFromClipboard() {
    setError(null);
    try {
      const text = await navigator.clipboard?.readText();
      if (!text?.trim()) {
        setError("Your clipboard looks empty.");
        return;
      }
      setValue(mode === "url" ? extractUrl(text) : text);
      setPasted(true);
      setTimeout(() => setPasted(false), 1400);
    } catch {
      setError("Couldn't read the clipboard — long-press the field and choose Paste.");
      fieldRef.current?.focus();
    }
  }

  async function submit() {
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    const body = mode === "url" ? { url: value.trim() } : { text: value };
    const res = await fetch("/api/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Capture failed");
      return;
    }
    setValue("");
    onClose();
    // The skeleton card appears in the library immediately.
    if (window.location.pathname !== "/") router.push("/");
    window.dispatchEvent(new CustomEvent("recipe-captured"));
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-scrim/40"
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={springUI}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-2xl rounded-t-3xl bg-tile p-5 pb-[max(env(safe-area-inset-bottom),20px)] shadow-2xl"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-char/15" />
            <h2 className="font-display text-xl font-bold">Capture a recipe</h2>
            <div className="mt-3 flex gap-2">
              {(["url", "text"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    mode === m ? "bg-char text-tile" : "bg-char/5 text-smoke"
                  }`}
                >
                  {m === "url" ? "Link" : "Paste text"}
                </button>
              ))}
            </div>
            {/* No autoFocus: a link gets pasted, never typed, so popping the
                keyboard would just cover the sheet. */}
            <div className="relative mt-4">
              {mode === "url" ? (
                <input
                  ref={fieldRef as React.Ref<HTMLInputElement>}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder="https://…"
                  inputMode="url"
                  className="w-full rounded-xl border border-char/15 bg-surface py-3 pl-4 pr-24 text-base outline-none focus:border-flame"
                />
              ) : (
                <textarea
                  ref={fieldRef as React.Ref<HTMLTextAreaElement>}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Paste the whole recipe here…"
                  rows={6}
                  className="w-full rounded-xl border border-char/15 bg-surface py-3 pl-4 pr-24 text-base outline-none focus:border-flame"
                />
              )}
              <motion.button
                whileTap={{ scale: 0.92 }}
                transition={springUI}
                onClick={pasteFromClipboard}
                className={`absolute right-2 ${mode === "url" ? "top-1/2 -translate-y-1/2" : "top-2"} rounded-lg px-3 py-1.5 text-sm font-bold ${
                  pasted ? "bg-herb text-chalk" : "bg-char/8 text-char"
                }`}
              >
                {pasted ? "✓ Pasted" : "Paste"}
              </motion.button>
            </div>
            {error && <p className="mt-2 text-sm text-flame">{error}</p>}
            <motion.button
              whileTap={{ scale: 0.97 }}
              transition={springUI}
              onClick={submit}
              disabled={busy || !value.trim()}
              className="mt-4 w-full rounded-xl bg-flame py-3.5 font-display text-base font-bold text-accent-ink disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save it"}
            </motion.button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
