import React from "react";
import { SceneDef } from "../engine";
import { BODY, SPLIT } from "../theme";
import { Board } from "../ui/Board";

const CH = "Inside the cluster";
const fit = { w: 860, h: 758, fitW: SPLIT.visualW, fitH: BODY.h };

const Kustomize: React.FC = () => (
  <Board
    {...fit}
    boxes={[
      { id: "base", kind: "zone", zone: "build", label: "k8s/base/", x: 10, y: 24, w: 840, h: 330, at: 0 },
      { id: "ns", kind: "chip", zone: "platform", label: "namespaces.yaml", x: 40, y: 64, w: 250, h: 48, at: 0, size: 0.85 },
      { id: "d", kind: "chip", zone: "data", label: "data/ · 4 files", x: 40, y: 128, w: 250, h: 48, at: 1, size: 0.85 },
      { id: "a", kind: "chip", zone: "analysis", label: "analysis/ · 5 files", x: 40, y: 192, w: 250, h: 48, at: 1, size: 0.85 },
      { id: "i", kind: "chip", zone: "ingestion", label: "ingestion/ · 2 files", x: 40, y: 256, w: 250, h: 48, at: 1, size: 0.85 },
      { id: "m", kind: "chip", zone: "monitoring", label: "monitoring/ · 3 files", x: 310, y: 64, w: 250, h: 48, at: 1, size: 0.85 },
      { id: "env", zone: "analysis", label: "analysis/config.env", sub: "LLM_URL, PGHOST, …", x: 320, y: 150, w: 250, h: 92, at: 2, size: 0.85 },
      { id: "cm", zone: "analysis", label: "ConfigMap", sub: "analysis-config-7b5g2kt8f4", x: 580, y: 150, w: 250, h: 92, at: 2, size: 0.85 },
      { id: "ref", kind: "note", label: "every reference rewritten to the hashed name", x: 320, y: 260, w: 510, h: 70, at: 3, size: 0.85, align: "center" },
      { id: "ov", kind: "zone", zone: "lan", label: "k8s/overlays/local", x: 10, y: 400, w: 410, h: 150, at: 4 },
      { id: "ovt", kind: "note", label: "images → `localhost:5050/…`\ntag `dev`, replaced by `make deploy`", x: 30, y: 430, w: 380, h: 110, at: 4, size: 0.85 },
      { id: "op", kind: "zone", zone: "git", label: "k8s/overlays/production", x: 440, y: 400, w: 410, h: 150, at: 4 },
      { id: "opt", kind: "note", label: "site registry, fixed versions,\n3 Postgres, 2 LLMs, TLS", x: 460, y: 430, w: 380, h: 110, at: 4, size: 0.85 },
      { id: "out", zone: "platform", label: "kubectl apply -k", sub: "→ every object, in every namespace", x: 180, y: 620, w: 500, h: 100, at: 5 },
    ]}
    arrows={[
      { id: "g", from: "env", to: "cm", zone: "analysis", at: 2, label: "hash" },
      { id: "o1", from: "ov", to: "out", zone: "lan", at: 5 },
      { id: "o2", from: "base", to: [430, 400], zone: "build", at: 4, dashed: true },
    ]}
  />
);

