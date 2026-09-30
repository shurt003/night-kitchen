"use client";

import { useCallback, useEffect, useState } from "react";
import {
  THEME_KEY,
  THEME_NAME_KEY,
  THEME_STYLE_KEY,
  DEFAULT_THEME_NAME,
  DEFAULT_THEME_STYLE,
  type Theme,
  type ThemeName,
  type ThemeStyle,
} from "./theme";

export type { Theme, ThemeName, ThemeStyle };

function resolveMode(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * The resolved value of --tile, as an rgb string. Read via a throwaway probe
 * rather than getPropertyValue because a flooded theme's --tile is a
 * `color-mix(...)` expression, not a literal — the probe forces the browser to
 * compute it so the iOS status bar gets a real colour.
 */
function currentTileColor(): string {
  const probe = document.createElement("div");
  probe.style.cssText =
    "background-color:var(--tile);position:absolute;opacity:0;pointer-events:none";
  document.documentElement.appendChild(probe);
  const c = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return c;
}

function syncThemeColor(): void {
  const c = currentTileColor();
  if (c) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", c);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");
  const [name, setNameState] = useState<ThemeName>(DEFAULT_THEME_NAME);
  const [style, setStyleState] = useState<ThemeStyle>(DEFAULT_THEME_STYLE);
  /** What's actually on screen — "system" resolves to one of these. */
  const [resolved, setResolved] = useState<"light" | "dark">("light");
  // The server can't know stored prefs, so selection state renders only after
  // mount to avoid a hydration mismatch.
  const [mounted, setMounted] = useState(false);

  const applyMode = useCallback((pref: Theme): "light" | "dark" => {
    const r = resolveMode(pref);
    document.documentElement.dataset.mode = r;
    syncThemeColor();
    return r;
  }, []);

  useEffect(() => {
    let mode: Theme = "system";
    let nm: ThemeName = DEFAULT_THEME_NAME;
    let st: ThemeStyle = DEFAULT_THEME_STYLE;
    try {
      const rawMode = localStorage.getItem(THEME_KEY);
      if (rawMode === "light" || rawMode === "dark" || rawMode === "system") mode = rawMode;
      const rawName = localStorage.getItem(THEME_NAME_KEY);
      if (rawName === "kitchen" || rawName === "mint" || rawName === "dusk") nm = rawName;
      const rawStyle = localStorage.getItem(THEME_STYLE_KEY);
      if (rawStyle === "standard" || rawStyle === "flooded") st = rawStyle;
    } catch {
      // private mode / storage disabled — fall back to defaults
    }
    setThemeState(mode);
    setNameState(nm);
    setStyleState(st);
    // The init script already set the attributes pre-paint; re-assert and read
    // back the resolved mode / theme-color for state.
    document.documentElement.dataset.theme = nm;
    document.documentElement.dataset.style = st;
    setResolved(applyMode(mode));
    setMounted(true);
  }, [applyMode]);

  // While on "system", track the OS flipping (e.g. at sunset).
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(applyMode("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme, applyMode]);

  const persist = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // not fatal — the choice just won't persist
    }
  };

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      persist(THEME_KEY, next);
      setResolved(applyMode(next));
    },
    [applyMode]
  );

  const setThemeName = useCallback((next: ThemeName) => {
    setNameState(next);
    persist(THEME_NAME_KEY, next);
    document.documentElement.dataset.theme = next;
    syncThemeColor();
  }, []);

  const setThemeStyle = useCallback((next: ThemeStyle) => {
    setStyleState(next);
    persist(THEME_STYLE_KEY, next);
    document.documentElement.dataset.style = next;
    syncThemeColor();
  }, []);

  return { theme, setTheme, name, setThemeName, style, setThemeStyle, mounted, resolved };
}
