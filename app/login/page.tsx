"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { springOvershoot } from "@/lib/springs";
import { clearUserDataCaches } from "@/lib/userCache";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      // Wipe any previous account's cached data before the app boots, so a
      // shared device never flashes the last user's grocery list / pantry.
      clearUserDataCaches();
      window.location.href = "/";
    } else {
      setBusy(false);
      setError(true);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={springOvershoot}
        className="w-full max-w-sm"
      >
        <h1 className="text-center font-display text-4xl font-bold">Night Kitchen</h1>
        <p className="mt-1 text-center font-hand text-2xl text-smoke">what are we cooking?</p>
        <form onSubmit={submit} className="mt-8">
          <motion.input
            animate={error ? { x: [0, -8, 8, -5, 5, 0] } : {}}
            transition={{ duration: 0.35 }}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
            autoFocus
            className={`w-full rounded-xl border bg-surface px-4 py-3.5 text-center text-lg outline-none ${
              error ? "border-flame" : "border-char/15 focus:border-flame"
            }`}
          />
          <button
            type="submit"
            disabled={busy || !password}
            className="mt-3 w-full rounded-xl bg-char py-3.5 font-display font-bold text-tile disabled:opacity-40"
          >
            {busy ? "…" : "Come in"}
          </button>
        </form>
      </motion.div>
    </main>
  );
}