const Controllers: React.FC = () => (
  <Board
    {...fit}
    boxes={[
      { id: "kubectl", zone: "build", label: "kubectl apply", x: 20, y: 30, w: 220, h: 80, at: 0 },
      { id: "apis", zone: "platform", label: "API server", sub: "stores objects (SQLite / etcd)", x: 300, y: 24, w: 300, h: 92, at: 0 },
      { id: "dep", zone: "analysis", label: "Deployment api", sub: "selector: name=api", x: 20, y: 180, w: 250, h: 92, at: 1 },
      { id: "rs", zone: "analysis", label: "ReplicaSet", sub: "pod template hash", x: 305, y: 180, w: 250, h: 92, at: 1 },
      { id: "hpa", zone: "analysis", label: "HPA api", sub: "2–5 replicas, CPU 70%", x: 590, y: 180, w: 250, h: 92, at: 5 },
      { id: "sched", zone: "platform", label: "scheduler", sub: "spread across nodes", x: 620, y: 24, w: 220, h: 92, at: 2 },
      { id: "na", kind: "zone", zone: "platform", label: "agent-0", x: 10, y: 340, w: 410, h: 260, at: 2 },
      { id: "nb", kind: "zone", zone: "platform", label: "agent-1", x: 440, y: 340, w: 410, h: 260, at: 2 },
      { id: "kl1", kind: "chip", zone: "platform", label: "kubelet → containerd", x: 40, y: 380, w: 350, h: 50, at: 3, size: 0.85 },
      { id: "kl2", kind: "chip", zone: "platform", label: "kubelet → containerd", x: 470, y: 380, w: 350, h: 50, at: 3, size: 0.85 },
      { id: "p1", zone: "analysis", label: "pod api-…-x7k2", sub: "label name=api", x: 70, y: 460, w: 290, h: 96, at: 2 },
      { id: "p2", zone: "analysis", label: "pod api-…-q9mz", sub: "label name=api", x: 500, y: 460, w: 290, h: 96, at: 2 },
      { id: "svc", zone: "analysis", label: "Service api", sub: "selector: name=api · port 80 → http", x: 180, y: 650, w: 500, h: 90, at: 4 },
    ]}
    arrows={[
      { id: "a0", from: "kubectl", to: "apis", zone: "build", at: 0 },
      { id: "a1", from: "dep", to: "rs", zone: "analysis", at: 1, label: "creates" },
      { id: "a2", from: "rs", to: "p1", zone: "analysis", at: 2, curve: -20 },
      { id: "a3", from: "rs", to: "p2", zone: "analysis", at: 2, curve: 20 },
      { id: "a4", from: "sched", to: "nb", zone: "platform", at: 2, dashed: true, label: "nodeName" },
      { id: "a5", from: "svc", to: "p1", zone: "analysis", at: 4 },
      { id: "a6", from: "svc", to: "p2", zone: "analysis", at: 4 },
      { id: "a7", from: "hpa", to: "dep", zone: "analysis", at: 5, curve: -60, label: "scaleTargetRef" },
    ]}
  />
);

const Postgres: React.FC = () => (
  <Board
    {...fit}
    boxes={[
      { id: "cr", zone: "data", label: "kind: Cluster · feeddb", sub: "k8s/base/data/postgres.yaml", x: 20, y: 24, w: 400, h: 96, at: 0 },
      { id: "op", zone: "data", label: "CNPG operator", sub: "cnpg-system", x: 470, y: 24, w: 370, h: 96, at: 0 },
      { id: "na", kind: "zone", zone: "platform", label: "node A", x: 10, y: 180, w: 410, h: 230, at: 1 },
      { id: "nb", kind: "zone", zone: "platform", label: "node B", x: 440, y: 180, w: 410, h: 230, at: 1 },
      { id: "p1", zone: "data", label: "feeddb-1 · primary", sub: "exporter :9187", x: 40, y: 220, w: 350, h: 92, at: 1 },
      { id: "v1", kind: "chip", zone: "data", label: "PVC 1 Gi", x: 120, y: 334, w: 190, h: 50, at: 1, size: 0.85 },
      { id: "p2", zone: "data", label: "feeddb-2 · replica", sub: "exporter :9187", x: 470, y: 220, w: 350, h: 92, at: 1 },
      { id: "v2", kind: "chip", zone: "data", label: "PVC 1 Gi", x: 550, y: 334, w: 190, h: 50, at: 1, size: 0.85 },
      { id: "rw", kind: "chip", zone: "data", label: "feeddb-rw", sub: "→ primary", x: 20, y: 450, w: 250, h: 66, at: 2 },
      { id: "ro", kind: "chip", zone: "data", label: "feeddb-ro", sub: "→ replicas", x: 300, y: 450, w: 250, h: 66, at: 2 },
      { id: "r", kind: "chip", zone: "data", label: "feeddb-r", sub: "→ any", x: 580, y: 450, w: 250, h: 66, at: 2 },
      { id: "app", zone: "build", label: "Secret feeddb-app", sub: "owner `skypulse` · only in skypulse-data", x: 20, y: 560, w: 400, h: 86, at: 3 },
      { id: "ri", kind: "chip", zone: "ingestion", label: "role ingestor", x: 470, y: 560, w: 370, h: 52, at: 4 },
      { id: "ra", kind: "chip", zone: "analysis", label: "role analysis", x: 470, y: 624, w: 370, h: 52, at: 4 },
      { id: "fo", kind: "note", label: "primary lost → replica promoted → `feeddb-rw` follows", x: 20, y: 680, w: 820, h: 60, at: 5, align: "center", size: 0.95 },
    ]}
    arrows={[
      { id: "w", from: "op", to: "cr", zone: "data", at: 0, label: "watches", labelDy: 64 },
      { id: "rep", from: "p1", to: "p2", zone: "data", at: 1, dashed: true, label: "streaming", labelDy: 60 },
      { id: "s1", from: "rw", to: "p1", zone: "data", at: 2 },
    ]}
  />
);

