"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

/** §7: the reasoning line types in beneath each pick. */
export function TypeIn({
  text,
  delay = 0,
  className,
}: {
  text: string;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? text : "");

  useEffect(() => {
    if (reduce) {
      setShown(text);
      return;
    }
    setShown("");
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const start = setTimeout(function tick() {
      i += 2;
      setShown(text.slice(0, i));
      if (i < text.length) timer = setTimeout(tick, 16);
    }, delay);
    return () => {
      clearTimeout(start);
      clearTimeout(timer);
    };
  }, [text, delay, reduce]);

  return <span className={className}>{shown}</span>;
}
