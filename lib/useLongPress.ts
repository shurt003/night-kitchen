"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const HOLD_MS = 600;
/** The overlay waits this long before appearing so a normal tap never flashes it. */
export const HOLD_REVEAL_MS = 180;

const MOVE_TOLERANCE_PX = 10;

/**
 * Press-and-hold to trigger a destructive action, without hijacking taps.
 * Cancels if the finger moves (so scrolling a grid never fires it), suppresses
 * the click that would otherwise follow, and maps right-click to the same
 * action on desktop.
 */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  const [holding, setHolding] = useState(false);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  }, []);

  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      origin.current = { x: e.clientX, y: e.clientY };
      suppressClick.current = false;
      setHolding(true);
      timer.current = setTimeout(() => {
        suppressClick.current = true;
        setHolding(false);
        onLongPress();
      }, HOLD_MS);
    },
    [onLongPress]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!timer.current) return;
      if (
        Math.abs(e.clientX - origin.current.x) > MOVE_TOLERANCE_PX ||
        Math.abs(e.clientY - origin.current.y) > MOVE_TOLERANCE_PX
      ) {
        cancel();
      }
    },
    [cancel]
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      // Right-click on desktop; also stops iOS's long-press callout menu.
      e.preventDefault();
      cancel();
      suppressClick.current = true;
      onLongPress();
    },
    [cancel, onLongPress]
  );

  /** Call at the top of onClick — returns true if this click should be ignored. */
  const clickWasSuppressed = useCallback(() => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  }, []);

  return {
    holding,
    clickWasSuppressed,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onContextMenu,
    },
  };
}
