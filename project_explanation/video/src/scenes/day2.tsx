import React from "react";
import { Appear, SceneDef } from "../engine";
import { BODY, C, SANS, SPLIT, ZONE } from "../theme";
import { Board } from "../ui/Board";
import { Bullets, Table } from "../ui/Lists";

const fit = { w: 860, h: 758, fitW: SPLIT.visualW, fitH: BODY.h };

const Failures: React.FC = () => (
  <div style={{ paddingTop: 4 }}>
    <Table
      w={BODY.w}
      size={0.92}
      cols={[{ label: "what fails", w: 22 }, { label: "who notices", w: 16 }, { label: "what happens", w: 62 }]}
      rows={[
        { at: 0, cells: ["database not up yet", "every role", "`wait_for_db()` retries every 3 s; the api's `/readyz` fails, so it gets no traffic"], tone: "warn" },
        { at: 1, cells: ["schema not migrated", "ingestor, analyzer", "`UndefinedTable` → \"schema not ready\", retry every 5 s"], tone: "warn" },
        { at: 2, cells: ["Postgres failover", "every role", "workers reconnect, the api pool replaces connections, uncommitted work rolls back"], tone: "ok" },
        { at: 3, cells: ["Bluesky down / unknown handle", "ingestor", "written to `last_error`, shown in the UI; other subscriptions continue"], tone: "ok" },
        { at: 4, cells: ["LLM down", "analyzer", "rollback, the post stays queued, retry every 5 s; analysts keep the last summaries"], tone: "ok" },
        { at: 4, cells: ["LLM rejects one post", "analyzer", "marked neutral, so it can't block the queue"], tone: "ok" },
        { at: 5, cells: ["a worker loop hangs", "kubelet", "heartbeat file older than 10 min → liveness probe restarts the container"], tone: "ok" },
        { at: 6, cells: ["an api pod or a node dies", "Kubernetes", "other replicas, on other nodes, keep serving; the Deployment replaces it"], tone: "ok" },
      ]}
    />
  </div>
);

const Rolling: React.FC = () => (
  <Board
    {...fit}
    boxes={[
      { id: "tr", kind: "stack", zone: "platform", label: "traefik", sub: "routes to ready pods only", x: 230, y: 24, w: 400, h: 90, at: 0 },
      { id: "o1", zone: "analysis", label: "api v1", sub: "ready", x: 40, y: 230, w: 240, h: 100, at: 0, until: 5 },
      { id: "o2", zone: "analysis", label: "api v1", sub: "ready", x: 310, y: 230, w: 240, h: 100, at: 0, until: 3 },
      { id: "o2t", color: C.warn, label: "api v1", sub: "preStop: sleep 5", x: 310, y: 230, w: 240, h: 100, at: 3, until: 4 },
      { id: "n1", zone: "build", label: "api v2", sub: "starting…", x: 580, y: 230, w: 240, h: 100, at: 1, until: 2 },
      { id: "n1r", zone: "build", label: "api v2", sub: "/readyz ✓", x: 580, y: 230, w: 240, h: 100, at: 2 },
      { id: "n2r", zone: "build", label: "api v2", sub: "/readyz ✓", x: 310, y: 230, w: 240, h: 100, at: 4 },
      { id: "n3r", zone: "build", label: "api v2", sub: "/readyz ✓", x: 40, y: 230, w: 240, h: 100, at: 5 },
      { id: "rule", kind: "note", label: "`maxSurge: 1` · `maxUnavailable: 0`", x: 40, y: 380, w: 780, h: 60, at: 1, align: "center" },
      { id: "pdb", kind: "chip", zone: "analysis", label: "PodDisruptionBudget minAvailable: 1", x: 40, y: 500, w: 780, h: 64, at: 5 },
      { id: "hpa", kind: "chip", zone: "analysis", label: "HPA: 2–5 replicas, CPU 70%", x: 40, y: 590, w: 780, h: 64, at: 5 },
      { id: "res", kind: "note", label: "under load: `make update` 96/96 · primary deleted 114/114 · node drained 59/59", x: 40, y: 680, w: 780, h: 60, at: 4, align: "center", size: 0.85 },
    ]}
    arrows={[
      { id: "t1", from: "tr", to: "o1", zone: "platform", at: 0, until: 5 },
      { id: "t2", from: "tr", to: "o2", zone: "platform", at: 0, until: 3 },
      { id: "t3", from: "tr", to: "n1r", zone: "platform", at: 2 },
      { id: "t4", from: "tr", to: "n2r", zone: "platform", at: 4 },
      { id: "t5", from: "tr", to: "n3r", zone: "platform", at: 5 },
    ]}
  />
);

