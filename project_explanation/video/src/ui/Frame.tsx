// Everything around a scene: header (part + title), the caption band, the chapter bar,
// and the split between the visual (left) and the code card (right).

import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { fadeIn, isSplit, SceneDef, useScene, useSince, useSticky } from "../engine";
import { BODY, C, CAPTION_Y, H, HEADER_H, HLJS_CSS, MONO, SANS, SPLIT, W } from "../theme";
import { CodeCard } from "./CodeCard";
import { Rich } from "./Rich";

export type ChapterInfo = { name: string; frames: number; start: number };

const Header: React.FC<{ def: SceneDef; num: number }> = ({ def, num }) => {
  const t = useSince(0);
  return (
    <div style={{ position: "absolute", left: 40, top: 0, width: W - 80, height: HEADER_H, display: "flex", alignItems: "center", borderBottom: `1px solid ${C.line}`, opacity: fadeIn(t, 10) }}>
      <div style={{ fontFamily: MONO, fontSize: 20, color: C.bg, background: C.accent, borderRadius: 8, padding: "4px 12px", fontWeight: 700, marginRight: 22, whiteSpace: "nowrap" }}>
        {String(num).padStart(2, "0")} · {def.chapter}
      </div>
      <div style={{ fontFamily: SANS, fontSize: 44, fontWeight: 800, color: C.text, letterSpacing: -0.6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        <Rich text={def.title} />
      </div>
      <div style={{ marginLeft: "auto", fontFamily: SANS, fontSize: 20, color: C.faint, fontWeight: 600, whiteSpace: "nowrap", paddingLeft: 24 }}>
        Sky<span style={{ color: "#38bdf8" }}>Pulse</span>, explained
      </div>
    </div>
  );
};

const Caption: React.FC = () => {
  const { def, beat, starts, frame } = useScene();
  const t = frame - starts[beat];
  const op = fadeIn(t, 9);
  const text = def.beats[beat].say;
  return (
    <div style={{ position: "absolute", left: 40, top: CAPTION_Y, width: W - 80, height: 128, display: "flex", alignItems: "center", borderTop: `1px solid ${C.line}` }}>
      <div style={{ width: 6, alignSelf: "stretch", margin: "18px 26px 18px 0", borderRadius: 3, background: C.accent, opacity: 0.85 }} />
      <div style={{ fontFamily: SANS, fontSize: text.length > 170 ? 29 : 32, lineHeight: 1.36, color: C.text, opacity: op, transform: `translateY(${(1 - op) * 10}px)`, fontWeight: 450 }}>
        <Rich text={text} />
      </div>
    </div>
  );
};

const ChapterBar: React.FC<{ chapters: ChapterInfo[]; globalFrame: number; total: number }> = ({ chapters, globalFrame, total }) => {
  const x0 = 40, w = W - 80, y = H - 34;
  return (
    <div style={{ position: "absolute", left: x0, top: y, width: w, height: 26 }}>
      {chapters.map((c, i) => {
        const left = (c.start / total) * w;
        const cw = (c.frames / total) * w;
        const p = Math.max(0, Math.min(1, (globalFrame - c.start) / c.frames));
        const cur = p > 0 && p < 1;
        return (
          <div key={i} style={{ position: "absolute", left, width: cw - 6, top: 0 }}>
            <div style={{ height: 5, borderRadius: 3, background: C.line, overflow: "hidden" }}>
              <div style={{ width: `${p * 100}%`, height: "100%", background: cur ? C.accent : "#5d6a86" }} />
            </div>
            <div style={{ fontFamily: SANS, fontSize: 14, marginTop: 4, color: cur ? C.accent : C.faint, fontWeight: cur ? 700 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {c.name}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** Visual area size for the current layout */
export function visualSize(def: SceneDef) {
  return isSplit(def) ? { w: SPLIT.visualW, h: BODY.h } : { w: BODY.w, h: BODY.h };
}

const Body: React.FC<{ def: SceneDef }> = ({ def }) => {
  const split = isSplit(def);
  const { value: code } = useSticky("code");
  const codeW = BODY.w - SPLIT.visualW - SPLIT.gap;
  return (
    <div style={{ position: "absolute", left: BODY.x, top: BODY.y, width: BODY.w, height: BODY.h }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: split ? SPLIT.visualW : BODY.w, height: BODY.h }}>
        <def.View />
      </div>
      {split && code && (
        <div style={{ position: "absolute", left: SPLIT.visualW + SPLIT.gap, top: 0 }}>
          <CodeCard w={codeW} h={BODY.h} />
        </div>
      )}
    </div>
  );
};

export const SceneFrame: React.FC<{ def: SceneDef; num: number; chapters: ChapterInfo[]; offset: number; total: number; frames: number }> = ({ def, num, chapters, offset, total, frames }) => {
  const { frame } = useScene();
  const fade = interpolate(frame, [0, 8, frames - 6, frames], [0, 1, 1, 0.0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1400px 800px at 70% 0%, #14204099, transparent), ${C.bg}` }}>
      <style>{HLJS_CSS}</style>
      <div style={{ position: "absolute", inset: 0, opacity: fade }}>
        <Header def={def} num={num} />
        <Body def={def} />
        <Caption />
      </div>
      <ChapterBar chapters={chapters} globalFrame={offset + frame} total={total} />
    </AbsoluteFill>
  );
};
