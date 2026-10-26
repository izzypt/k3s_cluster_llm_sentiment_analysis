// A diagram drawn in its own coordinate space (w × h) and scaled to fit: zones, nodes and
// chips that appear on a beat, arrows that draw themselves, and packets that travel along
// the arrows listed in the beat's `flow`. Blocked arrows show a packet bouncing off a ✕.

import React from "react";
import { interpolate } from "remotion";
import { fadeIn, pop, useScene, useSince } from "../engine";
import { C, MONO, SANS, ZONE, Zone } from "../theme";
import { Rich } from "./Rich";

export type BoxDef = {
  id: string;
  x: number; y: number; w: number; h: number;
  label: string;
  sub?: string;
  kind?: "zone" | "node" | "chip" | "note" | "stack";
  zone?: Zone;
  color?: string;
  at?: number;
  until?: number;
  /** text size multiplier */
  size?: number;
  align?: "center" | "left";
};

export type ArrowDef = {
  id: string;
  from: string | [number, number];
  to: string | [number, number];
  label?: string;
  color?: string;
  zone?: Zone;
  at?: number;
  until?: number;
  dashed?: boolean;
  blocked?: boolean;
  /** perpendicular offset of the curve's control point (px) */
  curve?: number;
  /** where along the arrow the label sits (0..1) */
  labelAt?: number;
  /** shift the label (px) */
  labelDy?: number;
  /** shift both endpoints sideways (px), for parallel arrows */
  shift?: number;
  both?: boolean;
};

const colorOf = (b: { color?: string; zone?: Zone }, fallback: string = C.dim) => b.color ?? (b.zone ? ZONE[b.zone] : fallback);

function anchor(r: BoxDef, toward: [number, number]): [number, number] {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const dx = toward[0] - cx, dy = toward[1] - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const sx = (r.w / 2 + 6) / Math.abs(dx || 1e-9), sy = (r.h / 2 + 6) / Math.abs(dy || 1e-9);
  const s = Math.min(sx, sy);
  return [cx + dx * s, cy + dy * s];
}

function geometry(a: ArrowDef, boxes: Map<string, BoxDef>) {
  const center = (e: string | [number, number]): [number, number] => {
    if (typeof e !== "string") return e;
    const b = boxes.get(e);
    if (!b) throw new Error(`arrow ${a.id}: unknown box ${e}`);
    return [b.x + b.w / 2, b.y + b.h / 2];
  };
  const c1 = center(a.from), c2 = center(a.to);
  let p1 = typeof a.from === "string" ? anchor(boxes.get(a.from)!, c2) : c1;
  let p2 = typeof a.to === "string" ? anchor(boxes.get(a.to)!, c1) : c2;
  const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1;
  const nx = -(p2[1] - p1[1]) / len, ny = (p2[0] - p1[0]) / len;
  if (a.shift) {
    p1 = [p1[0] + nx * a.shift, p1[1] + ny * a.shift];
    p2 = [p2[0] + nx * a.shift, p2[1] + ny * a.shift];
  }
  const mid: [number, number] = [(p1[0] + p2[0]) / 2 + nx * (a.curve ?? 0), (p1[1] + p2[1]) / 2 + ny * (a.curve ?? 0)];
  const at = (t: number): [number, number] => [
    (1 - t) ** 2 * p1[0] + 2 * (1 - t) * t * mid[0] + t ** 2 * p2[0],
    (1 - t) ** 2 * p1[1] + 2 * (1 - t) * t * mid[1] + t ** 2 * p2[1],
  ];
  const tangent = (t: number): [number, number] => [
    2 * (1 - t) * (mid[0] - p1[0]) + 2 * t * (p2[0] - mid[0]),
    2 * (1 - t) * (mid[1] - p1[1]) + 2 * t * (p2[1] - mid[1]),
  ];
  return { p1, p2, mid, at, tangent, d: `M ${p1[0]} ${p1[1]} Q ${mid[0]} ${mid[1]} ${p2[0]} ${p2[1]}` };
}

const Head: React.FC<{ p: [number, number]; dir: [number, number]; color: string; op: number }> = ({ p, dir, color, op }) => {
  const a = Math.atan2(dir[1], dir[0]);
  const s = 15;
  const pts = [
    [p[0], p[1]],
    [p[0] - s * Math.cos(a - 0.42), p[1] - s * Math.sin(a - 0.42)],
    [p[0] - s * Math.cos(a + 0.42), p[1] - s * Math.sin(a + 0.42)],
  ];
  return <polygon points={pts.map((q) => q.join(",")).join(" ")} fill={color} opacity={op} />;
};

