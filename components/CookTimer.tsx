"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { springOvershoot } from "@/lib/springs";

export type TimerState = {
  id: string;
  label: string;
  total: number;
  remaining: number;
  running: boolean;
  done: boolean;
};

function mmss(s: number): string {
  const m = Math.floor(Math.max(0, s) / 60);
  const sec = Math.max(0, s) % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * §7: "Timers animate as a filling arc, not a countdown label. Timer completion
 * is a physical event: a pulse that propagates outward through the layout."
 * The arc is an SVG stroke-dashoffset — a transform-free property that still
 * stays off the layout path.
 */
export function CookTimer({
  timer,
  onToggle,
  onDismiss,
  compact = false,
}: {
  timer: TimerState;
  onToggle: () => void;
  onDismiss: () => void;
  compact?: boolean;
}) {
  const reduce = useReducedMotion();
  const size = compact ? 40 : 62;
  const stroke = compact ? 3 : 4;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const progress = timer.total ? 1 - timer.remaining / timer.total : 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={
        timer.done && !reduce
          ? { opacity: 1, scale: [1, 1.12, 1] }
          : { opacity: 1, scale: 1 }
      }
      transition={timer.done ? { duration: 0.5, repeat: Infinity, repeatDelay: 0.7 } : springOvershoot}
      className={`flex items-center gap-2 rounded-full ${
        timer.done ? "bg-flame text-accent-ink" : "bg-char/8"
      } ${compact ? "py-1 pl-1 pr-3" : "p-2 pr-4"}`}
    >
      <button onClick={onToggle} className="relative shrink-0" aria-label={timer.running ? "Pause timer" : "Start timer"}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            className={timer.done ? "stroke-chalk/30" : "stroke-char/15"}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            className={timer.done ? "stroke-chalk" : "stroke-flame"}
            style={{ transition: "stroke-dashoffset 1s linear" }}
          />
        </svg>
        <span
          className={`absolute inset-0 flex items-center justify-center ${
            compact ? "text-[10px]" : "text-xs"
          } font-bold`}
        >
          {timer.done ? "✓" : timer.running ? mmss(timer.remaining) : "▶"}
        </span>
      </button>
      <span className="min-w-0">
        <span className={`block truncate ${compact ? "text-xs" : "text-sm"} font-semibold`}>
          {timer.done ? "Time's up" : timer.label}
        </span>
        {!compact && !timer.done && (
          <span className="block text-xs opacity-60">{mmss(timer.remaining)} left</span>
        )}
      </span>
      <button onClick={onDismiss} aria-label="Dismiss timer" className="ml-1 shrink-0 opacity-50">
        ✕
      </button>
    </motion.div>
  );
}

/** Timers keep running across steps, and several can run at once (§5). */
export function useTimers() {
  const [timers, setTimers] = useState<TimerState[]>([]);
  const [pulse, setPulse] = useState(0);
  const audioRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const t = setInterval(() => {
      setTimers((prev) => {
        let finished = false;
        const next = prev.map((timer) => {
          if (!timer.running || timer.done) return timer;
          const remaining = timer.remaining - 1;
          if (remaining <= 0) {
            finished = true;
            return { ...timer, remaining: 0, running: false, done: true };
          }
          return { ...timer, remaining };
        });
        if (finished) setPulse((p) => p + 1);
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // A short tone when a timer lands — hands are usually busy.
  useEffect(() => {
    if (!pulse) return;
    try {
      audioRef.current ??= new AudioContext();
      const ctx = audioRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch {
      // audio is a nicety, never a requirement
    }
  }, [pulse]);

  function add(label: string, seconds: number) {
    setTimers((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.round(seconds)}`,
        label,
        total: seconds,
        remaining: seconds,
        running: true,
        done: false,
      },
    ]);
  }

  function toggle(id: string) {
    setTimers((prev) =>
      prev.map((t) => (t.id === id && !t.done ? { ...t, running: !t.running } : t))
    );
  }

  function dismiss(id: string) {
    setTimers((prev) => prev.filter((t) => t.id !== id));
  }

  return { timers, add, toggle, dismiss, pulse };
}
