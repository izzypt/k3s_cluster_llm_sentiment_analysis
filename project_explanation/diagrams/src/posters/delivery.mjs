import { snip, code, page, flow, b } from "../lib.mjs";

export default {
  file: "11-delivery-and-monitoring.png",
  render: () =>
    page({
      num: 11,
      title: "Day 2: shipping updates without downtime, and watching it run",
      subtitle:
        "How a new version reaches the cluster (locally with <code>make update</code>, in production with Argo CD), why analysts never notice, " +
        "and how the database itself reports whether the pipeline is healthy.",
      body: `
<h2>Continuous delivery</h2>
${flow(
  [
    { zone: "build", title: "make build", sub: "tests + new image tag &lt;sha&gt;-&lt;time&gt;" },
    { zone: "build", title: "make push", sub: "→ registry" },
    { zone: "ana", title: "make deploy", sub: "overlay pins the new tag, kubectl apply -k" },
    { zone: "data", title: "migrate Job", sub: "schema + grants, idempotent; old pods keep serving" },
    { zone: "ana", title: "rolling update", sub: "one new pod at a time, old ones serve until it's ready" },
  ],
)}
<p class="small muted" style="margin:8px 0 0"><code>make update</code> = <code>build push deploy</code>. Production replaces the first three boxes with CI + a Git commit + Argo CD (right).</p>

<div class="grid3 section" style="margin-top:20px">
  <div class="col">
    <h3>Zero-downtime rollout of the api</h3>
    <p>Start one extra pod ${b("A")}, never drop below the desired count ${b("B")}; a new pod only receives traffic after <code>/readyz</code> passes.
      On the way out, <code>preStop</code> waits 5 s ${b("C")} so Traefik stops routing to it before it shuts down. Measured: 96/96 requests OK during an update.</p>
    ${code(snip("k8s/base/analysis/api.yaml", [{ at: "strategy:", n: 5 }, { at: "lifecycle:", n: 4 }], { marks: { "maxSurge: 1": "A", "maxUnavailable: 0": "B", 'command: ["sleep", "5"]': "C" } }))}
    <p class="small">Node maintenance is covered too: the PDB keeps at least one api pod, the HPA keeps at least two, spread over nodes.</p>
    ${code(snip("k8s/base/analysis/api.yaml", [{ at: "kind: PodDisruptionBudget", n: 6 }, { at: "minReplicas: 2", n: 2 }]))}
  </div>
  <div class="col">
    <h3>Config changes roll out too</h3>
    <p>Settings live in <code>config.env</code> files. Kustomize turns each into a ConfigMap named after a hash of its content (poster 5), so editing a value
      creates a new name, the pod template changes, and the same rolling update replaces the pods. Nothing restarts by hand.</p>
    ${code(snip("k8s/base/analysis/config.env", [{ at: "LOG_LEVEL=INFO", n: 3 }, { at: "SUMMARY_WINDOW_HOURS=", n: 2 }, { at: "PGHOST=", n: 4 }]))}
    <h3 style="margin-top:6px">Schema changes must be backward compatible</h3>
    <p class="small">The migrate Job runs during the rollout, while old pods are still serving. So a migration may only add things (expand);
      removing what old code still uses waits for a later release (contract).</p>
  </div>
  <div class="col">
    <h3>Production: GitOps with Argo CD</h3>
    <p>CI builds and pushes the image, then commits the new tag to <code>k8s/overlays/production</code>. Argo CD, running inside the cluster, notices the commit
      and applies it ${b("D")}; it also deletes what was removed from Git and reverts manual changes ${b("E")}. The migrate Job runs as a <b>Sync hook</b> on every sync.
      Rollback is <code>git revert</code>.</p>
    ${code(snip("deploy/argocd/application.yaml", [{ at: "source:", to: "selfHeal: true" }], { marks: { "path: k8s/overlays/production": "D", "selfHeal: true": "E" } }))}
    ${code(snip("k8s/overlays/production/kustomization.yaml", [{ at: "images:", n: 7 }, { at: "- target: { kind: Cluster, name: feeddb }", n: 5 }], { title: "same base, other knobs" }))}
  </div>
</div>

<h2 class="section">Monitoring: the database reports on the pipeline</h2>
${flow(
  [
    { zone: "data", title: "monitoring-queries.yaml", sub: "SQL run inside PostgreSQL as pg_monitor" },
    { zone: "data", title: "CNPG exporter :9187", sub: "one metric per column, on every instance" },
    { zone: "mon", title: "Prometheus", sub: "finds pods via the K8s API, scrapes every 30 s, keeps 15 d" },
    { zone: "mon", title: "Grafana", sub: "datasource + dashboard provisioned from Git" },
    { zone: "ext", title: "Operator", sub: "grafana.localhost:8090, read-only" },
  ],
)}
<div class="grid3" style="margin-top:20px">
  <div class="col">
    <p>The workers hand work over through the database, so the database already knows how healthy the pipeline is: how many posts wait for the LLM ${b("F")},
      how old the oldest one is. No metrics code in the application at all.</p>
    ${code(snip("k8s/base/data/monitoring-queries.yaml", [{ at: "skypulse_pipeline:", to: "primary: true" }], { marks: { "AS posts_pending": "F" } }))}
  </div>
  <div class="col">
    <p>Prometheus asks the Kubernetes API for pods with these labels ${b("G")} and keeps only the container port named <code>metrics</code>. Pods that are replaced
      (failover, rollout) are picked up automatically. A second job scrapes Traefik, which sees every analyst request: rate, errors, latency.</p>
    ${code(snip("k8s/base/monitoring/config/prometheus.yml", [{ at: "- job_name: postgres", to: "action: keep" }], { marks: { "label: cnpg.io/cluster=feeddb": "G" } }))}
  </div>
  <div class="col">
    <p>Grafana is configured by files, not clicks: the Prometheus datasource ${b("H")} and the SkyPulse dashboard JSON are mounted from a ConfigMap. Panels include
      <i>Oldest summary</i>, <i>API requests / errors / p95 latency</i>, <i>Posts waiting for the LLM</i> and a per-subscription table.</p>
    ${code(snip("k8s/base/monitoring/config/grafana-datasources.yaml", [{ at: "datasources:", to: "editable: false" }], { marks: { "url: http://prometheus:9090": "H" } }))}
    ${code(snip("k8s/base/monitoring/config/skypulse-dashboard.json", [{ at: '"expr": "max(cnpg_skypulse_pipeline_posts_pending)"', n: 1 }], { title: "one panel's query" }))}
  </div>
</div>`,
    }),
};
