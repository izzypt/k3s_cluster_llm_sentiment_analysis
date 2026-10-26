import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

export const SANS = loadInter("normal", { weights: ["400", "500", "600", "700", "800"], subsets: ["latin"] }).fontFamily;
export const MONO = loadMono("normal", { weights: ["400", "600", "700"], subsets: ["latin"] }).fontFamily;

export const W = 1920;
export const H = 1080;
export const FPS = 30;

// Layout bands (px)
export const HEADER_H = 112;
export const CAPTION_Y = 898;
export const BODY = { x: 40, y: HEADER_H + 12, w: W - 80, h: CAPTION_Y - HEADER_H - 28 };
// Split layout: visual on the left, code on the right
export const SPLIT = { visualW: 860, gap: 30 };

export const C = {
  bg: "#0a0f1e",
  bg2: "#10172b",
  panel: "#131b31",
  panel2: "#18223d",
  line: "#26324f",
  text: "#e6ebf5",
  dim: "#93a0bb",
  faint: "#5d6a86",
  accent: "#fbbf24",
  ok: "#4ade80",
  bad: "#f87171",
  warn: "#fb923c",
};

/** One colour per zone, used everywhere a component of that zone appears. */
export const ZONE = {
  internet: "#94a3b8",
  lan: "#f472b6",
  ingestion: "#f59e0b",
  data: "#a78bfa",
  analysis: "#38bdf8",
  monitoring: "#34d399",
  platform: "#7c8db5",
  build: "#facc15",
  git: "#fb7185",
} as const;
export type Zone = keyof typeof ZONE;

/** highlight.js token colours (dark) */
export const HLJS_CSS = `
.hljs-keyword,.hljs-selector-tag,.hljs-meta .hljs-keyword{color:#c792ea}
.hljs-built_in,.hljs-type{color:#82aaff}
.hljs-string,.hljs-regexp,.hljs-template-tag{color:#c3e88d}
.hljs-number,.hljs-literal{color:#f78c6c}
.hljs-comment,.hljs-quote{color:#6b7896;font-style:italic}
.hljs-title,.hljs-title.function_,.hljs-section{color:#82aaff}
.hljs-attr,.hljs-attribute,.hljs-variable,.hljs-template-variable{color:#ffcb6b}
.hljs-params{color:#e6ebf5}
.hljs-meta,.hljs-meta .hljs-string{color:#89ddff}
.hljs-symbol,.hljs-bullet,.hljs-link{color:#89ddff}
.hljs-subst{color:#e6ebf5}
.hljs-name,.hljs-tag{color:#f07178}
`;
