// Building blocks for the posters: code snippets pulled from the real source files,
// syntax highlighting, and small HTML components that share one visual language.
//
// Snippets are located by *anchor text*, never by hard-coded line numbers, and the build
// fails if an anchor disappears: a poster can't silently drift away from the code.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import hljs from "highlight.js";
export { hljs };

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../../..");
export const PROJECT = path.join(REPO, "skypulse");

const LANG_BY_EXT = {
  ".py": "python", ".yaml": "yaml", ".yml": "yaml", ".toml": "ini", ".sh": "bash",
  ".html": "xml", ".json": "json", ".env": "bash", ".md": "markdown",
};

function langFor(rel) {
  const base = path.basename(rel);
  if (base === "Makefile") return "makefile";
  if (base.endsWith("Dockerfile")) return "dockerfile";
  return LANG_BY_EXT[path.extname(rel)] ?? "plaintext";
}

const fileCache = new Map();
function readLines(rel) {
  if (!fileCache.has(rel)) {
    fileCache.set(rel, fs.readFileSync(path.join(PROJECT, rel), "utf8").split("\n"));
  }
  return fileCache.get(rel);
}

function findLine(rel, lines, anchor, from = 0) {
  for (let i = from; i < lines.length; i++) if (lines[i].includes(anchor)) return i;
  throw new Error(`${rel}: anchor not found after line ${from + 1}: ${JSON.stringify(anchor)}`);
}

/**
 * Extract a snippet.
 *   parts: [{ at: "anchor", n: 5 }, { at: "anchor", to: "end anchor" }, ...]
 *          Parts are searched in order; a gap between them is shown as "⋯".
 *   marks: { "text on a line": "A" } -> a lettered badge on the first selected line containing it
 *   lang:  override the highlighter language (e.g. "javascript" for the <script> in index.html)
 */
