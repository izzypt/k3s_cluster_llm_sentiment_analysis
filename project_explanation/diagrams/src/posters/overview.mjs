import { page } from "../lib.mjs";

const P = (zone, t) => `<span class="pill z-${zone}">${t}</span>`;

// [path, what it does, zone colour, poster]
const FILES = [
  ["Makefile", "The orchestrator: <code>build</code>, <code>start</code>, <code>update</code>, <code>verify</code>, <code>status</code>, <code>logs</code>, <code>clean</code>", "plat", "2 3 11"],
  ["scripts/setup.sh", "Checks and installs make, Docker, kubectl, k3d, uv", "plat", "3"],
  ["scripts/verify.sh", "Proves the network boundary, DB rights and HA from inside the pods", "plat", "10"],
  ["pyproject.toml · uv.lock", "Python project, dependencies (exactly pinned), the <code>skypulse</code> command", "build", "2 5"],
  ["docker/app.Dockerfile", "One image for all four Python roles", "build", "2 5"],
  ["docker/llm.Dockerfile", "Ollama with the Gemma 4 model baked in", "llm", "2"],
  ["src/skypulse/__main__.py", "Entry point: <code>skypulse api|ingestor|analyzer|migrate</code>", "ana", "5"],
  ["src/skypulse/config.py", "All settings, from environment variables", "ana", "5"],
  ["src/skypulse/db.py", "Connect + retry, migrations + GRANTs, heartbeat", "data", "8 9"],
  ["src/skypulse/api.py", "FastAPI: the web page + <code>/api/subscriptions</code>, probes", "ana", "6 7"],
  ["src/skypulse/targets.py", "Validates <code>@handle</code> / <code>#hashtag</code> input", "ana", "6"],
  ["src/skypulse/static/index.html", "The analysts' single page; refreshes every 10 s", "ext", "6 7"],
  ["src/skypulse/ingestor.py", "Loop: read targets → fetch → insert posts", "ing", "6 9"],
  ["src/skypulse/bluesky.py", "HTTP client + parsers for the public Bluesky API", "ing", "6"],
  ["src/skypulse/analyzer.py", "Loop: classify posts, refresh summaries, clean up", "ana", "7 9"],
  ["src/skypulse/llm.py", "Ollama client: prompts, JSON schema, defensive parsing", "llm", "7"],
  ["tests/", "Unit tests for the parsers (no cluster needed)", "build", "2"],
  ["cluster/k3d.yaml · traefik-ha.yaml", "The local 3-node k3s cluster, registry, HA ingress", "plat", "3"],
  ["k8s/base/namespaces.yaml", "Four zones, each enforcing the <code>restricted</code> Pod Security level", "plat", "10"],
  ["k8s/base/data/", "PostgreSQL (CNPG <code>Cluster</code>), migrate Job, metrics queries, policies", "data", "3 8 11"],
  ["k8s/base/analysis/", "api, analyzer, llm, Ingress, config.env, policies", "ana", "4 5"],
  ["k8s/base/ingestion/", "ingestor, config.env, policies (internet: HTTPS to public IPs only)", "ing", "4 10"],
  ["k8s/base/monitoring/", "Prometheus, Grafana, their config and policies", "mon", "11"],
  ["k8s/overlays/local · production", "Same base: local registry vs. site registry, more replicas, hostnames + TLS", "plat", "3 11"],
  ["deploy/argocd/application.yaml", "GitOps: Argo CD keeps the cluster in sync with Git", "plat", "11"],
];

const POSTERS = [
  [2, "Build", "source → two images"],
  [3, "Setup", "what <code>make start</code> does"],
  [4, "Runtime topology", "what runs where, who may talk to whom"],
  [5, "Pod startup", "manifest → process: role, settings, login, probes"],
  [6, "Journey 1", "subscribe and ingest"],
  [7, "Journey 2", "analyze, summarize, read"],
  [8, "Database", "schema, work queue, rights per column"],
  [9, "Loops & resilience", "what happens when things break"],
  [10, "Security boundary", "four layers + proof"],
  [11, "Day 2", "updates without downtime, monitoring"],
];

const proc = (zone, name, file, writes, reads, side) => `<div class="box z-${zone} proc ${side}">
  <h3>${name} <span class="mono muted" style="font-weight:400;font-size:12px">${file}</span></h3>
  <div class="small"><b>writes</b> ${writes}</div><div class="small"><b>reads</b> ${reads}</div></div>`;

