import { snip, code, page, stepRow, timeline, flow, b } from "../lib.mjs";

export default {
  file: "03-setup-make-start.png",
  render: () =>
    page({
      num: 3,
      title: "Setup: what <code>make start</code> does",
      subtitle:
        "Five Makefile targets in a row turn a laptop with Docker into a 3-node Kubernetes cluster running SkyPulse. " +
        "Then the operators and controllers inside the cluster take over and build the rest.",
      body: `
${flow(
  [
    { zone: "plat", title: "check-tools", sub: "tools installed, Docker running" },
    { zone: "plat", title: "cluster", sub: "k3d: 3 nodes + registry + Traefik ×2" },
    { zone: "data", title: "operator", sub: "CloudNativePG controller" },
    { zone: "data", title: "secrets", sub: "one DB password per zone" },
    { zone: "build", title: "push", sub: "images → localhost:5050" },
    { zone: "ana", title: "deploy", sub: "kustomize apply + wait" },
  ],
  { labels: ["", "", "", "", ""] },
)}
<p class="muted small" style="margin:10px 0 22px">Defined as <code>start: check-tools cluster operator secrets push deploy</code>. Each target can also be run on its own;
  <code>make update</code> = <code>build push deploy</code> (poster 11).</p>
${timeline([
  stepRow({
    n: 1, zone: "plat", title: "<code>cluster</code>: k3s nodes as Docker containers",
    text: `<p>k3d starts 1 server + 2 agents ${b("A")} running real k3s, a load balancer that maps <b>localhost:8090</b> to the nodes' port 80 ${b("B")},
      and a private image registry on <b>localhost:5050</b> ${b("C")}. containerd on the nodes is told to pull <code>localhost:5050/…</code> from that registry.</p>
      <p>k3s brings its own Traefik ingress controller, CoreDNS, local-path storage and NetworkPolicy enforcement. <code>traefik-ha.yaml</code> ${b("D")} raises
      Traefik to 2 replicas with a PDB, because every analyst request goes through it.</p>`,
    right: `<div class="col">${code(snip("cluster/k3d.yaml", [{ at: "servers: 1", n: 3 }, { at: "ports:", n: 4 }, { at: "registries:", n: 13 }], {
      marks: { "agents: 2": "A", "- port: 8090:80": "B", 'hostPort: "5050"': "C" },
    }))}
    <div class="col">${code(snip("Makefile", [{ at: "cluster: ## Create", to: "kubectl apply -f cluster/traefik-ha.yaml" }], { marks: { "kubectl apply -f cluster/traefik-ha.yaml": "D" } }))}
    ${code(snip("cluster/traefik-ha.yaml", [{ at: "valuesContent:", n: 6 }]))}</div></div>`,
  }),
  stepRow({
    n: 2, zone: "data", title: "<code>operator</code>: install CloudNativePG",
    text: `<p>Adds the <code>Cluster</code> custom resource type and its controller (namespace <code>cnpg-system</code>). From now on, a ~30-line
      <code>Cluster</code> manifest is enough to get a replicated, self-healing PostgreSQL.</p>`,
    right: code(snip("Makefile", [{ at: "operator: ## Install", n: 3 }])),
  }),
  stepRow({
    n: 3, zone: "data", title: "<code>secrets</code>: one database login per zone",
    text: `<p>Creates the four namespaces first (they carry the <code>restricted</code> Pod Security label). Then, for each role
      (<code>ingestor</code>, <code>analysis</code>), a random password is generated once and kept in <code>.secrets/</code> ${b("A")}.</p>
      <p>The same Secret is written into <b>two</b> namespaces ${b("B")}: <code>skypulse-data</code>, where CloudNativePG creates the role from it, and the zone's own
      namespace, where the pods read it. No zone ever sees another zone's password, nor the owner's.</p>`,
    right: code(snip("Makefile", [{ at: "for pair in ingestor:", to: "cnpg.io/reload=true" }, { at: "done", n: 1 }], { marks: { "test -s .secrets/$$role-password": "A", "for ns in $(NS_D) $$zone_ns": "B" } })),
  }),
  stepRow({
    n: 4, zone: "build", title: "<code>push</code>: images into the cluster's registry",
    text: `<p>Pushes exactly the tags <code>make build</code> wrote to <code>.build/</code>, so the cluster runs what was just tested.</p>`,
    right: code(snip("Makefile", [{ at: "push: ## Push", n: 4 }])),
  }),
  stepRow({
    n: 5, zone: "ana", title: "<code>deploy</code>: apply everything with pinned versions, then wait",
    text: `<p>A throw-away Kustomize overlay ${b("A")} stacks on <code>k8s/overlays/local</code> (registry names), which stacks on <code>k8s/base</code> (the whole
      system) and pins the tags just built. The old migrate Job is deleted ${b("B")} because a Job's template can't change, then one
      <code>kubectl apply -k</code> ${b("C")} creates or updates every object.</p>
      <p>Then it waits ${b("D")}, in dependency order: database ready → migrations done → each Deployment rolled out.</p>`,
    right: code(snip("Makefile", [{ at: "deploy: ## Apply", to: "rollout status deployment/grafana" }], {
      marks: { "'  - ../../k8s/overlays/local'": "A", "delete job migrate --ignore-not-found": "B", "kubectl apply -k $(BUILD_DIR)/deploy": "C", "wait cluster.postgresql.cnpg.io/feeddb": "D" },
    })),
  }),
  stepRow({
    n: 6, zone: "data", title: "Inside the cluster, controllers do the rest",
    text: `<p><b>CloudNativePG</b> sees the <code>Cluster</code> object and creates 2 PostgreSQL pods on different nodes ${b("A")}, their volumes, the
      <code>feeddb-rw</code> Service, the owner Secret <code>feeddb-app</code>, and the two login roles from the Secrets of step 3 ${b("B")}.</p>
      <p><b>The migrate Job</b> waits for the database, creates the tables and grants each role its rights (poster 8). Meanwhile the api,
      ingestor and analyzer pods start and simply retry until the schema exists (poster 9). <b>Deployment, HPA and Job controllers</b>
      create and replace pods; <b>Traefik</b> picks up the two Ingress objects.</p>`,
    right: `<div class="grid2">${code(snip("k8s/base/data/postgres.yaml", [{ at: "kind: Cluster", n: 6 }, { at: "managed:", n: 12 }], { marks: { "instances: 2": "A", "passwordSecret:": "B" } }))}
      ${code(snip("k8s/base/kustomization.yaml", [{ at: "resources:", to: "monitoring/networkpolicies.yaml" }]))}</div>`,
  }),
])}
<div class="callout z-plat section"><b>Before all this:</b> <code>./scripts/setup.sh</code> installs whatever is missing (make and Docker from the system package manager;
  kubectl, k3d and uv into <code>~/.local/bin</code>) and warns if Docker has less than 12 GB of memory. <b>After:</b> <code>make verify</code> proves the
  security boundary and the HA setup from inside the pods (poster 10). <code>make stop</code> keeps the data; <code>make clean</code> deletes the cluster.</div>`,
    }),
};
