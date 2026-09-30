// Shared spring presets — physics over duration curves, everywhere.
export const springUI = { type: "spring", stiffness: 420, damping: 34 } as const;
export const springSoft = { type: "spring", stiffness: 300, damping: 30 } as const;
export const springOvershoot = { type: "spring", stiffness: 380, damping: 22 } as const;
