// Pipeline (steps that light up one after another) and Table (rows that appear on a beat).

import React from "react";
import { fadeIn, pop, useScene, useSince } from "../engine";
import { C, MONO, SANS } from "../theme";
import { Rich } from "./Rich";

export type Step = { at: number; label: string; sub?: string; indent?: number; color?: string };

export const Pipeline: React.FC<{ w: number; steps: Step[]; title?: string; color?: string; gap?: number; size?: number }> = ({ w, steps, title, color = C.accent, gap = 12, size = 1 }) => {
  const { beat } = useScene();
  return (
    <div style={{ width: w, fontFamily: SANS }}>
      {title && <div style={{ fontFamily: MONO, fontSize: 26 * size, color, fontWeight: 700, marginBottom: 18 }}>{title}</div>}
      {steps.map((s, i) => {
        const state = s.at > beat ? "todo" : s.at === beat ? "now" : "done";
        const col = s.color ?? color;
        return <StepRow key={i} s={s} state={state} col={col} gap={gap} size={size} />;
      })}
    </div>
  );
};

const StepRow: React.FC<{ s: Step; state: "todo" | "now" | "done"; col: string; gap: number; size: number }> = ({ s, state, col, gap, size }) => {
  const t = useSince(s.at);
  const p = state === "todo" ? 0 : pop(t);
  const dot = 26 * size;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", marginLeft: (s.indent ?? 0) * 44, marginBottom: gap, opacity: state === "todo" ? 0.33 : 1 }}>
      <div style={{ width: dot, height: dot, borderRadius: 99, marginTop: 4 * size, flexShrink: 0, border: `3px solid ${state === "todo" ? C.faint : col}`, background: state === "done" ? col : state === "now" ? `${col}44` : "transparent", boxShadow: state === "now" ? `0 0 ${18 * p}px ${col}` : "none", display: "flex", alignItems: "center", justifyContent: "center", color: C.bg, fontWeight: 900, fontSize: 16 * size }}>
        {state === "done" ? "✓" : ""}
      </div>
      <div style={{ marginLeft: 16, padding: state === "now" ? "4px 14px" : "4px 0", borderRadius: 10, background: state === "now" ? `${col}1c` : "transparent", border: state === "now" ? `1.5px solid ${col}88` : "1.5px solid transparent", transform: state === "now" ? `translateX(${6 * p}px)` : "none" }}>
        <div style={{ fontSize: 25 * size, fontWeight: 700, color: state === "now" ? "#fff" : C.text, lineHeight: 1.25 }}><Rich text={s.label} codeColor={col} /></div>
        {s.sub && <div style={{ fontSize: 19 * size, color: C.dim, marginTop: 3, lineHeight: 1.3 }}><Rich text={s.sub} codeColor={col} /></div>}
      </div>
    </div>
  );
};

export type Row = { at: number; cells: string[]; tone?: "ok" | "bad" | "warn" | "info" };

export const Table: React.FC<{ w: number; cols: { label: string; w: number }[]; rows: Row[]; size?: number }> = ({ w, cols, rows, size = 1 }) => {
  const { beat } = useScene();
  const total = cols.reduce((n, c) => n + c.w, 0);
  return (
    <div style={{ width: w, fontFamily: SANS }}>
      <div style={{ display: "flex", borderBottom: `2px solid ${C.line}`, paddingBottom: 10, marginBottom: 6 }}>
        {cols.map((c, i) => (
          <div key={i} style={{ width: (c.w / total) * w, fontSize: 18 * size, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: 1.2, paddingRight: 16 }}>{c.label}</div>
        ))}
      </div>
      {rows.map((r, i) => <TableRow key={i} r={r} cols={cols} total={total} w={w} cur={r.at === beat} visible={r.at <= beat} size={size} />)}
    </div>
  );
};

const TONE = { ok: C.ok, bad: C.bad, warn: C.warn, info: "#38bdf8" };

const TableRow: React.FC<{ r: Row; cols: { w: number }[]; total: number; w: number; cur: boolean; visible: boolean; size: number }> = ({ r, cols, total, w, cur, visible, size }) => {
  const t = useSince(r.at);
  if (!visible) return null;
  const tone = r.tone ? TONE[r.tone] : C.accent;
  return (
    <div style={{ display: "flex", padding: `${10 * size}px 0`, borderBottom: `1px solid ${C.line}`, opacity: fadeIn(t) * (cur ? 1 : 0.62), background: cur ? `${tone}12` : "transparent", transform: `translateY(${(1 - fadeIn(t)) * 14}px)`, boxShadow: cur ? `inset 4px 0 0 ${tone}` : "none" }}>
      {r.cells.map((c, i) => (
        <div key={i} style={{ width: (cols[i].w / total) * w, fontSize: (i === r.cells.length - 1 && r.tone ? 21 : 21) * size, paddingLeft: i === 0 ? 14 : 0, paddingRight: 16, lineHeight: 1.3, color: i === r.cells.length - 1 && r.tone ? tone : C.text, fontWeight: i === 0 || (i === r.cells.length - 1 && r.tone) ? 600 : 400 }}>
          <Rich text={c} />
        </div>
      ))}
    </div>
  );
};

/** A plain card with a title and bullet lines that appear on beats. */
export const Bullets: React.FC<{ w: number; items: { at: number; text: string; color?: string }[]; size?: number }> = ({ w, items, size = 1 }) => {
  const { beat } = useScene();
  return (
    <div style={{ width: w, fontFamily: SANS }}>
      {items.map((it, i) => <BulletRow key={i} it={it} cur={it.at === beat} visible={it.at <= beat} size={size} />)}
    </div>
  );
};

const BulletRow: React.FC<{ it: { at: number; text: string; color?: string }; cur: boolean; visible: boolean; size: number }> = ({ it, cur, visible, size }) => {
  const t = useSince(it.at);
  if (!visible) return null;
  const col = it.color ?? C.accent;
  return (
    <div style={{ display: "flex", gap: 16, marginBottom: 18 * size, opacity: fadeIn(t) * (cur ? 1 : 0.6), transform: `translateX(${(1 - fadeIn(t)) * -18}px)` }}>
      <div style={{ width: 12 * size, height: 12 * size, borderRadius: 3, background: col, marginTop: 12 * size, flexShrink: 0, transform: "rotate(45deg)" }} />
      <div style={{ fontSize: 27 * size, color: cur ? "#fff" : C.text, lineHeight: 1.38 }}><Rich text={it.text} codeColor={col} /></div>
    </div>
  );
};
