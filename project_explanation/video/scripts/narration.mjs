// Turns every caption into the text the voice-over reads, and writes
// src/generated/narration.json ({ "<scene>/<beat>": text }) for scripts/voice.py.
//
// The captions are read from the scenes themselves (bundled with esbuild), so the voice can't
// drift from what is on screen. A beat can set `speak` when its caption doesn't read well aloud;
// otherwise the caption is cleaned up here: markup removed, and code, paths and names spelled
// the way a person would say them.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = path.resolve(ROOT, "src/generated/narration.json");

// Whole words (case-sensitive), said the way an engineer would say them
const WORDS = {
  k3d: "K3D", k3s: "K3S", kubectl: "cube control", kubelet: "cube-let", containerd: "container-D", nginx: "engine-X",
  uv: "U-V", uvicorn: "uvicorn", pytest: "pie-test", pydantic: "pydantic", psql: "P-S-Q-L", libpq: "lib-P-Q",
  CNPG: "C-N-P-G", CoreDNS: "Core DNS", ServiceLB: "Service L-B", MetalLB: "Metal L-B", LLM: "L-L-M", LLMs: "L-L-Ms",
  api: "A-P-I", yaml: "YAML", Kustomize: "Customize", kustomize: "customize", kustomization: "customization",
  Argo: "Argo", GitOps: "Git-Ops", ollama: "Ollama", Ollama: "Ollama", qwen: "Qwen", Qwen: "Qwen",
  SQL: "sequel", NULL: "null", PG: "P-G", PGUSER: "P-G user", PGPASSWORD: "P-G password", PGHOST: "P-G host",
  PGDATABASE: "P-G database", DATABASE_URL: "database URL", JSON: "Jason", HA: "H-A", ID: "I-D", id: "I-D", ids: "I-Ds",
  VLAN: "V-LAN", iptables: "I-P tables", hostPort: "host port", podSelector: "pod selector", nodeSelector: "node selector",
  readyz: "ready-Z", healthz: "health-Z", stdout: "standard out", stderr: "standard error", args: "args",
  sha256: "SHA-256", TTL: "T-T-L", CPU: "C-P-U", GPU: "G-P-U", RBAC: "R-back", PVC: "P-V-C", PVCs: "P-V-Cs",
  llm: "L-L-M", skypulse: "SkyPulse", serverlb: "server L-B", svclb: "service L-B", cnpg: "C-N-P-G", feeddb: "feed D-B",
  rw: "R-W", ro: "R-O", Gi: "gigabytes", GB: "gigabytes", md: "M-D", sh: "S-H", py: "P-Y", toml: "TOML", HPA: "H-P-A",
  UI: "U-I", etcd: "E-T-C-D", argparse: "arg-parse", argv: "arg-V", psycopg: "psycho-P-G", seccomp: "sec-comp",
  initdb: "init D-B", pg: "P-G", db: "D-B", k8s: "K-8-S", PGSSLMODE: "P-G S-S-L mode", ENTRYPOINT: "entry point",
  CMD: "C-M-D", sha: "SHA", html: "HTML", env: "env", svc: "service",
  CRD: "C-R-D", CRDs: "C-R-Ds", CI: "C-I", TLS: "T-L-S", UID: "U-I-D", GID: "G-I-D", WAL: "wall", gRPC: "G-R-P-C",
};

function speakCode(code) {
  let s = code
    .replace(/^https?:\/\//, "")
    .replace(/\s*(->|→)\s*/g, " to ")
    .replace(/\s*>=\s*/g, " at least ")
    .replace(/\s*<=\s*/g, " at most ")
    .replace(/[<>…]/g, " ")
    .replace(/^#$/, "hash")
    .replace(/:(\d{2,5})\b/g, " port $1")
    .replace(/(\d+)h\b/g, "$1 hours")
    .replace(/(^|\s)--?(?=\w)/g, "$1")         // --locked, -q: just the flag's name
    .replace(/\b[A-Z][A-Z0-9]*(_[A-Z0-9]+)+\b/g, (w) => w.toLowerCase()) // POLL_INTERVAL_SECONDS
    .replace(/(^|[\s/])\.(?=\w)/g, "$1dot ")   // .venv, .build/
    .replace(/([A-Za-z_])\.(?=[A-Za-z_])/g, "$1 dot ") // app.Dockerfile, llm.classify
    .replace(/^\/$/, "slash")
    .replace(/[_]+/g, " ")
    .replace(/\//g, " slash ")
    .replace(/(^|\s)#(?=\w)/g, "$1hashtag ")
    .replace(/[{}[\]"'`:]/g, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s*=\s*/g, " equals ")
    .replace(/(\w)-(?=[A-Za-z])/g, "$1 ")       // skypulse-data, default-deny-all
    .replace(/\s+/g, " ")
    .trim();
  return s.replace(/^slash (?=\S)/, "slash ").replace(/(\S) slash$/, "$1");
}

export function toSpeech(text) {
  let s = text
    .replace(/`([^`]+)`/g, (_, c) => ` ${speakCode(c)} `)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/==([^=]+)==/g, "$1")
    .replace(/\s*→\s*/g, " to ")
    .replace(/\s*←\s*/g, " from ")
    .replace(/\s*≈\s*/g, " about ")
    .replace(/\s*×\s*/g, " times ")
    .replace(/(\d)\s*%/g, "$1 percent")
    .replace(/\be\.g\./g, "for example")
    .replace(/\bi\.e\./g, "that is")
    .replace(/\bvs\.?\s/g, "versus ")
    .replace(/\s&\s/g, " and ")
    .replace(/(^|\s)#(\w)/g, "$1hashtag $2")
    .replace(/@([\w.]+\w)/g, (_, h) => "at " + h.replace(/\./g, " dot "))
    .replace(/−/g, "minus ")
    .replace(/(\d)\s+s\b/g, "$1 seconds")
    .replace(/ = /g, " equals ")
    .replace(/[*[\]]/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/[A-Za-z][A-Za-z0-9_]*/g, (w) => WORDS[w] ?? w);
  return s;
}

async function loadScenes() {
  const stub = { name: "stub-fonts", setup(b) { b.onResolve({ filter: /^@remotion\/google-fonts\// }, (a) => ({ path: a.path, namespace: "stub" })); b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const loadFont = () => ({ fontFamily: 'sans-serif' });", loader: "js" })); } };
  const tmp = path.resolve(ROOT, "src/generated/.scenes.mjs");
  await build({ entryPoints: [path.resolve(ROOT, "src/scenes/index.ts")], bundle: true, format: "esm", platform: "node", outfile: tmp, plugins: [stub], logLevel: "error", jsx: "automatic", packages: "bundle" });
  try {
    return (await import(pathToFileURL(tmp).href)).SCENES;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const SCENES = await loadScenes();
const out = {};
for (const s of SCENES) s.beats.forEach((b, i) => (out[`${s.id}/${i}`] = b.speak ?? toSpeech(b.say)));
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`${Object.keys(out).length} narrated beats → ${path.relative(process.cwd(), OUT)}`);
