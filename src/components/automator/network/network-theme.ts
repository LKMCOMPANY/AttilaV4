/**
 * Network Map color palette.
 *
 * Three.js / WebGL cannot consume CSS variables or `oklch()` — hardcoded
 * hex values are the industry-standard approach for WebGL color theming.
 * The hex values mirror the OKLCH tokens declared in `globals.css`:
 *
 *   Dark primary    oklch(0.70 0.09 96)    → #b8a46c
 *   Light primary   oklch(0.50 0.07 96)    → #6e6230
 *   Dark destr.     oklch(0.60 0.22 25)    → #e05252
 *   Light destr.    oklch(0.577 0.245 27.3) → #dc2626
 *
 * When the design tokens move, update the matching hex here.
 */

export interface NetworkThemeColors {
  zoneTarget: string;
  sourcePost: string;
  avatar: string;
  mentionLink: string;
  completedLink: string;
  failedLink: string;
  pendingLink: string;
  bgCenter: string;
  bgEdge: string;
}

export const NETWORK_THEME = {
  dark: {
    zoneTarget: "#f5f0e8",
    sourcePost: "#8a8578",
    avatar: "#b8a46c",
    mentionLink: "#3d3a33",
    completedLink: "#b8a46c",
    failedLink: "#e05252",
    pendingLink: "#4a4740",
    bgCenter: "#1f1d19",
    bgEdge: "#15140f",
  },
  light: {
    zoneTarget: "#1a1814",
    sourcePost: "#78756e",
    avatar: "#6e6230",
    mentionLink: "#d6d3cc",
    completedLink: "#6e6230",
    failedLink: "#dc2626",
    pendingLink: "#a8a49c",
    bgCenter: "#faf9f7",
    bgEdge: "#f0eee9",
  },
} as const satisfies Record<"dark" | "light", NetworkThemeColors>;

export type NetworkThemeMode = keyof typeof NETWORK_THEME;