const BoxView: React.FC<{ b: BoxDef; hl: boolean; dimmed: boolean; part?: "frame" | "tab" }> = ({ b, hl, dimmed, part = "frame" }) => {
  const t = useSince(b.at ?? 0);
  const { beat } = useScene();
  const tOut = useSince(b.until ?? 9999);
  if (t < 0) return null;
  const gone = b.until !== undefined && beat >= b.until;
  if (gone && tOut > 12) return null;
  const p = pop(t);
  const op = Math.min(1, fadeIn(t)) * (gone ? 1 - fadeIn(tOut, 12) : 1) * (dimmed ? 0.45 : 1);
  const col = colorOf(b);
  const k = b.size ?? 1;
  const base: React.CSSProperties = {
    position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, boxSizing: "border-box", opacity: op,
    fontFamily: SANS, color: C.text,
  };
  if (b.kind === "zone" && part === "tab") {
    return (
      <div style={{ ...base, border: "none" }}>
        <div style={{ position: "absolute", left: 18, top: -17, padding: "3px 14px", background: C.bg, borderRadius: 8, border: `2px solid ${col}`, color: col, fontWeight: 700, fontSize: 21 * k, fontFamily: MONO, whiteSpace: "nowrap" }}>
          {b.label}
        </div>
      </div>
    );
  }
  if (b.kind === "zone") {
    return (
      <div style={{ ...base, borderRadius: 22, border: `${hl ? 3 : 2}px dashed ${hl ? col : col + "aa"}`, background: `${col}${hl ? "1f" : "0d"}`, boxShadow: hl ? `0 0 40px ${col}44` : "none" }}>
        {b.sub && <div style={{ position: "absolute", right: 16, bottom: 10, color: `${col}cc`, fontSize: 18 * k, fontWeight: 500 }}><Rich text={b.sub} /></div>}
      </div>
    );
  }
  if (b.kind === "note") {
    return (
      <div style={{ ...base, color: colorOf(b, C.dim), fontSize: 22 * k, lineHeight: 1.35, textAlign: b.align ?? "left", display: "flex", alignItems: "center", justifyContent: b.align === "center" ? "center" : "flex-start" }}>
        <div><Rich text={b.label} /></div>
      </div>
    );
  }
  const chip = b.kind === "chip";
  const stack = b.kind === "stack" ? `10px -10px 0 -2px ${C.panel}, 10px -10px 0 0 ${col}77, ` : "";
  const glow = stack + (hl ? `0 0 0 3px ${col}, 0 0 38px ${col}88` : "0 10px 30px rgba(0,0,0,0.35)");
  return (
    <div
      style={{
        ...base, transform: `scale(${0.9 + 0.1 * p})`, borderRadius: chip ? 999 : 16,
        background: hl ? `linear-gradient(180deg, ${col}38, ${col}18)` : `linear-gradient(180deg, ${C.panel2}, ${C.panel})`,
        border: `2px solid ${hl ? col : col + "88"}`, boxShadow: glow,
        display: "flex", flexDirection: "column", alignItems: b.align === "left" ? "flex-start" : "center", justifyContent: "center",
        padding: chip ? "0 16px" : "6px 14px", textAlign: b.align ?? "center",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: (chip ? 19 : 24) * k, lineHeight: 1.15, color: hl ? "#fff" : C.text }}><Rich text={b.label} /></div>
      {b.sub && <div style={{ fontFamily: MONO, fontSize: (chip ? 14 : 16) * k, color: hl ? col : C.dim, marginTop: 5, lineHeight: 1.3, whiteSpace: "pre-line" }}><Rich text={b.sub} codeColor={col} /></div>}
    </div>
  );
};

