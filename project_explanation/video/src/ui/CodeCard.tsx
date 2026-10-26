// The code panel: a real excerpt of skypulse/ (file + line numbers), with the lines the
// caption talks about highlighted.

import React from "react";
import { interpolate } from "remotion";
import snippets from "../generated/snippets.json";
import { fadeIn, useScene, useSince, useSticky } from "../engine";
import { C, MONO, SANS } from "../theme";

type Line = { gap: true } | { no: number; text: string; html: string };
type Snippet = { file: string; title: string; first: number; last: number; lines: Line[] };
const S = snippets as unknown as Record<string, Snippet>;

export function snippet(id: string) {
  const s = S[id];
  if (!s) throw new Error(`unknown snippet ${id}`);
  return s;
}

export const CodeCard: React.FC<{ w: number; h: number }> = ({ w, h }) => {
  const { def, beat } = useScene();
  const { value: id, since } = useSticky("code");
  const tIn = useSince(since);
  const tBeat = useSince(beat);
  if (!id) return null;
  const s = snippet(id);
  const focus = def.beats[beat].focus ?? [];

  const headerH = 74;
  const padY = 16;
  const n = s.lines.length;
  const maxChars = Math.max(...s.lines.map((l) => ("text" in l ? l.text.length : 0)), 40);
  const byHeight = (h - headerH - padY * 2) / n / 1.5;
  const byWidth = (w - 92) / (Math.min(maxChars, 84) * 0.6);
  const fs = Math.max(13, Math.min(23, byHeight, byWidth));
  const lh = fs * 1.5;

  const isFocused = (l: Line) => "text" in l && focus.some((f) => l.text.includes(f));
  const any = s.lines.some(isFocused);
  if (focus.length && !any) throw new Error(`${def.id} beat ${beat}: focus ${JSON.stringify(focus)} not in snippet ${id}`);
  const fp = fadeIn(tBeat, 12);
  const appear = fadeIn(tIn, 12);

  // When the snippet is taller than the card, scroll so the first focused line is visible.
  const bodyH = h - headerH - padY * 2;
  const firstFocus = s.lines.findIndex(isFocused);
  const overflow = Math.max(0, n * lh - bodyH);
  const target = firstFocus < 0 ? 0 : Math.min(overflow, Math.max(0, firstFocus * lh - bodyH * 0.3));

  return (
    <div
      style={{
        width: w, height: h, borderRadius: 18, background: "#0d1326", border: `1px solid ${C.line}`,
        boxShadow: "0 30px 80px rgba(0,0,0,0.45)", overflow: "hidden",
        opacity: appear, transform: `translateY(${interpolate(appear, [0, 1], [18, 0])}px)`,
      }}
    >
      <div style={{ height: headerH, padding: "12px 22px", borderBottom: `1px solid ${C.line}`, background: "#111a33", boxSizing: "border-box" }}>
        <div style={{ fontFamily: SANS, fontSize: 21, fontWeight: 700, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title}</div>
        <div style={{ fontFamily: MONO, fontSize: 16, color: C.dim, marginTop: 4 }}>
          {s.file}
          <span style={{ color: C.faint }}> · lines {s.first}–{s.last}</span>
        </div>
      </div>
      <div style={{ padding: `${padY}px 0`, height: h - headerH, boxSizing: "border-box", overflow: "hidden" }}>
        <div style={{ transform: `translateY(${-target * fp}px)` }}>
          {s.lines.map((l, i) => {
            if ("gap" in l)
              return (
                <div key={i} style={{ height: lh, lineHeight: `${lh}px`, fontFamily: MONO, fontSize: fs, color: C.faint, paddingLeft: 78 }}>⋯</div>
              );
            const on = isFocused(l);
            const op = !any ? 1 : on ? 1 : interpolate(fp, [0, 1], [1, 0.38]);
            return (
              <div
                key={i}
                style={{
                  display: "flex", height: lh, lineHeight: `${lh}px`, fontFamily: MONO, fontSize: fs, whiteSpace: "pre",
                  background: on ? `rgba(251,191,36,${0.14 * fp})` : "transparent",
                  boxShadow: on ? `inset 4px 0 0 rgba(251,191,36,${fp})` : "none",
                  opacity: op,
                }}
              >
                <span style={{ width: 66, textAlign: "right", paddingRight: 14, color: on ? C.accent : C.faint, flexShrink: 0 }}>{l.no}</span>
                <span style={{ color: C.text, overflow: "hidden", textOverflow: "ellipsis", paddingRight: 16 }} dangerouslySetInnerHTML={{ __html: l.html || " " }} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