const Monitoring: React.FC = () => (
  <Board
    {...fit}
    boxes={[
      { id: "zd", kind: "zone", zone: "data", label: "skypulse-data", x: 10, y: 24, w: 840, h: 250, at: 0 },
      { id: "pg", zone: "data", label: "PostgreSQL primary", sub: "posts · summaries · subscriptions", x: 40, y: 70, w: 360, h: 90, at: 0 },
      { id: "q", zone: "data", label: "custom queries", sub: "monitoring-queries.yaml", x: 450, y: 70, w: 370, h: 90, at: 1 },
      { id: "ex", zone: "data", label: "exporter :9187", sub: "runs them as pg_monitor", x: 240, y: 180, w: 380, h: 80, at: 2 },
      { id: "zm", kind: "zone", zone: "monitoring", label: "skypulse-monitoring", x: 10, y: 330, w: 840, h: 300, at: 3 },
      { id: "pr", zone: "monitoring", label: "Prometheus", sub: "finds pods via\nthe Kubernetes API", x: 40, y: 380, w: 300, h: 110, at: 3 },
      { id: "tr", kind: "chip", zone: "platform", label: "traefik :9100", sub: "request rate, errors, latency", x: 500, y: 397, w: 330, h: 76, at: 4 },
      { id: "gr", zone: "monitoring", label: "Grafana", sub: "provisioned from Git", x: 40, y: 530, w: 300, h: 90, at: 5 },
      { id: "url", kind: "chip", zone: "lan", label: "grafana.localhost:8090", sub: "anonymous, read-only", x: 500, y: 540, w: 330, h: 70, at: 5 },
      { id: "m", kind: "note", label: "`cnpg_skypulse_pipeline_posts_pending` · `…_oldest_pending_seconds`", x: 20, y: 660, w: 820, h: 70, at: 2, align: "center", size: 0.85 },
    ]}
    arrows={[
      { id: "a1", from: "q", to: "ex", zone: "data", at: 2 },
      { id: "a2", from: "ex", to: "pg", zone: "data", at: 2, label: "SQL" },
      { id: "a3", from: "pr", to: "ex", zone: "monitoring", at: 3, label: "scrape" },
      { id: "a4", from: "pr", to: "tr", zone: "monitoring", at: 4 },
      { id: "a5", from: "gr", to: "pr", zone: "monitoring", at: 5, label: "PromQL" },
      { id: "a6", from: "url", to: "gr", zone: "lan", at: 5 },
    ]}
  />
);

const Production: React.FC = () => (
  <Board
    {...fit}
    boxes={[
      { id: "ci", zone: "build", label: "CI (has internet)", sub: "build · test · push", x: 20, y: 40, w: 380, h: 96, at: 3 },
      { id: "harbor", zone: "build", label: "site registry", sub: "registry.analysts.internal", x: 460, y: 40, w: 380, h: 96, at: 3 },
      { id: "git", zone: "git", label: "Git: overlays/production", sub: "newTag: \"0.1.0\" → \"0.1.1\"", x: 20, y: 220, w: 380, h: 96, at: 0 },
      { id: "argo", zone: "git", label: "Argo CD", sub: "inside the cluster · pull-based", x: 460, y: 220, w: 380, h: 96, at: 2 },
      { id: "k", kind: "zone", zone: "platform", label: "on-prem cluster · 3 servers, embedded etcd", x: 10, y: 400, w: 840, h: 340, at: 1 },
      { id: "p1", kind: "chip", zone: "data", label: "Postgres × 3 · 50 Gi", x: 40, y: 450, w: 380, h: 60, at: 1 },
      { id: "p2", kind: "chip", zone: "analysis", label: "llm × 2 · api ≥ 3", x: 440, y: 450, w: 380, h: 60, at: 1 },
      { id: "p3", kind: "chip", zone: "lan", label: "skypulse.analysts.internal + TLS", x: 40, y: 530, w: 780, h: 60, at: 1 },
      { id: "p4", kind: "note", label: "`prune` · `selfHeal` · rollback = `git revert`", x: 40, y: 610, w: 780, h: 50, at: 4, align: "center" },
      { id: "p5", kind: "note", label: "`migrate` Job recreated on every sync (hook)", x: 40, y: 670, w: 780, h: 50, at: 5, align: "center" },
    ]}
    arrows={[
      { id: "a1", from: "ci", to: "harbor", zone: "build", at: 3, label: "push" },
      { id: "a2", from: "ci", to: "git", zone: "build", at: 3, label: "commit tag" },
      { id: "a3", from: "argo", to: "git", zone: "git", at: 2, label: "watches" },
      { id: "a4", from: "argo", to: [430, 400], zone: "git", at: 2, label: "applies" },
    ]}
  />
);