const ArrowView: React.FC<{ a: ArrowDef; boxes: Map<string, BoxDef>; flowing: boolean; dimmed: boolean; layer: "line" | "label" }> = ({ a, boxes, flowing, dimmed, layer }) => {
  const t = useSince(a.at ?? 0);
  const { beat, frame } = useScene();
  const tOut = useSince(a.until ?? 9999);
  if (t < 0) return null;
  const gone = a.until !== undefined && beat >= a.until;
  if (gone && tOut > 12) return null;
  const g = geometry(a, boxes);
  const col = a.blocked ? C.bad : colorOf(a, C.dim);
  const draw = interpolate(t, [0, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const op = (gone ? 1 - fadeIn(tOut, 12) : 1) * (dimmed && !flowing ? 0.4 : 1);
  const width = flowing ? 4 : 2.6;
  const labelPos = g.at(a.labelAt ?? 0.5);

  const packets: React.ReactNode[] = [];
  if (flowing) {
    const period = a.blocked ? 50 : 42;
    for (let k = 0; k < (a.blocked ? 1 : 2); k++) {
      const ph = ((frame + k * (period / 2)) % period) / period;
      if (a.blocked) {
        const tt = Math.min(ph * 1.6, 0.5);
        const [x, y] = g.at(tt);
        const fade = ph > 0.31 ? interpolate(ph, [0.31, 0.6], [1, 0], { extrapolateRight: "clamp" }) : 1;
        packets.push(<circle key={k} cx={x} cy={y} r={9} fill={C.bad} opacity={fade} />);
      } else {
        const [x, y] = g.at(ph);
        packets.push(<circle key={k} cx={x} cy={y} r={8} fill="#fff" stroke={col} strokeWidth={4} />);
        if (a.both) {
          const [x2, y2] = g.at(1 - ph);
          packets.push(<circle key={`b${k}`} cx={x2} cy={y2} r={6} fill={col} />);
        }
      }
    }
  }
  const cross = g.at(0.5);
  if (layer === "label") {
    if (!a.label || draw <= 0.6) return null;
    return (
      <g opacity={op}>
        <foreignObject x={labelPos[0] - 200} y={labelPos[1] - 22 + (a.labelDy ?? 0) + (a.blocked ? 38 : 0)} width={400} height={44} style={{ overflow: "visible" }}>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div style={{
              fontFamily: MONO, fontSize: 16, color: flowing ? "#fff" : col, background: C.bg, border: `1.5px solid ${col}${flowing ? "" : "88"}`,
              borderRadius: 8, padding: "3px 9px", whiteSpace: "nowrap", opacity: fadeIn(t - 10),
            }}>
              <Rich text={a.label} codeColor={col} />
            </div>
          </div>
        </foreignObject>
      </g>
    );
  }
  return (
    <g opacity={op}>
      <path d={g.d} fill="none" stroke={col} strokeWidth={width} pathLength={1}
        strokeDasharray={a.dashed || a.blocked ? undefined : "1"} strokeDashoffset={a.dashed || a.blocked ? undefined : 1 - draw}
        style={a.dashed || a.blocked ? { strokeDasharray: "10 9", opacity: draw } : undefined}
        strokeLinecap="round" />
      {!a.blocked && draw > 0.95 && <Head p={g.p2} dir={g.tangent(1)} color={col} op={1} />}
      {!a.blocked && a.both && draw > 0.95 && <Head p={g.p1} dir={[-g.tangent(0)[0], -g.tangent(0)[1]]} color={col} op={1} />}
      {a.blocked && draw > 0.5 && (
        <g transform={`translate(${cross[0]},${cross[1]})`}>
          <circle r={20} fill={C.bg} stroke={C.bad} strokeWidth={3} />
          <path d="M -8 -8 L 8 8 M 8 -8 L -8 8" stroke={C.bad} strokeWidth={4} strokeLinecap="round" />
        </g>
      )}
      {packets}
    </g>
  );
};

export const Board: React.FC<{
  w: number; h: number; boxes: BoxDef[]; arrows?: ArrowDef[];
  /** fit inside this many px (keeps aspect ratio) */
  fitW: number; fitH: number;
  /** dim everything not highlighted when the beat has `hl` */
  dimOthers?: boolean;
  children?: React.ReactNode;
}> = ({ w, h, boxes, arrows = [], fitW, fitH, dimOthers = true, children }) => {
  const { def, beat } = useScene();
  const hl = new Set(def.beats[beat].hl ?? []);
  const flow = new Set(def.beats[beat].flow ?? []);
  const map = new Map(boxes.map((b) => [b.id, b]));
  for (const f of [...hl]) if (!map.has(f)) throw new Error(`${def.id}: hl ${f} is not a box`);
  for (const f of [...flow]) if (!arrows.some((a) => a.id === f)) throw new Error(`${def.id}: flow ${f} is not an arrow`);
  const scale = Math.min(fitW / w, fitH / h);
  const dimming = dimOthers && (hl.size > 0 || flow.size > 0);
  const zones = boxes.filter((b) => b.kind === "zone");
  const rest = boxes.filter((b) => b.kind !== "zone");
  const inside = (b: BoxDef, z: BoxDef) => b.x >= z.x && b.y >= z.y && b.x + b.w <= z.x + z.w && b.y + b.h <= z.y + z.h;
  const involved = (b: BoxDef) =>
    hl.has(b.id) ||
    zones.some((z) => hl.has(z.id) && inside(b, z)) ||
    arrows.some((a) => flow.has(a.id) && (a.from === b.id || a.to === b.id));
  return (
    <div style={{ width: w * scale, height: h * scale, position: "relative" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
        {zones.map((b) => <BoxView key={b.id} b={b} hl={hl.has(b.id)} dimmed={false} />)}
        <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          {arrows.map((a) => (
            <ArrowView key={a.id} a={a} boxes={map} flowing={flow.has(a.id)} dimmed={dimming} layer="line" />
          ))}
        </svg>
        {zones.map((b) => <BoxView key={`${b.id}-tab`} b={b} hl={hl.has(b.id)} dimmed={false} part="tab" />)}
        {rest.map((b) => (
          <BoxView key={b.id} b={b} hl={hl.has(b.id)} dimmed={dimming && b.kind !== "note" && !involved(b)} />
        ))}
        <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
          {arrows.map((a) => (
            <ArrowView key={a.id} a={a} boxes={map} flowing={flow.has(a.id)} dimmed={dimming} layer="label" />
          ))}
        </svg>
        {children}
      </div>
    </div>
  );
};