const PodStart: React.FC = () => (
  <Board
    {...fit}
    boxes={[
      { id: "yaml", zone: "analysis", label: "api.yaml", sub: "args: [\"api\"]", x: 20, y: 24, w: 250, h: 86, at: 0 },
      { id: "img", zone: "build", label: "image", sub: "ENTRYPOINT skypulse · CMD api", x: 300, y: 24, w: 540, h: 86, at: 1 },
      { id: "cmd", zone: "platform", label: "skypulse api", sub: "ENTRYPOINT + args (args replace CMD)", x: 160, y: 150, w: 540, h: 86, at: 1 },
      { id: "main", zone: "analysis", label: "main()", sub: "sys.argv → argparse → args.role = \"api\"", x: 160, y: 276, w: 540, h: 86, at: 2 },
      { id: "uv", zone: "analysis", label: "uvicorn.run(\"skypulse.api:app\")", sub: "only the api's modules are imported", x: 160, y: 402, w: 540, h: 86, at: 3 },
      { id: "cm", kind: "chip", zone: "analysis", label: "ConfigMap analysis-config", sub: "envFrom", x: 10, y: 540, w: 330, h: 70, at: 4 },
      { id: "sec", kind: "chip", zone: "analysis", label: "Secret analysis-db-credentials", sub: "PGUSER, PGPASSWORD", x: 10, y: 640, w: 330, h: 70, at: 5 },
      { id: "set", zone: "analysis", label: "config.Settings", sub: "frozen, read once at import", x: 420, y: 540, w: 420, h: 70, at: 4 },
      { id: "pq", zone: "data", label: "libpq → feeddb-rw:5432", sub: "connect(\"\") reads the PG* variables", x: 420, y: 640, w: 420, h: 70, at: 6 },
    ]}
    arrows={[
      { id: "a1", from: "yaml", to: "cmd", zone: "analysis", at: 1 },
      { id: "a2", from: "img", to: "cmd", zone: "build", at: 1 },
      { id: "a3", from: "cmd", to: "main", zone: "platform", at: 2 },
      { id: "a4", from: "main", to: "uv", zone: "analysis", at: 3 },
      { id: "a5", from: "cm", to: "set", zone: "analysis", at: 4 },
      { id: "a6", from: "sec", to: "pq", zone: "analysis", at: 5 },
    ]}
  />
);

