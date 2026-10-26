// The "beats" engine. A scene is a list of beats; each beat has a caption (`say`) and may
// change what is on screen (show code, focus lines, light up boxes, send packets).
// Durations are derived from the caption length, so the video is paced for reading. The
// narrated version also waits for each beat's voice-over (src/generated/voice.json).

import React, { createContext, useContext } from "react";
import { Easing, interpolate, spring, useCurrentFrame } from "remotion";
import VOICE from "./generated/voice.json";
import { FPS } from "./theme";

export type Beat = {
  say: string;
  /** what the voice-over says instead, when the caption doesn't read well aloud */
  speak?: string;
  /** seconds; default: from the caption length */
  d?: number;
  /** snippet id to show from this beat on (null hides the code card) */
  code?: string | null;
  /** substrings: lines of the current snippet that contain one are highlighted */
  focus?: string[];
  /** box ids to highlight on a Board / participants on a Sequence */
  hl?: string[];
  /** arrow ids that carry moving packets during this beat */
  flow?: string[];
};

export type SceneDef = {
  id: string;
  chapter: string;
  title: string;
  beats: Beat[];
  View: React.FC;
  /** "split" = visual left, code right. Default: split if any beat has code. */
  layout?: "split" | "full";
};

export const beatSeconds = (b: Beat) => b.d ?? Math.min(12, Math.max(3.6, b.say.split(/\s+/).length / 3.2 + 1.5));

/** Seconds of voice-over for beat `i` of `s` (made by `npm run voice`). */
export function voiceSeconds(s: SceneDef, i: number) {
  const v = (VOICE as Record<string, number>)[`${s.id}/${i}`];
  if (v === undefined) throw new Error(`no voice-over for ${s.id}/${i}: run "npm run voice"`);
  return v;
}

/** Each beat's length in frames; narrated, a beat also lasts until its voice-over has finished, plus a breath. */
export const beatFramesOf = (s: SceneDef, narrated = false) =>
  s.beats.map((b, i) => Math.round((narrated ? Math.max(beatSeconds(b), voiceSeconds(s, i) + 0.6) : beatSeconds(b)) * FPS));
export const sceneFrames = (s: SceneDef, narrated = false) => beatFramesOf(s, narrated).reduce((n, f) => n + f, 0);
export const isSplit = (s: SceneDef) => (s.layout ? s.layout === "split" : s.beats.some((b) => b.code));

type Ctx = { def: SceneDef; beat: number; frame: number; starts: number[]; total: number };
const SceneCtx = createContext<Ctx | null>(null);

export const SceneProvider: React.FC<{ def: SceneDef; narrated?: boolean; children: React.ReactNode }> = ({ def, narrated, children }) => {
  const frame = useCurrentFrame();
  const starts: number[] = [];
  let acc = 0;
  for (const f of beatFramesOf(def, narrated)) {
    starts.push(acc);
    acc += f;
  }
  let beat = 0;
  for (let i = 0; i < starts.length; i++) if (frame >= starts[i]) beat = i;
  return <SceneCtx.Provider value={{ def, beat, frame, starts, total: acc }}>{children}</SceneCtx.Provider>;
};

export function useScene() {
  const c = useContext(SceneCtx);
  if (!c) throw new Error("useScene outside a scene");
  return c;
}

/** Frames elapsed since beat `at` started (negative before it). */
export function useSince(at: number, delay = 0) {
  const { frame, starts } = useScene();
  return frame - (starts[Math.min(at, starts.length - 1)] ?? 0) - delay;
}

/** The current beat's value of a field, or the latest earlier beat that set it. */
export function useSticky<K extends keyof Beat>(key: K): { value: Beat[K] | undefined; since: number } {
  const { def, beat } = useScene();
  for (let i = beat; i >= 0; i--) if (key in def.beats[i]) return { value: def.beats[i][key], since: i };
  return { value: undefined, since: 0 };
}

export const ease = Easing.bezier(0.22, 1, 0.36, 1);

export function fadeIn(t: number, len = 14) {
  return interpolate(t, [0, len], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
}

export function pop(t: number) {
  return spring({ frame: t, fps: FPS, config: { damping: 16, stiffness: 140, mass: 0.7 } });
}

/** Visible from beat `at` (until beat `until`, exclusive). */
export const Appear: React.FC<{
  at?: number;
  until?: number;
  delay?: number;
  from?: "up" | "down" | "left" | "right" | "fade" | "scale";
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ at = 0, until, delay = 0, from = "up", style, children }) => {
  const { beat } = useScene();
  const t = useSince(at, delay);
  const tOut = useSince(until ?? 9999);
  if (t < 0) return null;
  if (until !== undefined && beat >= until && tOut > 10) return null;
  const p = pop(t);
  const outP = until !== undefined && beat >= until ? 1 - fadeIn(tOut, 10) : 1;
  const d = 26 * (1 - p);
  const tr =
    from === "up" ? `translateY(${d}px)` :
    from === "down" ? `translateY(${-d}px)` :
    from === "left" ? `translateX(${-d}px)` :
    from === "right" ? `translateX(${d}px)` :
    from === "scale" ? `scale(${0.85 + 0.15 * p})` : "none";
  return <div style={{ ...style, opacity: Math.min(1, fadeIn(t)) * outP, transform: tr }}>{children}</div>;
};
