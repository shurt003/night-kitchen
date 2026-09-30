// Theme constants shared by the server layout and the client hook.
// Deliberately NOT a "use client" module: the root layout is a server
// component, and every export of a client module reaches a server component as
// a client-reference stub rather than its actual value.
//
// Three independent axes drive the look, each its own attribute on <html>:
//   data-mode  = light | dark        (the preference can also be "system")
//   data-theme = brand family        (kitchen | mint | dusk)
//   data-style = standard | flooded  (flooded = the brand colour IS the surface)
// globals.css defines the tokens for every combination.

/** The MODE preference. "system" follows the OS; light/dark pin it. */
export type Theme = "system" | "light" | "dark";
/** The brand family. */
export type ThemeName = "kitchen" | "mint" | "dusk";
/** Neutral surface + brand accents, or the brand colour flooding the surface. */
export type ThemeStyle = "standard" | "flooded";

export const THEME_KEY = "nk-theme"; // mode preference
export const THEME_NAME_KEY = "nk-theme-name";
export const THEME_STYLE_KEY = "nk-theme-style";

export const DEFAULT_THEME_NAME: ThemeName = "kitchen";
export const DEFAULT_THEME_STYLE: ThemeStyle = "standard";

/** For the side-menu picker: swatch is the brand colour shown on the dot. */
export const THEMES: { name: ThemeName; label: string; swatch: string }[] = [
  { name: "kitchen", label: "Night Kitchen", swatch: "#e8430f" },
  { name: "mint", label: "Mint", swatch: "#00c244" },
  { name: "dusk", label: "Dusk", swatch: "#4f5bd5" },
];

/**
 * Inlined in <head> so the stored theme is applied before first paint —
 * otherwise the app flashes the default before switching on launch. Sets all
 * three axes; missing/blank storage falls back to the defaults.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var m=localStorage.getItem('${THEME_KEY}')||'system';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var n=localStorage.getItem('${THEME_NAME_KEY}')||'${DEFAULT_THEME_NAME}';var s=localStorage.getItem('${THEME_STYLE_KEY}')||'${DEFAULT_THEME_STYLE}';var r=document.documentElement;r.dataset.mode=d?'dark':'light';r.dataset.theme=n;r.dataset.style=s;}catch(e){}})();`;
