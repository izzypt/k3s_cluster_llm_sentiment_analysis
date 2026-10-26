// A sequence diagram: one lifeline per participant, messages appear on their beat.
// The messages of the current beat are bright and draw in one after another.

import React from "react";
import { interpolate } from "remotion";
import { fadeIn, useScene } from "../engine";
import { C, MONO, SANS, ZONE, Zone } from "../theme";
import { Rich } from "./Rich";

export type Participant = { id: string; label: string; sub?: string; zone: Zone };
export type Msg = {
  at: number;
  from: string;
  to?: string;
  label: string;
  /** dashed return arrow */
  ret?: boolean;
  /** a note on the lifeline instead of an arrow */
  note?: boolean;
  /** blocked/failed call */
  bad?: boolean;
};

export const Sequence: React.FC<{ w: number; h: number; parts: Participant[]; msgs: Msg[]; rowH?: number }> = ({ w, h, parts, msgs, rowH }) => {
  const { beat, frame, starts } = useScene();
  const colW = w / parts.length;
  const xOf = (id: string) => {
    const i = parts.findIndex((p) => p.id === id);
    if (i < 0) throw new Error(`sequence: unknown participant ${id}`);
    return colW * i + colW / 2;
  };
  const top = 104;
  const row = rowH ?? Math.min(66, (h - top - 20) / msgs.length);
  const current = msgs.filter((m) => m.at === beat);
  const involved = new Set(current.flatMap((m) => [m.from, m.to ?? m.from]));
  const order = new Map<Msg, number>();
  for (const m of msgs) order.set(m, msgs.filter((x) => x.at === m.at).indexOf(m));

  return (
    <div style={{ width: w, height: h, position: "relative", fontFamily: SANS }}>
      {parts.map((p) => {
        const x = xOf(p.id);
        const col = ZONE[p.zone];
        const on = involved.has(p.id);
        return (
          <React.Fragment key={p.id}>
            <div style={{ position: "absolute", left: x - 1.5, top: 84, width: 3, height: h - 84, background: `linear-gradient(${col}66, ${col}11)` }} />
            <div
              style={{
                position: "absolute", left: x - colW / 2 + 6, top: 0, width: colW - 12, height: 80, borderRadius: 14, boxSizing: "border-box",
                border: `2px solid ${on ? col : col + "77"}`, background: on ? `${col}2a` : C.panel,
                boxShadow: on ? `0 0 28px ${col}66` : "none", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 21, color: C.text, textAlign: "center", lineHeight: 1.1 }}>{p.label}</div>
              {p.sub && <div style={{ fontFamily: MONO, fontSize: 14, color: col, marginTop: 4 }}>{p.sub}</div>}
            </div>
          </React.Fragment>
        );
      })}
      <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        {msgs.map((m, i) => {
          if (m.at > beat) return null;
          const t = frame - starts[m.at] - order.get(m)! * 16;
          if (t < 0) return null;
          const y = top + i * row + row / 2;
          const x1 = xOf(m.from);
          const x2 = xOf(m.to ?? m.from);
          const cur = m.at === beat;
          const col = m.bad ? C.bad : cur ? C.accent : C.dim;
          const op = cur ? 1 : 0.5;
          const p = interpolate(t, [0, 14], [0, 1], { extrapolateRight: "clamp" });
          if (m.note || x1 === x2) {
            const self = !m.note;
            return (
              <g key={i} opacity={op * fadeIn(t)}>
                {self && <path d={`M ${x1} ${y - 12} h 46 v 24 h -40`} stroke={col} strokeWidth={2.5} fill="none" />}
                {self && <polygon points={`${x1 + 4},${y + 12} ${x1 + 15},${y + 6} ${x1 + 15},${y + 18}`} fill={col} />}
                <foreignObject x={x1 + (self ? 58 : -colW * 0.45)} y={y - 18} width={w} height={40} style={{ overflow: "visible" }}>
                  <div style={{ display: "inline-block", fontFamily: MONO, fontSize: 17, color: cur ? "#fff" : C.dim, background: m.note ? `${C.panel2}` : C.bg, border: m.note ? `1.5px solid ${col}` : "none", borderRadius: 8, padding: m.note ? "4px 10px" : 0, whiteSpace: "nowrap" }}>
                    <Rich text={m.label} codeColor={cur ? C.accent : C.dim} />
                  </div>
                </foreignObject>
              </g>
            );
          }
          const dir = Math.sign(x2 - x1);
          const xe = x1 + (x2 - x1) * p;
          const lx = Math.min(x1, x2);
          return (
            <g key={i} opacity={op}>
              <line x1={x1} y1={y} x2={xe} y2={y} stroke={col} strokeWidth={cur ? 3.5 : 2.5} strokeDasharray={m.ret ? "9 7" : undefined} />
              {p > 0.98 && !m.bad && <polygon points={`${x2},${y} ${x2 - dir * 15},${y - 8} ${x2 - dir * 15},${y + 8}`} fill={col} />}
              {p > 0.98 && m.bad && <path d={`M ${x2 - dir * 22 - 8} ${y - 8} l 16 16 M ${x2 - dir * 22 + 8} ${y - 8} l -16 16`} stroke={C.bad} strokeWidth={4} />}
              <foreignObject x={lx} y={y - 36} width={Math.abs(x2 - x1)} height={34} style={{ overflow: "visible" }}>
                <div style={{ display: "flex", justifyContent: "center", opacity: fadeIn(t - 6) }}>
                  <div style={{ fontFamily: MONO, fontSize: 17, color: cur ? "#fff" : C.dim, whiteSpace: "nowrap", background: C.bg, padding: "1px 8px", borderRadius: 6 }}>
                    <Rich text={m.label} codeColor={cur ? C.accent : C.dim} />
                  </div>
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
