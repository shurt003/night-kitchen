"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

// §7: "Adding a meal's ingredients to the list: the items should visibly travel
// — a short staggered flight from the meal card toward the list, with the list
// badge absorbing them and reacting. I need to trust that the tap worked
// without navigating to check."
//
// Event-driven so any surface can trigger it without prop drilling:
//   window.dispatchEvent(new CustomEvent("fly-to-list", { detail: { x, y, count } }))

type Flight = { id: number; x: number; y: number; count: number };

export function FlyToList() {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [target, setTarget] = useState<{ x: number; y: number } | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const onFly = (e: Event) => {
      const { x, y, count } = (e as CustomEvent).detail ?? {};
      const tab = document.querySelector("[data-grocery-tab]");
      if (!tab) return;
      const r = tab.getBoundingClientRect();
      setTarget({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      const id = Date.now();
      setFlights((f) => [...f, { id, x, y, count: Math.min(count ?? 3, 6) }]);
      // The badge reacts as the items land.
      window.setTimeout(
        () => window.dispatchEvent(new CustomEvent("grocery-absorbed")),
        reduce ? 0 : 430
      );
      window.setTimeout(() => setFlights((f) => f.filter((x) => x.id !== id)), 900);
    };
    window.addEventListener("fly-to-list", onFly);
    return () => window.removeEventListener("fly-to-list", onFly);
  }, [reduce]);

  // Reduced motion: the badge still reacts, but nothing flies across the screen.
  if (reduce) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]">
      <AnimatePresence>
        {flights.map((flight) =>
          Array.from({ length: flight.count }).map((_, i) => (
            <motion.span
              key={`${flight.id}-${i}`}
              initial={{ x: flight.x, y: flight.y, opacity: 0, scale: 0.6 }}
              animate={{
                x: target?.x ?? flight.x,
                y: target?.y ?? flight.y,
                opacity: [0, 1, 1, 0],
                scale: [0.6, 1, 0.9, 0.4],
              }}
              exit={{ opacity: 0 }}
              transition={{
                duration: 0.52,
                delay: i * 0.055,
                ease: [0.32, 0.72, 0.35, 1],
                opacity: { times: [0, 0.15, 0.75, 1], duration: 0.52, delay: i * 0.055 },
              }}
              className="absolute left-0 top-0 -ml-1.5 -mt-1.5 block h-3 w-3 rounded-full bg-flame shadow"
            />
          ))
        )}
      </AnimatePresence>
    </div>
  );
}
