// Pulls every code excerpt the video shows out of skypulse/, highlights it and writes
// src/generated/snippets.json for the Remotion composition.
//
// Like the posters and the atlas, snippets are located by *anchor text*, never by line
// number, and this script fails if an anchor disappears: the video can't silently drift
// away from the code. The atlas's anchors are reused as-is; EXTRA adds the ones only the
// video needs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import hljs from "highlight.js";
import ATLAS from "../../interactive-map/src/snippets.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, "../../../skypulse");
const OUT = path.resolve(HERE, "../src/generated/snippets.json");

// id -> [file, parts, { title, lang? }]   (same format as ../../interactive-map/src/snippets.mjs)
const EXTRA = {
  pyproject: ["pyproject.toml", [{ at: "[project]", n: 1 }, { at: "requires-python", to: "[build-system]" }, { at: "requires = [", n: 2 }], { title: "The project, its ranges and its command" }],
  mk_tags: ["Makefile", [{ at: "APP_IMAGE := ", to: "NEW_APP_TAG := " }], { title: "Image names and tags" }],
  mk_update: ["Makefile", [{ at: "update: build push deploy", n: 1 }], { title: "make update" }],
  setup_check: ["scripts/setup.sh", [{ at: "#   ./scripts/setup.sh --check", n: 1 }, { at: "  --check) mode=check ;;", n: 1 }], { title: "setup.sh --check, run by make check-tools" }],
  main_role: ["src/skypulse/__main__.py", [{ at: "def main()", to: "args = parser.parse_args()" }, { at: 'if args.role == "api":', n: 1 }, { at: "uvicorn.run(", to: "port=settings.http_port," }, { at: 'elif args.role == "ingestor":', to: "migrate()" }], { title: "args.role picks the code that runs" }],
  app_entry: ["docker/app.Dockerfile", [{ at: "ENV PATH=/app/.venv/bin:$PATH", n: 1 }, { at: "USER 10001", n: 1 }, { at: 'ENTRYPOINT ["skypulse"]', n: 2 }], { title: "The image's command line" }],
  k_api_args: ["k8s/base/analysis/api.yaml", [{ at: "- name: api", to: "key: password" }], { title: "The api container: role, settings, login" }],
  db_connect_only: ["src/skypulse/db.py", [{ at: "def connect(", n: 3 }, { at: "def wait_for_db(", to: "time.sleep(3)" }], { title: "libpq fills in the connection from PG* variables" }],
  db_grant_fn: ["src/skypulse/db.py", [{ at: "def _grant(", to: 'log.info("granted least-privilege' }], { title: "Wait for the operator's role, then GRANT" }],
  ingress_full: ["k8s/base/analysis/ingress.yaml", [{ at: "kind: Ingress", to: "name: http" }], { title: "Ingress: / → Service api" }],
  k_pg_full: ["k8s/base/data/postgres.yaml", [{ at: "kind: Cluster", to: "podAntiAffinityType: required" }], { title: "kind: Cluster, watched by the CloudNativePG operator" }],
  k_pg_monitoring: ["k8s/base/data/postgres.yaml", [{ at: "monitoring:", to: "key: queries" }], { title: "Custom queries on the exporter" }],
  overlay_prod: ["k8s/overlays/production/kustomization.yaml", [{ at: "resources:", to: "value: 50Gi" }], { title: "overlays/production: same base, other knobs" }],
  config_py: ["src/skypulse/config.py", [{ at: "class Settings:", to: "settings = Settings()" }], { title: "config.py: environment → frozen Settings" }],
  verify_db: ["scripts/verify.sh", [{ at: 'echo "== Least privilege', to: "the schema owner's credentials exist only in" }], { title: "make verify: the forbidden SQL" }],
  k_migrate_full: ["k8s/base/data/migrate.yaml", [{ at: "spec:", n: 1 }, { at: "template:", to: 'drop: ["ALL"]' }], { title: "A hardened pod (the migrate Job)" }],
  ingestor_live: ["k8s/base/ingestion/ingestor.yaml", [{ at: "livenessProbe:", to: "initialDelaySeconds" }], { title: "Liveness: is the heartbeat fresh?" }],
  k_api_links: ["k8s/base/analysis/api.yaml", [{ at: "kind: Deployment", n: 4 }, { at: "selector:", n: 3 }, { at: "template:", n: 4 }, { at: "topologySpreadConstraints:", n: 7 }, { at: "kind: Service", to: "targetPort: http" }], { title: "How the api objects find each other" }],
  an_constants: ["src/skypulse/analyzer.py", [{ at: "POSTS_PER_ROUND = ", n: 2 }], { title: "analyzer.py" }],
};