const Recap: React.FC = () => (
  <div style={{ display: "flex", gap: 60, paddingTop: 10 }}>
    <div style={{ width: 1100 }}>
      <Bullets
        w={1100}
        size={1.06}
        items={[
          { at: 0, text: "**Build** · `make build`: `uv sync --locked`, `pytest`, then `skypulse-app` for every Python role and `skypulse-llm` with the model inside.", color: ZONE.build },
          { at: 1, text: "**Start** · `make start`: k3d cluster, CloudNativePG, one login per zone, push to the registry, `kubectl apply -k`, wait for every rollout.", color: ZONE.platform },
          { at: 2, text: "**Run** · the api writes subscriptions; the ingestor turns them into posts; the analyzer claims posts with `SKIP LOCKED`, asks the LLM, writes summaries; the page reads them.", color: ZONE.analysis },
          { at: 3, text: "**Protect** · namespaces, NetworkPolicies, least-privilege roles, hardened pods, proven from inside the pods by `make verify`.", color: ZONE.ingestion },
          { at: 4, text: "**Operate** · zero-downtime rollouts, metrics computed by Postgres, and GitOps with Argo CD for a real site.", color: ZONE.monitoring },
        ]}
      />
    </div>
    <Appear at={4} from="scale" style={{ width: 600 }}>
      <div style={{ fontFamily: SANS, border: `2px solid ${C.line}`, borderRadius: 22, padding: "30px 34px", background: C.panel }}>
        <div style={{ fontSize: 22, color: C.faint, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase" }}>go deeper</div>
        {[
          ["project_explanation/01–08", "the written guide, part by part"],
          ["diagrams/", "11 annotated posters"],
          ["interactive-map/", "SkyPulse Atlas: zoom and click"],
          ["skypulse/DESIGN.md", "every decision and its trade-offs"],
        ].map(([a, b]) => (
          <div key={a} style={{ marginTop: 22 }}>
            <div style={{ fontSize: 24, color: C.accent, fontWeight: 700 }}>{a}</div>
            <div style={{ fontSize: 22, color: C.dim }}>{b}</div>
          </div>
        ))}
      </div>
    </Appear>
  </div>
);

export const DAY2: SceneDef[] = [
  {
    id: "failures", chapter: "Resilience & day 2", title: "When things break", layout: "full", View: Failures,
    beats: [
      { say: "Because the roles only meet in the database, each failure stays local. Right after a deploy, the database may not be up: every role retries, and the api reports not-ready." },
      { say: "Before `migrate` has run, the workers see missing tables or rights, and simply wait." },
      { say: "During a Postgres failover, connections break. Workers reconnect, the api's pool replaces its connections, and whatever wasn't committed is simply redone." },
      { say: "Bluesky down, or a handle that doesn't exist? It's written to `last_error` and shown in the UI; the other subscriptions carry on." },
      { say: "The LLM down? Posts stay queued and the analyzer retries every 5 seconds. Analysts still see the last summaries: the slow work is never inside their request." },
      { say: "A loop that hangs without crashing is caught by the heartbeat file and the liveness probe." },
      { say: "And an api pod or a whole node going away is handled by Kubernetes: other replicas on other nodes keep serving." },
    ],
  },
  {
    id: "rolling", chapter: "Resilience & day 2", title: "`make update`: a new version, zero downtime", View: Rolling,
    beats: [
      { say: "`make update` is `build`, `push`, `deploy`. A new unique tag means a new pod template, which means a rolling update.", code: "mk_update", focus: ["update: build push deploy"], flow: ["t1", "t2"] },
      { say: "`maxSurge: 1, maxUnavailable: 0`: Kubernetes first starts one **new** pod, while both old ones keep serving.", code: "k_api_ha", focus: ["maxSurge: 1", "maxUnavailable: 0"], hl: ["n1"] },
      { say: "The new pod gets traffic only when `/readyz` passes: it can query the migrated database. `/healthz` checks just the process, so a database outage never restarts the api.", code: "k_api_probes", focus: ["path: /readyz", "path: /healthz"], flow: ["t3"] },
      { say: "Then an old pod is told to stop. `preStop: sleep 5` gives Traefik time to stop routing to it before it shuts down.", focus: ['command: ["sleep", "5"]'], hl: ["o2t"] },
      { say: "Repeat until every pod runs the new version. Measured locally with requests running: 96 of 96 succeeded during a full `make update`.", flow: ["t4"] },
      { say: "For node maintenance, the PodDisruptionBudget keeps `kubectl drain` from taking every replica at once, and the HPA adds pods under load.", code: "k_api_ha", focus: ["minAvailable: 1", "minReplicas: 2", "maxReplicas: 5"], hl: ["pdb", "hpa"], flow: ["t5"] },
      { say: "Config changes roll out the same way, through the ConfigMap's hashed name. Schema changes must stay backward compatible, because old and new pods run side by side." },
    ],
  },
  {
    id: "monitoring", chapter: "Resilience & day 2", title: "Monitoring, from the database up", View: Monitoring,
    beats: [
      { say: "The pipeline hands work over through the database, so the database already knows whether it's healthy. The app has **no metrics code** at all." },
      { say: "`monitoring-queries.yaml` gives CloudNativePG's exporter SQL: posts ingested and analysed in the last 5 minutes, posts pending, the age of the oldest pending post.", code: "mon_queries", focus: ["posts_ingested_5m", "posts_pending", "oldest_pending_seconds"] },
      { say: "The exporter runs them as `pg_monitor`, on the primary only, and publishes each column as a metric, like `cnpg_skypulse_pipeline_posts_pending`.", focus: ["primary: true"], flow: ["a1", "a2"] },
      { say: "Prometheus finds the database pods through the Kubernetes API, with a Role that only lets it list pods, and keeps only the port named `metrics`.", code: "prom_scrape", focus: ["job_name: postgres", "cnpg.io/cluster=feeddb", "regex: metrics"], flow: ["a3"] },
      { say: "It also scrapes Traefik, which sees every analyst request: rate, errors and latency of the api, without touching the application.", focus: ["job_name: ingress", "app.kubernetes.io/name=traefik"], flow: ["a4"] },
      { say: "Grafana is provisioned from files in Git, data source and dashboard, and served at `grafana.localhost:8090`. Prometheus has no database login, so it can read counters but never posts.", code: "grafana_ds", focus: ["url: http://prometheus:9090", "editable: false"], flow: ["a5", "a6"] },
    ],
  },
  {
    id: "production", chapter: "Resilience & day 2", title: "A real site: production overlay and Argo CD", View: Production,
    beats: [
      { say: "`overlays/production` reuses the same base, with other knobs: images from the site's registry with fixed versions.", code: "overlay_prod", focus: ["- ../../base", "registry.analysts.internal/skypulse/app", 'newTag: "0.1.0"'], hl: ["git"] },
      { say: "Postgres runs three instances with 50 Gi each, the LLM two replicas, the api at least three, and the ingress gets a hostname with TLS.", focus: ["value: 3", "value: 50Gi"], hl: ["p1", "p2", "p3"] },
      { say: "It's delivered by **Argo CD**, which runs inside the cluster and keeps it in sync with `k8s/overlays/production` in Git.", code: "argocd", focus: ["path: k8s/overlays/production", "server: https://kubernetes.default.svc"], flow: ["a3", "a4"] },
      { say: "CI builds the image and pushes it to the site's registry, where the nodes pull it, then commits the new tag. Pull-based: nothing outside needs access to the cluster, which suits air-gapped sites.", flow: ["a1", "a2"] },
      { say: "`prune` deletes what was removed from Git, `selfHeal` undoes manual `kubectl` changes, and a rollback is a `git revert`.", focus: ["prune: true", "selfHeal: true"] },
      { say: "The `migrate` Job carries Argo CD hook annotations, so it's recreated on every sync: what `make deploy` does by hand.", code: "k_migrate", focus: ["argocd.argoproj.io/hook: Sync", "BeforeHookCreation"] },
    ],
  },
  {
    id: "recap", chapter: "Recap", title: "SkyPulse, every bit of it", layout: "full", View: Recap,
    beats: [
      { say: "**Build**: locked dependencies, tests, and two images." },
      { say: "**Start**: a three-node k3s cluster, an operator-managed Postgres, one database login per zone, and every manifest applied in order." },
      { say: "**Run**: four roles that never call each other. Every hand-over is a row in Postgres." },
      { say: "**Protect**: the analysis side can't reach the internet, the internet-facing side can't reach inward, and `make verify` proves both from inside the pods." },
      { say: "**Operate**: rolling updates, metrics computed by the database, GitOps for a real site. The written guide, the posters and the Atlas go deeper on every piece.", d: 9 },
    ],
  },
];