const Schema: React.FC = () => (
  <Board
    {...fit}
    boxes={[
      { id: "lock", kind: "chip", zone: "build", label: "pg_advisory_lock(727274)", x: 20, y: 24, w: 400, h: 56, at: 1 },
      { id: "sm", kind: "chip", zone: "build", label: "schema_migrations", sub: "versions already applied", x: 440, y: 18, w: 400, h: 68, at: 2 },
      { id: "subs", zone: "data", label: "subscriptions", sub: "id · kind · value · created_at\nlast_polled_at · last_error", align: "left", x: 20, y: 120, w: 400, h: 140, at: 3 },
      { id: "sums", zone: "data", label: "summaries", sub: "subscription_id → · summary · overall\npositive · neutral · negative\nitem_count · window · updated_at", align: "left", x: 20, y: 290, w: 400, h: 160, at: 3 },
      { id: "posts", zone: "data", label: "posts", sub: "id · subscription_id → · uri\nauthor · text · posted_at\ningested_at · sentiment · score\n**analyzed_at** (NULL = waiting)", align: "left", x: 440, y: 120, w: 400, h: 200, at: 3 },
      { id: "idx", kind: "chip", zone: "data", label: "index posts_unanalyzed", sub: "WHERE analyzed_at IS NULL", x: 440, y: 350, w: 400, h: 70, at: 4 },
      { id: "gi", kind: "chip", zone: "ingestion", label: "ingestor", sub: "SELECT 3 cols · UPDATE 2 cols · INSERT posts", x: 20, y: 500, w: 820, h: 66, at: 5 },
      { id: "ga", kind: "chip", zone: "analysis", label: "analysis", sub: "subscriptions · posts verdicts · summaries; no DDL", x: 20, y: 584, w: 820, h: 66, at: 6 },
      { id: "gm", kind: "chip", zone: "monitoring", label: "pg_monitor", sub: "timestamps, counters, target names; never text", x: 20, y: 668, w: 820, h: 66, at: 6 },
    ]}
    arrows={[
      { id: "c1", from: "posts", to: "subs", zone: "data", at: 3 },
      { id: "c2", from: "sums", to: "subs", zone: "data", at: 3 },
    ]}
  />
);