export function snip(rel, parts, { marks = {}, lang, title } = {}) {
  const lines = readLines(rel);
  const picked = []; // {no, text} | {gap: true}
  let cursor = 0;
  for (const part of parts) {
    const start = findLine(rel, lines, part.at, cursor);
    let end;
    if (part.to) end = findLine(rel, lines, part.to, start + (part.toSame ? 0 : 1));
    else end = start + (part.n ?? 1) - 1;
    if (end >= lines.length) throw new Error(`${rel}: snippet runs past the end of the file`);
    if (picked.length && start !== cursor) picked.push({ gap: true });
    for (let i = start; i <= end; i++) picked.push({ no: i + 1, text: lines[i] });
    cursor = end + 1;
  }
  // Remove the indentation common to every selected line.
  const indents = picked.filter((l) => !l.gap && l.text.trim()).map((l) => l.text.match(/^ */)[0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  for (const l of picked) if (!l.gap) l.text = l.text.slice(cut);

  const badges = {};
  for (const [needle, label] of Object.entries(marks)) {
    const idx = picked.findIndex((l) => !l.gap && l.text.includes(needle));
    if (idx < 0) throw new Error(`${rel}: mark ${JSON.stringify(needle)} not inside the snippet`);
    badges[idx] = label;
  }
  const nums = picked.filter((l) => !l.gap).map((l) => l.no);
  return { rel, lines: picked, badges, lang: lang ?? langFor(rel), title, first: nums[0], last: nums.at(-1) };
}

/** A Chromium for puppeteer: CHROME_PATH, or the usual install locations. */
export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error("No Chromium found: set CHROME_PATH");
  return found;
}

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Render a snippet as a code card: file path + line range header, line numbers, badges. */
export function code(s, { note = "", wide = false } = {}) {
  const text = s.lines.map((l) => (l.gap ? "⋯" : l.text)).join("\n");
  const html = hljs.highlight(text, { language: s.lang, ignoreIllegals: true }).value;
  const gutter = s.lines
    .map((l, i) => {
      const badge = s.badges[i] ? `<b class="badge">${s.badges[i]}</b>` : "";
      return `<span>${badge}${l.gap ? "&nbsp;" : l.no}</span>`;
    })
    .join("");
  const marks = Object.keys(s.badges)
    .map((i) => `<i class="hl" style="top:calc(${i} * var(--lh) + 10px)"></i>`)
    .join("");
  const range = s.first === s.last ? `L${s.first}` : `L${s.first}–${s.last}`;
  return `<figure class="code${wide ? " wide" : ""}">
  <figcaption><span class="path">${esc(s.rel)}</span><span class="range">${range}</span>${s.title ? `<span class="ctitle">${esc(s.title)}</span>` : ""}</figcaption>
  <div class="codebody">${marks}<pre class="gutter">${gutter}</pre><pre class="src hljs">${html}</pre></div>
  ${note ? `<p class="note">${note}</p>` : ""}
</figure>`;
}

/** Small inline badge matching the letters placed on code lines. */
export const b = (label) => `<b class="badge inline">${label}</b>`;

/** One step of a timeline: number + explanation on the left, code (or anything) on the right. */
export function stepRow({ n, zone = "plat", title, text = "", right = "", leftWidth = 560 }) {
  return `<div class="srow" style="grid-template-columns:${leftWidth}px 1fr">
  <div class="step"><div class="n z-${zone}">${n}</div><div><h3>${title}</h3>${text}</div></div>
  <div class="col">${right}</div>
</div>`;
}

export const timeline = (rows) => `<div class="timeline">${rows.join("\n")}</div>`;

/**
 * Sequence diagram with code: lanes (actors) on the left, explanation + code per step on the right.
 *   lanes: [{ id, name, sub, zone }]
 *   rows:  [{ n, zone, title, text, right, items }]
 *          items, drawn top to bottom: { from, to, label, reply } = a call (reply: dashed),
 *                                      { lane, note } = work done inside that process.
 */
export function sequence({ lanes, rows, laneWidth = 128 }) {
  const W = lanes.length * laneWidth;
  const idx = Object.fromEntries(lanes.map((l, i) => [l.id, i]));
  const zoneOf = Object.fromEntries(lanes.map((l) => [l.id, l.zone]));
  const cx = (id) => {
    if (!(id in idx)) throw new Error(`unknown lane ${id}`);
    return idx[id] * laneWidth + laneWidth / 2;
  };
  const lifelines = `background-image:repeating-linear-gradient(to right, transparent 0 ${laneWidth / 2 - 1}px, #bfc4cd ${laneWidth / 2 - 1}px ${laneWidth / 2 + 1}px, transparent ${laneWidth / 2 + 1}px ${laneWidth}px);`;
  const head = `<div class="seqrow seqhead"><div class="lanes" style="width:${W}px">${lanes
    .map((l) => `<div class="lane box z-${l.zone}" style="left:${idx[l.id] * laneWidth + 4}px;width:${laneWidth - 8}px"><b>${l.name}</b>${l.sub ? `<span>${l.sub}</span>` : ""}</div>`)
    .join("")}</div><div></div></div>`;
  const body = rows
    .map((r) => {
      let y = 34;
      const items = [];
      for (const it of r.items ?? []) {
        if (it.note) {
          const x = cx(it.lane);
          items.push(`<div class="act z-${zoneOf[it.lane]}" style="left:${x - 78}px;top:${y - 8}px">${it.note}</div>`);
          y += 26 + 16 * Math.max(0, Math.ceil(it.note.replace(/<[^>]+>/g, "").length / 22) - 1) + 22;
        } else {
          const a = cx(it.from), z = cx(it.to);
          const left = Math.min(a, z), width = Math.abs(z - a);
          const dir = z > a ? "r" : "l";
          const labelW = Math.max(width, 230);
          items.push(`<div class="msg ${dir}${it.reply ? " reply" : ""}" style="left:${left}px;width:${width}px;top:${y + 22}px;--c:var(--${zoneOf[it.from]})">
            <span style="width:${labelW}px;left:${(width - labelW) / 2}px"><em>${it.label}</em></span></div>`);
          y += 22 + 16 * Math.max(0, Math.ceil(it.label.replace(/<[^>]+>/g, "").length / 32) - 1) + 34;
        }
      }
      return `<div class="seqrow"><div class="lanes" style="width:${W}px;min-height:${y + 10}px;${lifelines}">
        <div class="seqn z-${r.zone}">${r.n}</div>${items.join("")}</div>
        <div class="col"><h3>${r.title}</h3>${r.text ?? ""}${r.right ?? ""}</div></div>`;
    })
    .join("");
  return `<div class="seq">${head}${body}</div>`;
}

/** A horizontal chain of boxes joined by arrows: [{ zone, title, sub }], labels between them optional. */
export function flow(items, { labels = [], minWidth = 0 } = {}) {
  return `<div class="flow">${items
    .map((it, i) => {
      const box = `<div class="box z-${it.zone ?? "plat"} fbox" style="min-width:${minWidth}px"><b>${it.title}</b>${it.sub ? `<span>${it.sub}</span>` : ""}</div>`;
      return i === 0 ? box : `<div class="right"><span>${labels[i - 1] ?? ""}</span><i></i></div>${box}`;
    })
    .join("")}</div>`;
}

/** A full poster page. `num` is the poster number shown in the corner. */
export function page({ num, title, subtitle, body, width = 1800 }) {
  const mermaid = body.includes('class="mermaid"')
    ? `<script src="file://${path.join(HERE, "node_modules/mermaid/dist/mermaid.min.js")}"></script>
<script>mermaid.initialize({ startOnLoad: false, theme: "default", flowchart: { useMaxWidth: false, wrappingWidth: 320, padding: 12 }, fontFamily: "DejaVu Sans, sans-serif" });
window.addEventListener("load", () => mermaid.run().then(() => { document.body.dataset.ready = "1"; }));</script>`
    : `<script>document.body && (document.body.dataset.ready = "1");</script>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title.replace(/<[^>]+>/g, ""))}</title>
<style>${CSS}</style></head>
<body><main id="poster" style="width:${width}px">
  <header class="top">
    <div class="num">${num}</div>
    <div><h1>${title}</h1><p class="sub">${subtitle}</p></div>
    <div class="brand">SkyPulse · how it works</div>
  </header>
  ${body}
</main>${mermaid}</body></html>`;
}

const CSS = `
:root {
  --ink:#1d2230; --muted:#5d6577; --faint:#8a91a1; --bg:#f6f5f1; --card:#ffffff; --line:#dcdee4;
  --lh: 18.5px;
  --ext:#5b6b82;      --ext-bg:#eef1f5;
  --plat:#4b5563;     --plat-bg:#eceef1;
  --ana:#1f63d6;      --ana-bg:#e7effc;
  --ing:#c56a00;      --ing-bg:#fcf1e1;
  --data:#08875f;     --data-bg:#e3f4ec;
  --mon:#7a3fe0;      --mon-bg:#f0eafc;
  --llm:#0e7f99;      --llm-bg:#e1f3f7;
  --build:#a1366b;    --build-bg:#f9e9f1;
}
* { box-sizing:border-box; }
html,body { margin:0; background:var(--bg); }
body { font-family:Inter, "DejaVu Sans", sans-serif; color:var(--ink); font-size:15px; line-height:1.45; }
#poster { padding:36px 40px 44px; background:var(--bg); }
h1 { font-size:34px; margin:0; letter-spacing:-0.02em; }
h2 { font-size:21px; margin:0 0 10px; letter-spacing:-0.01em; }
h3 { font-size:16px; margin:0 0 6px; }
p { margin:0 0 8px; }
code, .mono { font-family:"DejaVu Sans Mono", monospace; font-size:0.86em; }
:not(pre) > code { background:rgba(29,34,48,.07); padding:1px 5px; border-radius:4px; }
.top { display:flex; gap:22px; align-items:center; margin-bottom:26px; padding-bottom:20px; border-bottom:2px solid var(--ink); }
.top .num { font-size:44px; font-weight:800; width:72px; height:72px; border-radius:16px; background:var(--ink); color:#fff; display:grid; place-items:center; flex:none; }
.top .sub { color:var(--muted); font-size:17px; margin:4px 0 0; max-width:1250px; }
.top .brand { margin-left:auto; color:var(--faint); font-weight:600; font-size:13px; text-transform:uppercase; letter-spacing:.08em; align-self:flex-start; }
.muted { color:var(--muted); }
.small { font-size:13px; }

/* code cards */
figure.code { margin:0; background:#1b1f2a; border-radius:10px; overflow:hidden; box-shadow:0 1px 2px rgba(0,0,0,.08); min-width:0; }
figure.code figcaption { display:flex; gap:10px; align-items:baseline; padding:7px 12px; background:#272c3a; color:#c9d1e0; font-family:"DejaVu Sans Mono", monospace; font-size:12px; }
figure.code .path { color:#fff; font-weight:600; }
figure.code .range { color:#8f9ab0; }
figure.code .ctitle { margin-left:auto; color:#ffd479; font-family:Inter, sans-serif; font-weight:600; font-size:12.5px; }
.codebody { position:relative; display:flex; padding:10px 0; }
.codebody pre { margin:0; font-family:"DejaVu Sans Mono", monospace; font-size:12.4px; line-height:var(--lh); white-space:pre; }
pre.gutter { color:#5f6a80; text-align:right; padding:0 10px 0 8px; min-width:52px; user-select:none; position:relative; z-index:1; }
pre.gutter span { display:block; position:relative; }
pre.src { color:#e6edf3; padding-right:14px; overflow:hidden; position:relative; z-index:1; }
.hl { position:absolute; left:0; right:0; height:var(--lh); background:rgba(255,212,121,.13); border-left:3px solid #ffd479; z-index:0; }
.badge { display:inline-grid; place-items:center; min-width:18px; height:18px; padding:0 4px; border-radius:9px; background:#ffd479; color:#1b1f2a; font:700 11px/1 Inter, sans-serif; position:absolute; left:-2px; top:0; }
.badge.inline { position:static; vertical-align:1px; margin:0 2px; }
p.note { color:#c9d1e0; font-size:13px; padding:0 14px 10px; margin:0; }
.hljs-keyword, .hljs-selector-tag, .hljs-meta .hljs-keyword { color:#ff7b72; }
.hljs-string, .hljs-meta .hljs-string { color:#a5d6ff; }
.hljs-comment, .hljs-quote { color:#8b96a8; font-style:italic; }
.hljs-number, .hljs-literal { color:#79c0ff; }
.hljs-title, .hljs-title.function_, .hljs-section { color:#d2a8ff; }
.hljs-built_in, .hljs-type, .hljs-variable, .hljs-template-variable { color:#ffa657; }
.hljs-attr, .hljs-attribute, .hljs-name, .hljs-selector-class { color:#7ee787; }
.hljs-meta { color:#8b96a8; }
.hljs-params { color:#e6edf3; }
.hljs-bullet, .hljs-symbol { color:#ffa657; }
.hljs-subst { color:#e6edf3; }

/* layout helpers */
.row { display:flex; gap:22px; align-items:flex-start; }
.col { display:flex; flex-direction:column; gap:14px; min-width:0; }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:22px; align-items:start; }
.grid3 { display:grid; grid-template-columns:repeat(3, 1fr); gap:22px; align-items:start; }
.grow { flex:1; }
.section { margin-top:30px; }
.section > h2 { display:flex; align-items:center; gap:10px; }
.section > h2 .pill { font-size:12px; }

/* boxes */
.box { background:var(--card); border:1.5px solid var(--line); border-radius:12px; padding:14px 16px; }
.box.z-ext { border-color:var(--ext); background:var(--ext-bg); }
.box.z-plat { border-color:var(--plat); background:var(--plat-bg); }
.box.z-ana { border-color:var(--ana); background:var(--ana-bg); }
.box.z-ing { border-color:var(--ing); background:var(--ing-bg); }
.box.z-data { border-color:var(--data); background:var(--data-bg); }
.box.z-mon { border-color:var(--mon); background:var(--mon-bg); }
.box.z-llm { border-color:var(--llm); background:var(--llm-bg); }
.box.z-build { border-color:var(--build); background:var(--build-bg); }
.box h3 { display:flex; gap:8px; align-items:center; }
.pill { display:inline-block; padding:2px 9px; border-radius:20px; font-size:12px; font-weight:700; color:#fff; white-space:nowrap; }
.pill.z-ext { background:var(--ext); } .pill.z-plat { background:var(--plat); } .pill.z-ana { background:var(--ana); }
.pill.z-ing { background:var(--ing); } .pill.z-data { background:var(--data); } .pill.z-mon { background:var(--mon); }
.pill.z-llm { background:var(--llm); } .pill.z-build { background:var(--build); }
.pill.out { background:transparent; color:var(--ink); border:1.5px solid var(--line); }

/* numbered steps */
.step { display:grid; grid-template-columns:44px 1fr; gap:14px; align-items:start; }
.step > .n { width:38px; height:38px; border-radius:50%; background:var(--ink); color:#fff; display:grid; place-items:center; font-weight:800; font-size:17px; }
.step > .n.z-ana { background:var(--ana); } .step > .n.z-ing { background:var(--ing); } .step > .n.z-data { background:var(--data); }
.step > .n.z-mon { background:var(--mon); } .step > .n.z-plat { background:var(--plat); } .step > .n.z-build { background:var(--build); }
.step > .n.z-llm { background:var(--llm); } .step > .n.z-ext { background:var(--ext); }

/* arrows between stacked or side-by-side blocks */
.down { display:flex; align-items:center; gap:10px; color:var(--muted); font-size:13px; font-weight:600; padding-left:18px; height:34px; }
.down::before { content:""; width:2px; height:100%; background:var(--ink); margin-right:2px; }
.down::after { content:""; position:relative; left:-15px; top:12px; border:6px solid transparent; border-top:8px solid var(--ink); order:-1; margin-right:-12px; }
.right { display:flex; flex-direction:column; justify-content:center; align-items:center; color:var(--muted); font-size:12.5px; font-weight:600; min-width:70px; text-align:center; align-self:center; }
.right i { display:block; width:100%; height:2px; background:var(--ink); position:relative; margin:4px 0; }
.right i::after { content:""; position:absolute; right:-2px; top:-5px; border:6px solid transparent; border-left:9px solid var(--ink); }

.timeline { position:relative; display:flex; flex-direction:column; gap:22px; }
.timeline::before { content:""; position:absolute; left:18px; top:24px; bottom:24px; width:2px; background:#c4c8d0; }
.srow { display:grid; gap:26px; align-items:start; position:relative; }
.srow .step h3 { font-size:17px; margin-top:7px; }
.srow .step p { color:#363c4a; }

.seq { display:flex; flex-direction:column; }
.seqrow { display:grid; grid-template-columns:auto 1fr; gap:28px; border-top:1.5px dashed #cfd3da; padding:16px 0; }
.seqrow.seqhead { border-top:none; padding:0 0 4px; position:relative; }
.seqrow.seqhead .lanes { height:62px; }
.lanes { position:relative; margin-left:38px; }
.lane { position:absolute; top:0; height:58px; padding:6px 6px; text-align:center; display:flex; flex-direction:column; justify-content:center; border-radius:10px; }
.lane b { font-size:14px; } .lane span { font-size:11px; color:var(--muted); line-height:1.2; }
.seqn { position:absolute; left:-40px; top:0; width:30px; height:30px; border-radius:50%; background:var(--ink); color:#fff; display:grid; place-items:center; font-weight:800; font-size:14px; z-index:3; }
.seqn.z-ana { background:var(--ana); } .seqn.z-ing { background:var(--ing); } .seqn.z-data { background:var(--data); } .seqn.z-ext { background:var(--ext); } .seqn.z-llm { background:var(--llm); }
.msg { position:absolute; height:0; border-top:2.5px solid var(--c); z-index:2; }
.msg.reply { border-top-style:dashed; border-top-width:2px; }
.msg::after { content:""; position:absolute; top:-7.5px; border:6px solid transparent; }
.msg.r::after { right:-3px; border-left:10px solid var(--c); border-right:none; }
.msg.l::after { left:-3px; border-right:10px solid var(--c); border-left:none; }
.msg span { position:absolute; bottom:5px; text-align:center; font:600 11.5px/1.35 "DejaVu Sans Mono", monospace; color:var(--ink); }
.msg span em { font-style:normal; background:var(--bg); padding:0 3px; box-decoration-break:clone; -webkit-box-decoration-break:clone; }
.act { position:absolute; width:156px; z-index:2; font-size:12px; line-height:16px; text-align:center; padding:4px 6px; border-radius:7px; border:1.5px solid; background:#fff; }
.act.z-ana { border-color:var(--ana); background:var(--ana-bg); } .act.z-ing { border-color:var(--ing); background:var(--ing-bg); }
.act.z-data { border-color:var(--data); background:var(--data-bg); } .act.z-llm { border-color:var(--llm); background:var(--llm-bg); }
.act.z-ext { border-color:var(--ext); background:var(--ext-bg); }
.seqrow .col h3 { font-size:17px; margin:2px 0 4px; }

.flow { display:flex; align-items:stretch; gap:8px; }
.flow .fbox { flex:1; padding:10px 12px; display:flex; flex-direction:column; gap:3px; justify-content:center; }
.flow .fbox b { font-size:14.5px; } .flow .fbox span { font-size:12.5px; color:var(--muted); line-height:1.35; }
.flow .right { min-width:44px; flex:none; }

table.t { border-collapse:collapse; width:100%; font-size:14px; background:var(--card); border-radius:10px; overflow:hidden; }
table.t th, table.t td { text-align:left; padding:7px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
table.t th { background:#e9eaee; font-size:12.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
table.t tr:last-child td { border-bottom:none; }
ul.tight { margin:4px 0 0; padding-left:18px; } ul.tight li { margin:2px 0; }
.legend { display:flex; gap:16px; flex-wrap:wrap; font-size:13px; color:var(--muted); align-items:center; }
.callout { border-left:4px solid var(--ink); padding:8px 14px; background:var(--card); border-radius:0 10px 10px 0; }
.callout.z-ana { border-color:var(--ana); } .callout.z-ing { border-color:var(--ing); } .callout.z-data { border-color:var(--data); }
.callout.z-mon { border-color:var(--mon); } .callout.z-plat { border-color:var(--plat); } .callout.z-build { border-color:var(--build); }
`;
