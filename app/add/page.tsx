"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { springUI } from "@/lib/springs";

const MAX_IMAGES = 3;

/**
 * Downscale + re-encode to JPEG in the browser. Two jobs: keep the upload small
 * (vision calls are the priciest extraction and we pay for them) and normalize
 * iPhone HEIC into something the model accepts — drawing to a canvas lets Safari
 * decode HEIC for us, and we read back JPEG. Returns raw base64 (no data: prefix).
 */
function fileToJpegBase64(file: File, maxEdge = 1600, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Couldn't process that image."));
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality).split(",")[1] ?? "");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read that image."));
    };
    img.src = url;
  });
}

export default function AddRecipePage() {
  const router = useRouter();
  const [mode, setMode] = useState<"photos" | "text">("photos");
  const [images, setImages] = useState<string[]>([]); // base64, no prefix
  const [text, setText] = useState("");
  const [processing, setProcessing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    const room = MAX_IMAGES - images.length;
    if (room <= 0) return;
    const picked = Array.from(list).slice(0, room);
    const dropped = list.length - picked.length;
    setProcessing(true);
    try {
      const encoded: string[] = [];
      for (const file of picked) {
        try {
          encoded.push(await fileToJpegBase64(file));
        } catch {
          // Skip an unreadable file rather than failing the whole batch.
        }
      }
      setImages((prev) => [...prev, ...encoded]);
      if (dropped > 0) setError(`Only ${MAX_IMAGES} photos per recipe — kept the first ${MAX_IMAGES}.`);
    } finally {
      setProcessing(false);
      if (fileRef.current) fileRef.current.value = ""; // allow re-picking the same file
    }
  }

  function removeImage(i: number) {
    setImages((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function pasteText() {
    setError(null);
    try {
      const clip = await navigator.clipboard?.readText();
      if (!clip?.trim()) {
        setError("Your clipboard looks empty.");
        return;
      }
      setText(clip);
    } catch {
      setError("Couldn't read the clipboard — long-press the box and choose Paste.");
    }
  }

  const canSave = mode === "photos" ? images.length > 0 : text.trim().length > 0;

  async function submit() {
    if (!canSave || busy) return;
    setBusy(true);
    setError(null);
    const body = mode === "photos" ? { images } : { text };
    const res = await fetch("/api/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Couldn't save that.");
      return;
    }
    // The skeleton card appears in the library immediately.
    window.dispatchEvent(new CustomEvent("recipe-captured"));
    router.push("/");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),20px)]">
      <h1 className="pr-11 font-display text-3xl font-bold">Add a recipe</h1>

      <div className="mt-2 flex gap-2">
        {(["photos", "text"] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              mode === m ? "bg-char text-tile" : "bg-char/5 text-smoke"
            }`}
          >
            {m === "photos" ? "Photos" : "Paste text"}
          </button>
        ))}
      </div>

      {mode === "photos" ? (
        <div className="mt-4">
          <p className="text-sm text-smoke">
            Add up to {MAX_IMAGES} photos of one recipe — a cookbook page or two, a screenshot, a
            handwritten card. We&apos;ll read them and pull out the recipe.
          </p>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />

          <div className="mt-4 grid grid-cols-3 gap-3">
            <AnimatePresence initial={false}>
              {images.map((b64, i) => (
                <motion.div
                  key={b64.slice(0, 24) + i}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={springUI}
                  className="relative aspect-square overflow-hidden rounded-xl bg-surface"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/jpeg;base64,${b64}`}
                    alt={`Recipe photo ${i + 1}`}
                    className="h-full w-full object-cover"
                  />
                  <button
                    onClick={() => removeImage(i)}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-scrim/60 text-sm font-bold text-chalk"
                    aria-label={`Remove photo ${i + 1}`}
                  >
                    ✕
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>

            {images.length < MAX_IMAGES && (
              <button
                onClick={() => fileRef.current?.click()}
                disabled={processing}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-char/20 text-smoke hover:border-char/40 disabled:opacity-50"
              >
                <span className="text-2xl leading-none">{processing ? "…" : "+"}</span>
                <span className="text-xs font-medium">{processing ? "Reading" : "Add photo"}</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <p className="text-sm text-smoke">
            Paste as much as you want — the whole page, comments and all. We&apos;ll pull out just the
            recipe, so don&apos;t worry about trimming it first.
          </p>
          <div className="relative mt-4">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste the recipe here…"
              rows={10}
              className="w-full rounded-xl border border-char/15 bg-surface py-3 pl-4 pr-20 text-base outline-none focus:border-flame"
            />
            <motion.button
              whileTap={{ scale: 0.92 }}
              transition={springUI}
              onClick={pasteText}
              className="absolute right-2 top-2 rounded-lg bg-char/8 px-3 py-1.5 text-sm font-bold text-char"
            >
              Paste
            </motion.button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-flame">{error}</p>}

      <motion.button
        whileTap={{ scale: 0.97 }}
        transition={springUI}
        onClick={submit}
        disabled={busy || !canSave}
        className="mt-6 w-full rounded-xl bg-flame py-3.5 font-display text-base font-bold text-accent-ink disabled:opacity-40"
      >
        {busy ? "Saving…" : "Save it"}
      </motion.button>
    </main>
  );
}