const LANG_BY_EXT = { ".py": "python", ".yaml": "yaml", ".yml": "yaml", ".toml": "ini", ".sh": "bash", ".html": "xml", ".json": "json", ".env": "bash" };
function langFor(rel) {
  const base = path.basename(rel);
  if (base === "Makefile") return "makefile";
  if (base.endsWith("Dockerfile")) return "dockerfile";
  return LANG_BY_EXT[path.extname(rel)] ?? "plaintext";
}

const cache = new Map();
function readLines(rel) {
  if (!cache.has(rel)) cache.set(rel, fs.readFileSync(path.join(PROJECT, rel), "utf8").replace(/\r\n/g, "\n").split("\n"));
  return cache.get(rel);
}

function findLine(rel, lines, anchor, from) {
  for (let i = from; i < lines.length; i++) if (lines[i].includes(anchor)) return i;
  throw new Error(`${rel}: anchor not found after line ${from + 1}: ${JSON.stringify(anchor)}`);
}

// Same selection rules as ../../diagrams/src/lib.mjs snip().
function snip(rel, parts) {
  const lines = readLines(rel);
  const picked = [];
  let cursor = 0;
  for (const part of parts) {
    const start = findLine(rel, lines, part.at, cursor);
    const end = part.to ? findLine(rel, lines, part.to, start + 1) : start + (part.n ?? 1) - 1;
    if (end >= lines.length) throw new Error(`${rel}: snippet runs past the end of the file`);
    if (picked.length && start !== cursor) picked.push({ gap: true });
    for (let i = start; i <= end; i++) picked.push({ no: i + 1, text: lines[i] });
    cursor = end + 1;
  }
  const indents = picked.filter((l) => !l.gap && l.text.trim()).map((l) => l.text.match(/^ */)[0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  for (const l of picked) if (!l.gap) l.text = l.text.slice(cut);
  return picked;
}

// Highlight the whole excerpt at once (so multi-line strings stay strings), then split the
// HTML into lines, closing and reopening the spans that cross a line break.
function highlightLines(texts, lang) {
  const html = hljs.highlight(texts.join("\n"), { language: lang, ignoreIllegals: true }).value;
  const out = [];
  let cur = "";
  const open = [];
  for (let i = 0; i < html.length; ) {
    if (html.startsWith("<span", i)) {
      const end = html.indexOf(">", i) + 1;
      const tag = html.slice(i, end);
      open.push(tag);
      cur += tag;
      i = end;
    } else if (html.startsWith("</span>", i)) {
      open.pop();
      cur += "</span>";
      i += 7;
    } else if (html[i] === "\n") {
      out.push(cur + "</span>".repeat(open.length));
      cur = open.join("");
      i++;
    } else {
      cur += html[i++];
    }
  }
  out.push(cur);
  return out;
}

const result = {};
for (const [id, [rel, parts, opts]] of Object.entries({ ...ATLAS, ...EXTRA })) {
  const picked = snip(rel, parts);
  const lang = opts.lang ?? langFor(rel);
  const html = highlightLines(picked.map((l) => (l.gap ? "" : l.text)), lang);
  const nums = picked.filter((l) => !l.gap).map((l) => l.no);
  result[id] = {
    file: `skypulse/${rel}`,
    title: opts.title,
    first: nums[0],
    last: nums.at(-1),
    lines: picked.map((l, i) => (l.gap ? { gap: true } : { no: l.no, text: l.text, html: html[i] })),
  };
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
console.log(`${Object.keys(result).length} snippets → ${path.relative(process.cwd(), OUT)}`);

// The engine imports the voice-over timings; without `npm run voice` there are none yet,
// which is fine for the captions-only video.
const VOICE = path.resolve(path.dirname(OUT), "voice.json");
if (!fs.existsSync(VOICE)) fs.writeFileSync(VOICE, "{}");
