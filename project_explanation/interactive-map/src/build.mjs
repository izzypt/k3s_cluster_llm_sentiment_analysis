// Builds ../skypulse-atlas.html: the atlas data + code excerpts from the real source,
// injected into template.html.
//
//   cd project_explanation/diagrams/src && npm install      (shared dependencies)
//   node ../../interactive-map/src/build.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { snip, hljs } from "../../diagrams/src/lib.mjs";
import SNIPPETS from "./snippets.mjs";
import * as D from "./atlas-data.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GITHUB = "https://github.com/izzypt/k3s_cluster_llm_sentiment_analysis/blob/main/skypulse";

// ---- check that every reference points at something real
const nodeIds = new Set(D.nodes.map((n) => n.id));
const zoneIds = new Set(D.zones.map((z) => z.id));
const edgeIds = new Set(D.edges.map((e) => e.id));
const problems = [];
const need = (set, id, where) => set.has(id) || problems.push(`${where}: unknown id ${id}`);
const usedSnippets = new Set();
const useSnips = (ids = [], where) => ids.forEach((id) => (id in SNIPPETS ? usedSnippets.add(id) : problems.push(`${where}: unknown snippet ${id}`)));

for (const z of D.zones) { useSnips(z.code, `zone ${z.id}`); (z.files ?? []).forEach((f) => f in D.files || problems.push(`zone ${z.id}: unknown file ${f}`)); }
for (const n of D.nodes) {
  need(zoneIds, n.zone, `node ${n.id}`);
  useSnips(n.code, `node ${n.id}`);
  (n.files ?? []).forEach((f) => f in D.files || problems.push(`node ${n.id}: unknown file ${f}`));
}
for (const [id, f] of Object.entries(D.files)) useSnips(f.snippets, `file ${id}`);
for (const e of D.edges) { need(nodeIds, e.from, `edge ${e.id}`); need(nodeIds, e.to, `edge ${e.id}`); useSnips(e.code, `edge ${e.id}`); }
for (const t of D.tours) for (const [i, s] of t.steps.entries()) {
  s.focus.forEach((id) => need(nodeIds, id, `tour ${t.id} step ${i + 1}`));
  s.edges.forEach((id) => need(edgeIds, id, `tour ${t.id} step ${i + 1}`));
  useSnips(s.code, `tour ${t.id} step ${i + 1}`);
}
if (problems.length) throw new Error("Atlas data problems:\n  " + problems.join("\n  "));

// ---- resolve code excerpts from the source
const snippets = {};
for (const id of [...usedSnippets].sort()) {
  const [file, parts, opts = {}] = SNIPPETS[id];
  const s = snip(file, parts, { lang: opts.lang });
  const text = s.lines.map((l) => (l.gap ? "⋯" : l.text)).join("\n");
  snippets[id] = {
    title: opts.title ?? "",
    path: file,
    first: s.first,
    last: s.last,
    nums: s.lines.map((l) => (l.gap ? "" : l.no)),
    html: hljs.highlight(text, { language: s.lang, ignoreIllegals: true }).value,
    url: `${GITHUB}/${file}#L${s.first}-L${s.last}`,
  };
}

const data = { world: D.WORLD, zones: D.zones, nodes: D.nodes, files: D.files, edges: D.edges, layers: D.layers, tours: D.tours, snippets };
const json = JSON.stringify(data).replace(/</g, "\\u003c");
const template = fs.readFileSync(path.join(HERE, "template.html"), "utf8");
if (!template.includes("/*__ATLAS_DATA__*/null")) throw new Error("template.html: data placeholder missing");
const out = path.resolve(HERE, "../skypulse-atlas.html");
fs.writeFileSync(out, template.replace("/*__ATLAS_DATA__*/null", () => json));
console.log(`${path.relative(process.cwd(), out)}: ${Object.keys(snippets).length} code excerpts, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