export const CLUSTER: SceneDef[] = [
  {
    id: "kustomize", chapter: CH, title: "Kustomize: the system, described once", View: Kustomize,
    beats: [
      { say: "`k8s/base/kustomization.yaml` lists every manifest. `namespaces.yaml` comes first, so the zones exist before anything is placed in them.", code: "k_kustomize", focus: ["- namespaces.yaml"], hl: ["ns"] },
      { say: "Then the files grouped by zone: the data tier, the analysis zone, the ingestion zone and monitoring.", focus: ["# --- data tier", "# --- analysis zone", "# --- ingestion zone", "# --- monitoring"] },
      { say: "`configMapGenerator` turns `config.env` into a ConfigMap whose name carries a hash of its content, like `analysis-config-7b5g2kt8f4`.", focus: ["configMapGenerator:", "envs: [analysis/config.env]"], hl: ["env", "cm"], flow: ["g"] },
      { say: "Kustomize rewrites every reference to that name. Change one setting, the pod templates change, and Kubernetes rolls the pods by itself.", focus: ["name: analysis-config"] },
      { say: "Overlays reuse the base and change only what differs per environment. Nothing is copied." },
      { say: "`make deploy` applies its throw-away overlay on top of `overlays/local`. From here on, controllers inside the cluster take over.", flow: ["o1"] },
    ],
  },
  {
    id: "controllers", chapter: CH, title: "Controllers turn objects into running pods", View: Controllers,
    beats: [
      { say: "`kubectl apply` only **stores** objects in the API server. Everything after that is done by controllers that watch the API server and act.", code: "k_api_links", focus: ["kind: Deployment"], flow: ["a0"] },
      { say: "The Deployment controller sees `Deployment api` and creates a ReplicaSet for the current pod template. The ReplicaSet creates the pods, stamped with the template's labels.", focus: ["selector:", "template:", "app.kubernetes.io/name: api"], flow: ["a1"] },
      { say: "The scheduler picks a node for each pod. `topologySpreadConstraints` spread the api pods across nodes, so losing one node isn't an outage.", focus: ["topologySpreadConstraints:", "topologyKey: kubernetes.io/hostname"], flow: ["a2", "a3", "a4"] },
      { say: "On that node, the kubelet asks containerd to pull the image, through the registry mirror, starts the container, and keeps running its probes.", hl: ["kl1", "kl2"] },
      { say: "The Service `api` finds its pods by **label**, not by name, and only sends traffic to pods whose readiness probe passes.", focus: ["kind: Service", "selector:", "targetPort: http"], flow: ["a5", "a6"] },
      { say: "The HorizontalPodAutoscaler owns the replica count: 2 to 5, on CPU above 70%. That's why the Deployment has no `replicas:` field: every apply would reset it.", code: "k_api_ha", focus: ["kind: HorizontalPodAutoscaler", "minReplicas: 2", "maxReplicas: 5", "averageUtilization: 70"], flow: ["a6"] },
    ],
  },
  {
    id: "postgres", chapter: CH, title: "CloudNativePG builds the database", View: Postgres,
    beats: [
      { say: "Postgres isn't a hand-written StatefulSet. `postgres.yaml` declares a `kind: Cluster`: a custom resource that the CloudNativePG operator watches.", code: "k_pg_full", focus: ["kind: Cluster", "name: feeddb"], flow: ["w"] },
      { say: "From it, the operator creates **two instances**, a primary and a streaming replica, each with its own volume, and forced onto different nodes.", focus: ["instances: 2", "size: 1Gi", "podAntiAffinityType: required"], flow: ["rep"] },
      { say: "It creates three Services: `feeddb-rw` always points at the primary, `feeddb-ro` at the replicas, `feeddb-r` at any. The apps connect to `feeddb-rw`.", hl: ["rw", "ro", "r"], flow: ["s1"] },
      { say: "`initdb` creates the `skypulse` database and its owner. The owner's credentials go into a Secret, `feeddb-app`, that never leaves `skypulse-data`.", focus: ["initdb:", "owner: skypulse"], hl: ["app"] },
      { say: "`managed.roles` creates the two login roles, `ingestor` and `analysis`, with the passwords from the Secrets `make secrets` created.", focus: ["- name: ingestor", "- name: analysis", "name: ingestor-db-credentials", "name: analysis-db-credentials"], hl: ["ri", "ra"] },
      { say: "If the primary dies, the operator promotes the replica and moves `feeddb-rw` to it. The apps notice a broken connection and reconnect.", hl: ["p2", "rw"] },
    ],
  },
  {
    id: "pod-startup", chapter: CH, title: "Pod startup: from a manifest to `main()`", View: PodStart,
    beats: [
      { say: "One image runs as four components, and the role is chosen in the manifest: the api container sets `args: [\"api\"]`.", code: "k_api_args", focus: ['args: ["api"]', "image: skypulse-app"], hl: ["yaml"] },
      { say: "The container's command line is the image's `ENTRYPOINT` plus the pod's `args`, which replace the image's `CMD`. So it runs `skypulse api`.", code: "app_entry", focus: ['ENTRYPOINT ["skypulse"]', 'CMD ["api"]'], flow: ["a1", "a2"] },
      { say: "`skypulse` is the script uv created from `[project.scripts]`. It calls `main()`, and argparse reads `sys.argv`: `args.role` is `\"api\"`. Any other value exits with an error.", code: "main_role", focus: ['parser.add_argument("role"', "args = parser.parse_args()"], flow: ["a3"] },
      { say: "Each branch imports only its own modules. The api starts uvicorn with FastAPI; the ingestor never even loads FastAPI.", focus: ['if args.role == "api":', "uvicorn.run(", "from skypulse.ingestor import run"], flow: ["a4"] },
      { say: "Before any of that, importing `settings` ran `config.py`: a frozen `Settings` read from environment variables, which the ConfigMap fills through `envFrom`.", code: "config_py", focus: ["class Settings:", "settings = Settings()"], flow: ["a5"] },
      { say: "`PGUSER` and `PGPASSWORD` come from the zone's Secret through `secretKeyRef`. Passwords never sit in a ConfigMap.", code: "k_api_args", focus: ["name: PGUSER", "name: PGPASSWORD", "name: analysis-db-credentials"], flow: ["a6"] },
      { say: "`DATABASE_URL` is deliberately empty. `psycopg.connect(\"\")` hands it to libpq, which reads `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` and `PGSSLMODE` from the environment.", code: "db_connect_only", focus: ["def connect(", "An empty conninfo"], flow: ["a6"] },
      { say: "`wait_for_db()` retries every 3 seconds for up to 5 minutes, because right after a deploy the database may still be starting. So start order doesn't matter.", focus: ["def wait_for_db(", "time.sleep(3)"], hl: ["pq"] },
    ],
  },
  {
    id: "migrate", chapter: CH, title: "The migrate Job: schema and grants", View: Schema,
    beats: [
      { say: "The `migrate` Job runs `skypulse migrate` in `skypulse-data`: the only namespace with the owner's Secret, `feeddb-app`, which it receives as `DATABASE_URL`.", code: "k_migrate", focus: ['args: ["migrate"]', "name: DATABASE_URL", "name: feeddb-app"] },
      { say: "`db.migrate()` first takes a Postgres **advisory lock**, so two migrations can never run at the same time.", code: "db_migrate", focus: ["pg_advisory_lock"], hl: ["lock"] },
      { say: "`schema_migrations` records which versions ran. Each pending one runs in a transaction together with its bookkeeping row: run it twice and nothing changes.", focus: ["CREATE TABLE IF NOT EXISTS schema_migrations", "if version in applied:", "with conn.transaction():"], hl: ["sm"] },
      { say: "Migration 1 is the whole schema: `subscriptions`, `posts` and `summaries`. Deleting a subscription cascades to its posts and its summary.", code: "db_schema", focus: ["CREATE TABLE subscriptions", "CREATE TABLE posts", "CREATE TABLE summaries", "ON DELETE CASCADE"], hl: ["subs", "posts", "sums"] },
      { say: "`analyzed_at` has no default: a new post starts as NULL, meaning **waiting for analysis**. The partial index `posts_unanalyzed` holds only those rows: it's the work queue.", focus: ["analyzed_at     TIMESTAMPTZ", "CREATE INDEX posts_unanalyzed"], hl: ["posts", "idx"] },
      { say: "Then the GRANTs, on every deploy. The internet-facing ingestor may read three columns of `subscriptions`, update two, and insert posts. Nothing else.", code: "db_grants", focus: ["GRANT SELECT (id, kind, value)", "GRANT UPDATE (last_polled_at, last_error)", "GRANT INSERT ON posts"], hl: ["gi"] },
      { say: "The analysis role manages subscriptions and writes results but can't change the schema. `pg_monitor`, for metrics, reads timestamps and counters, never post texts.", focus: ["GRANT SELECT, INSERT, DELETE ON subscriptions", "GRANT UPDATE (sentiment, score, analyzed_at)", "GRANT SELECT (subscription_id, ingested_at, analyzed_at)"], hl: ["ga", "gm"] },
      { say: "`_grant` first waits for the role to exist: the operator creates it, sometimes a few seconds after the database is up.", code: "db_grant_fn", focus: ["SELECT 1 FROM pg_roles", "time.sleep(3)"] },
      { say: "Until migrate has run, the workers hit `UndefinedTable` or `InsufficientPrivilege`. They log \"schema not ready\" and retry every 5 seconds.", code: "ing_run", focus: ["psycopg.errors.UndefinedTable", "schema not ready"] },
    ],
  },
];