export default {
  file: "01-overview.png",
  render: () =>
    page({
      num: 1,
      title: "SkyPulse at a glance",
      subtitle:
        "Analysts subscribe to Bluesky handles and hashtags and see, for each, an LLM-written summary of recent sentiment, how many posts it covers " +
        "and when it was updated. Everything runs on-premises on Kubernetes with a local Gemma 4 model. This series explains how, in 11 pictures.",
      body: `
<style>
  .hub { display:grid; grid-template-columns:1fr 300px 1fr; grid-template-rows:auto auto; gap:18px 26px; align-items:center; position:relative; }
  .hub .pg { grid-column:2; grid-row:1 / span 2; text-align:center; padding:26px 16px; border-radius:50% / 18%; }
  .hub .pg ul { text-align:left; }
  .proc { position:relative; } .proc h3 { justify-content:space-between; }
  .proc.l::after, .proc.r::after { content:""; position:absolute; top:50%; width:26px; height:2.5px; background:var(--ink); }
  .proc.l::after { right:-28px; } .proc.r::after { left:-28px; }
  .wire { position:absolute; height:2px; background:var(--ink); }
  table.files td { padding:5px 9px; font-size:13.5px; } table.files td:first-child { white-space:nowrap; font-family:"DejaVu Sans Mono", monospace; font-size:12.5px; font-weight:600; }
  .idx { display:grid; grid-template-columns:repeat(5, 1fr); gap:12px; }
  .idx .box { padding:10px 12px; } .idx b.k { font-size:22px; margin-right:6px; }
</style>
<div class="row">
  <div class="col" style="width:930px">
    <h2>The central idea: four roles of one program, meeting only in PostgreSQL</h2>
    <p>One Python package runs as four different processes. They never call each other: each one writes rows that another reads later, on its own
      schedule. Slow things (Bluesky, the LLM at ~1.5 s per post) happen in the background, and the analysts' page only ever reads finished results.</p>
    <div class="hub">
      ${proc("ana", "api", "api.py", "subscriptions (add / delete)", "subscriptions + summaries + pending count", "l")}
      <div class="box z-data pg"><h2 style="margin:0 0 6px">PostgreSQL</h2><div class="small muted">2 instances, CloudNativePG</div>
        <ul class="tight small"><li><b>subscriptions</b>: what to follow</li><li><b>posts</b>: fetched posts = the LLM's queue</li><li><b>summaries</b>: one per subscription</li></ul></div>
      ${proc("ing", "ingestor", "ingestor.py", "posts, poll status", "subscriptions (id, kind, value)", "r")}
      ${proc("ana", "analyzer", "analyzer.py", "sentiment of posts, summaries", "unanalyzed posts, window of posts", "l")}
      ${proc("data", "migrate (Job)", "db.py", "tables, indexes, GRANTs", "applied migrations", "r")}
    </div>
    <div class="row" style="margin-top:18px">
      <div class="box z-ext grow"><h3>Outside, on the internet</h3><p class="small">Bluesky's public API. Only the <b>ingestor</b> may reach it.</p></div>
      <div class="box z-llm grow"><h3>Inside, with no egress</h3><p class="small">Ollama + Gemma 4 E2B. Only the <b>analyzer</b> may call it.</p></div>
      <div class="box z-mon grow"><h3>Watching</h3><p class="small">Prometheus + Grafana read metrics, never data.</p></div>
    </div>
    <h2 class="section">The pictures in this series</h2>
    <div class="idx">${POSTERS.map(([n, t, s]) => `<div class="box"><b class="k">${n}</b><b>${t}</b><div class="small muted">${s}</div></div>`).join("")}</div>
    <div class="legend section"><b>Colours used throughout:</b> ${P("ana", "analysis zone")} ${P("ing", "ingestion zone")} ${P("data", "data tier")}
      ${P("llm", "LLM")} ${P("mon", "monitoring")} ${P("plat", "platform / tooling")} ${P("build", "build")} ${P("ext", "outside / browser")}</div>
  </div>
  <div class="col grow">
    <h2>The repository: which file does what</h2>
    <table class="t files">
      <tr><th>skypulse/…</th><th>What it does</th><th>Poster</th></tr>
      ${FILES.map(([f, d, z, p]) => `<tr><td><span class="pill z-${z}" style="padding:0;width:8px;height:8px;margin-right:7px;vertical-align:1px"></span>${f}</td><td>${d}</td><td class="muted">${p}</td></tr>`).join("")}
    </table>
    <p class="small muted" style="margin-top:8px">Also: <code>README.md</code> (run it), <code>DESIGN.md</code> (decisions and trade-offs), and <code>project_explanation/</code> (these notes).</p>
  </div>
</div>`,
    }),
};
