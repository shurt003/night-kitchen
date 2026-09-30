"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";

/**
 * A recipe photo that stays invisible until it has fully decoded, then fades in.
 *
 * The hiding is the point, not just the fade: a plain <img> paints partial rows
 * as bytes arrive, so on a weak connection a photo builds top-to-bottom in
 * visible chunks. Holding opacity at 0 until `load` means you see the slot, then
 * the finished photo, and nothing in between.
 */
export function RecipeImage({
  src,
  className = "h-full w-full object-cover",
  layoutId,
}: {
  src: string;
  className?: string;
  /** Pairs the card and the detail sheet for the shared-element morph. */
  layoutId?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  // A cached image can finish decoding before React attaches onLoad, which
  // would strand it at opacity 0 forever. `complete` catches that case.
  useEffect(() => {
    if (ref.current?.complete) setLoaded(true);
  }, [src]);

  return (
    <>
      {!loaded && <span className="nk-img-spinner" aria-hidden="true" />}
      <motion.img
        ref={ref}
        layoutId={layoutId}
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        // An image that will never load shouldn't spin forever — reveal the
        // empty slot instead.
        onError={() => setLoaded(true)}
        // Opacity via CSS rather than Motion so it can't interfere with the
        // shared-element morph that layoutId drives on open.
        className={`${className} transition-opacity duration-500 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
    </>
  );
}
