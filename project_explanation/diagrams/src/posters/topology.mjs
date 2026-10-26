import fs from "node:fs";
import path from "node:path";
import { PROJECT, page, esc } from "../lib.mjs";

// The diagram itself is the one in skypulse/README.md: one source of truth, rendered here.
function readmeDiagram() {
  const readme = fs.readFileSync(path.join(PROJECT, "README.md"), "utf8");
  const m = readme.match(/```mermaid\n([\s\S]*?)```/);
  if (!m) throw new Error("README.md: no mermaid diagram found");
  return m[1];
}

// Allowed connections, from the four networkpolicies.yaml files (+ DNS for everyone).
const COLS = ["internet :443", "api :8000", "llm :11434", "postgres :5432", "postgres :9187", "prometheus :9090", "grafana :3000", "traefik :9100", "K8s API"];
const ROWS = [
  ["Traefik (kube-system)", [1, 6], "the only way in from outside"],
  ["api", [3], ""],
  ["analyzer", [2, 3], ""],
  ["llm", [], "no egress at all, apart from DNS"],
  ["ingestor", [0, 3], "public IPs only: RFC1918, CGNAT, link-local excluded"],
  ["migrate Job", [3], "as the schema owner"],
  ["postgres (feeddb)", [3, 8], "replication to its peer (+ :8000); instance manager → API"],
  ["CNPG operator", [3], "+ :8000 status checks"],
  ["prometheus", [4, 7, 8], "list pods in skypulse-data + kube-system only"],
  ["grafana", [5], ""],
];

const matrix = `<table class="t matrix">
  <tr><th>from \\ to</th>${COLS.map((c) => `<th>${c}</th>`).join("")}<th>note</th></tr>
  ${ROWS.map(([name, ok, note]) => `<tr><td><b>${name}</b></td>${COLS.map((_, i) => `<td class="${ok.includes(i) ? "yes" : "no"}">${ok.includes(i) ? "✓" : "·"}</td>`).join("")}<td class="small muted">${note}</td></tr>`).join("")}
</table>`;

export default {
  file: "04-runtime-topology.png",
  mermaid: true,
  render: () =>
    page({
      num: 4,
      title: "Runtime topology: what runs where, and who may talk to whom",
      subtitle:
        "The running system after <code>make start</code>. Every arrow is a path a NetworkPolicy opens; each namespace starts from default-deny, " +
        "so anything not drawn is blocked. Same diagram as in <code>skypulse/README.md</code>.",
      body: `
<style>
  .mermaid { background:#fff; border:1.5px solid var(--line); border-radius:12px; padding:18px; display:flex; justify-content:center; }
  .mermaid svg { width:1500px !important; max-width:1500px !important; height:auto; }
  .mermaid .cluster-label foreignObject { overflow:visible; }
  .mermaid .cluster-label div, .mermaid .cluster-label span, .mermaid .cluster-label p { white-space:nowrap !important; font-weight:700; }
  table.matrix td, table.matrix th { text-align:center; } table.matrix td:first-child, table.matrix td:last-child, table.matrix th:last-child { text-align:left; }
  table.matrix td.yes { color:var(--data); font-weight:800; font-size:17px; background:var(--data-bg); }
  table.matrix td.no { color:#c2c6ce; }
</style>
<pre class="mermaid" style="margin:0 0 22px">${esc(readmeDiagram())}</pre>
<div class="grid3">
    <div class="box"><h3>Legend</h3>
      <ul class="tight">
        <li><b>Solid arrow</b>: application traffic. <b>Thick</b>: the only route to the internet.</li>
        <li><b>Dotted</b>: metrics and control traffic.</li>
        <li><b>×N</b>: replicas in the local setup. The production overlay runs 3 PostgreSQL instances, 2 LLM replicas and at least 3 api pods.</li>
        <li>Not drawn: every pod may query CoreDNS on :53; images are pulled by the nodes from <code>localhost:5050</code>, not by pods.</li>
      </ul>
    </div>
    <div class="box z-plat"><h3>Ingress: one door, two hostnames</h3>
      <p>Browsers reach <b>localhost:8090</b>, which k3d forwards to Traefik. Traefik routes on the <code>Host</code> header:
        <code>grafana.localhost</code> → Grafana, anything else → the api. Both Ingress objects use <code>ingressClassName: traefik</code>.</p></div>
    <div class="box z-ana"><h3>Zones (namespaces)</h3>
      <ul class="tight">
        <li><b>skypulse-ingestion</b>: the only zone with internet access (HTTPS to public IPs).</li>
        <li><b>skypulse-analysis</b>: LLM, analyzer, api. Reachable only through the ingress; no internet, no <code>ipBlock</code> rules at all.</li>
        <li><b>skypulse-data</b>: PostgreSQL and the owner credentials. The two zones only meet here.</li>
        <li><b>skypulse-monitoring</b>: reads metrics ports, never SQL or app ports.</li>
      </ul></div>
</div>
<div class="section">
  <h2>Connection matrix (what the NetworkPolicies allow)</h2>
  ${matrix}
  <p class="small muted" style="margin-top:8px">Source: <code>k8s/base/{analysis,ingestion,data,monitoring}/networkpolicies.yaml</code>. <code>make verify</code> tests a sample of the ✓ and · cells from inside the pods (poster 10).</p>
</div>`,
    }),
};
