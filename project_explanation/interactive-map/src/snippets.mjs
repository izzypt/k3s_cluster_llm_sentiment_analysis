// Every code excerpt the atlas can show, located in skypulse/ by anchor text (see
// ../../diagrams/src/lib.mjs: the build fails if an anchor disappears).
// id -> [file, parts, { title, marks? }]

const S = {
  // ---- entrypoint + shared modules
  main_dispatch: ["src/skypulse/__main__.py", [{ at: "def main()", to: "migrate()" }], { title: "One entrypoint, four roles" }],
  config: ["src/skypulse/config.py", [{ at: "class Settings:", to: "settings = Settings()" }], { title: "Every setting comes from an environment variable" }],
  db_connect: ["src/skypulse/db.py", [{ at: "def connect(", n: 3 }, { at: "def wait_for_db(", to: "time.sleep(3)" }], { title: "Connect, retrying while the database starts" }],
  db_schema: ["src/skypulse/db.py", [{ at: "CREATE TABLE subscriptions", to: "CREATE INDEX posts_by_subscription" }, { at: "CREATE TABLE summaries", to: "updated_at      TIMESTAMPTZ" }], { title: "Migration 1: the whole schema" }],
  db_migrate: ["src/skypulse/db.py", [{ at: "def migrate()", n: 1 }, { at: "with wait_for_db() as conn:", to: 'conn.execute("INSERT INTO schema_migrations' }], { title: "Idempotent, serialized migrations" }],
  db_grants: ["src/skypulse/db.py", [{ at: "# The internet-facing ingestor may only", to: "finally:" }], { title: "Least-privilege GRANTs per role" }],
  db_heartbeat: ["src/skypulse/db.py", [{ at: "def heartbeat()", to: "fh.write" }], { title: "Heartbeat for the liveness probe" }],

  // ---- api + browser
  api_pool: ["src/skypulse/api.py", [{ at: "pool = ConnectionPool(", to: "pool.close()" }], { title: "A connection pool that survives failovers" }],
  api_list: ["src/skypulse/api.py", [{ at: "_LIST_SQL = ", to: "return rows" }], { title: "GET /api/subscriptions: one read query" }],
  api_subscribe: ["src/skypulse/api.py", [{ at: '@app.post("/api/subscriptions"', to: 'return {"id": row["id"]' }], { title: "POST /api/subscriptions" }],
  api_unsubscribe: ["src/skypulse/api.py", [{ at: '@app.delete("/api/subscriptions', to: "return Response(status_code=204)" }], { title: "DELETE /api/subscriptions/{id}" }],
  api_probes: ["src/skypulse/api.py", [{ at: '@app.get("/healthz")', to: 'return {"status": "ready"}' }], { title: "Liveness and readiness" }],
  targets_parse: ["src/skypulse/targets.py", [{ at: "def parse_target(", to: "return Target(kind=kind, value=value)" }], { title: "Validate @handle / #hashtag (shape only)" }],
  web_submit: ["src/skypulse/static/index.html", [{ at: '$("#add").addEventListener', to: "refresh();" }], { title: "The subscribe form", lang: "javascript" }],
  web_refresh: ["src/skypulse/static/index.html", [{ at: "async function refresh()", n: 10 }, { at: "setInterval(refresh", n: 1 }], { title: "Poll the api every 10 s", lang: "javascript" }],

  // ---- ingestor
  ing_poll: ["src/skypulse/ingestor.py", [{ at: "def poll_once(", to: 'log.info("%s %s: %d new posts"' }], { title: "One polling round" }],
  ing_run: ["src/skypulse/ingestor.py", [{ at: "def run()", to: "time.sleep(settings.poll_interval_seconds)" }], { title: "The ingestor loop and its failure handling" }],
  bsky_fetch: ["src/skypulse/bluesky.py", [{ at: "def fetch(self", to: "return parse(resp.json())" }], { title: "Call the public Bluesky API" }],
  bsky_parse: ["src/skypulse/bluesky.py", [{ at: "def parse_post_view(", to: "return [p for p in" }], { title: "Keep only posts with text, skip reposts" }],

  // ---- analyzer + llm
  an_claim: ["src/skypulse/analyzer.py", [{ at: "def analyze_one(", to: "return True" }], { title: "Claim one post with SKIP LOCKED, classify it" }],
  an_stale: ["src/skypulse/analyzer.py", [{ at: "_STALE_SUMMARIES = ", to: "ORDER BY s.id" }], { title: "Which summaries need refreshing?" }],
  an_refresh: ["src/skypulse/analyzer.py", [{ at: "def refresh_summary(", to: 'log.info("summary refreshed' }], { title: "Refresh one summary" }],
  an_work: ["src/skypulse/analyzer.py", [{ at: "def work_once(", to: "return did_work" }], { title: "One round of work" }],
  an_run: ["src/skypulse/analyzer.py", [{ at: "def run()", to: "if not did_work:" }, { at: "time.sleep(5)", n: 1 }], { title: "The analyzer loop and its failure handling" }],
  llm_classify: ["src/skypulse/llm.py", [{ at: "_CLASSIFY_SCHEMA = {", n: 8 }, { at: "def classify(self", n: 3 }], { title: "Structured output: a JSON schema" }],
  llm_chat: ["src/skypulse/llm.py", [{ at: "def _chat(self", to: 'return resp.json()["message"]["content"].strip()' }], { title: "POST /api/chat to Ollama" }],
  llm_parse: ["src/skypulse/llm.py", [{ at: "def parse_classification(", to: "return label, score" }], { title: "Defensive parsing of the model's answer" }],
  llm_summarize: ["src/skypulse/llm.py", [{ at: "def summarize(self", to: "return self._chat(_SUMMARY_SYSTEM" }], { title: "The summary prompt" }],
  llm_overall: ["src/skypulse/llm.py", [{ at: "def overall_label(", to: 'return "mixed" if' }], { title: "Overall label from the scores" }],
  llm_model: ["src/skypulse/llm.py", [{ at: "def model(self)", to: "return self._model" }], { title: "Discover the baked-in model" }],

  // ---- kubernetes: workloads
  k_api_container: ["k8s/base/analysis/api.yaml", [{ at: "- name: api", to: "key: password" }], { title: "Role, settings and login of the api pods" }],
  k_api_probes: ["k8s/base/analysis/api.yaml", [{ at: "readinessProbe:", to: 'command: ["sleep", "5"]' }], { title: "Probes and graceful shutdown" }],
  k_api_ha: ["k8s/base/analysis/api.yaml", [{ at: "strategy:", n: 5 }, { at: "kind: PodDisruptionBudget", to: "averageUtilization: 70" }], { title: "Zero-downtime rollout, PDB, autoscaling" }],
  k_ingress: ["k8s/base/analysis/ingress.yaml", [{ at: "kind: Ingress", to: "name: http" }], { title: "Ingress: every other hostname → api" }],
  k_grafana_ingress: ["k8s/base/monitoring/grafana.yaml", [{ at: "kind: Ingress", to: "name: http" }], { title: "Ingress: grafana.localhost → Grafana" }],
  k_analyzer: ["k8s/base/analysis/analyzer.yaml", [{ at: "- name: analyzer", to: "initialDelaySeconds" }], { title: "The analyzer Deployment" }],
  k_ingestor: ["k8s/base/ingestion/ingestor.yaml", [{ at: "- name: ingestor", to: "initialDelaySeconds" }], { title: "The ingestor Deployment" }],
  k_llm: ["k8s/base/analysis/llm.yaml", [{ at: "- name: ollama", to: "failureThreshold: 6" }], { title: "The LLM Deployment" }],
  k_pg: ["k8s/base/data/postgres.yaml", [{ at: "kind: Cluster", to: "podAntiAffinityType: required" }], { title: "A replicated PostgreSQL in ~30 lines" }],
  k_migrate: ["k8s/base/data/migrate.yaml", [{ at: "kind: Job", to: "key: uri" }], { title: "The migrate Job" }],
  k_namespaces: ["k8s/base/namespaces.yaml", [{ at: "name: skypulse-analysis", n: 5 }, { at: "name: skypulse-ingestion", n: 5 }], { title: "Zones with the restricted Pod Security level" }],
  k_prom: ["k8s/base/monitoring/prometheus.yaml", [{ at: "kind: Role", to: "verbs: [get, list, watch]" }], { title: "Prometheus may only list pods" }],
  k_grafana: ["k8s/base/monitoring/grafana.yaml", [{ at: "- name: grafana", to: "GF_AUTH_ANONYMOUS_ORG_ROLE" }], { title: "Grafana: anonymous, read-only" }],
  k_config_analysis: ["k8s/base/analysis/config.env", [{ at: "LOG_LEVEL=INFO", to: "PGSSLMODE=require" }], { title: "analysis-config (ConfigMap source)" }],
  k_config_ingestor: ["k8s/base/ingestion/config.env", [{ at: "LOG_LEVEL=INFO", to: "PGSSLMODE=require" }], { title: "ingestor-config (ConfigMap source)" }],
  k_kustomize: ["k8s/base/kustomization.yaml", [{ at: "resources:", to: "files: [monitoring/config/prometheus.yml]" }], { title: "The base: everything, described once" }],

  // ---- network policies
  np_deny: ["k8s/base/analysis/networkpolicies.yaml", [{ at: "name: default-deny-all", n: 6 }, { at: "name: allow-dns", to: "port: 53 }" }], { title: "Step 1 and 2 in every zone: deny all, allow DNS" }],
  np_api: ["k8s/base/analysis/networkpolicies.yaml", [{ at: "  name: api", to: "port: 5432 }" }], { title: "NetworkPolicy: api" }],
  np_analyzer: ["k8s/base/analysis/networkpolicies.yaml", [{ at: "  name: analyzer", to: "port: 11434 }" }], { title: "NetworkPolicy: analyzer" }],
  np_llm: ["k8s/base/analysis/networkpolicies.yaml", [{ at: "  name: llm", to: "egress: []" }], { title: "NetworkPolicy: llm" }],
  np_ingestor: ["k8s/base/ingestion/networkpolicies.yaml", [{ at: "  name: ingestor", to: "port: 443 }" }], { title: "NetworkPolicy: ingestor" }],
  np_pg: ["k8s/base/data/networkpolicies.yaml", [{ at: "  name: postgres", to: "port: 9187 }" }], { title: "NetworkPolicy: postgres (who may connect)" }],
  np_pg_egress: ["k8s/base/data/networkpolicies.yaml", [{ at: "# The CNPG instance manager talks to the Kubernetes API", to: "port: 6443 }" }], { title: "Postgres → Kubernetes API" }],
  np_migrate: ["k8s/base/data/networkpolicies.yaml", [{ at: "  name: migrate", to: "port: 5432 }" }], { title: "NetworkPolicy: migrate" }],
  np_grafana: ["k8s/base/monitoring/networkpolicies.yaml", [{ at: "  name: grafana", to: "port: 9090 }" }], { title: "NetworkPolicy: grafana" }],
  np_prom: ["k8s/base/monitoring/networkpolicies.yaml", [{ at: "  name: prometheus", to: "port: 6443 }" }], { title: "NetworkPolicy: prometheus" }],

  // ---- monitoring config
  mon_queries: ["k8s/base/data/monitoring-queries.yaml", [{ at: "skypulse_pipeline:", to: "primary: true" }], { title: "Pipeline metrics computed by PostgreSQL" }],
  prom_scrape: ["k8s/base/monitoring/config/prometheus.yml", [{ at: "scrape_configs:", to: "relabel_configs: *keep-metrics-port" }], { title: "What Prometheus scrapes" }],
  grafana_ds: ["k8s/base/monitoring/config/grafana-datasources.yaml", [{ at: "datasources:", to: "editable: false" }], { title: "Datasource provisioned from Git" }],

  // ---- platform, build, delivery
  k3d: ["cluster/k3d.yaml", [{ at: "servers: 1", to: "- http://k3d-skypulse-registry:5000" }], { title: "The local cluster" }],
  traefik_ha: ["cluster/traefik-ha.yaml", [{ at: "kind: HelmChartConfig", to: "app.kubernetes.io/name: traefik" }], { title: "Traefik with 2 replicas" }],
  mk_start: ["Makefile", [{ at: "start: check-tools", n: 1 }, { at: "cluster: ## Create", to: "kubectl apply -f cluster/traefik-ha.yaml" }, { at: "operator: ## Install", n: 3 }], { title: "make start: cluster + operator" }],
  mk_build: ["Makefile", [{ at: "build: check-tools", to: '@echo "Built' }], { title: "make build" }],
  mk_secrets: ["Makefile", [{ at: "secrets: ## Create", to: "cnpg.io/reload=true" }, { at: "done", n: 1 }], { title: "make secrets: one login per zone" }],
  mk_push: ["Makefile", [{ at: "push: ## Push", n: 4 }], { title: "make push" }],
  mk_deploy: ["Makefile", [{ at: "deploy: ## Apply", to: "rollout status deployment/grafana" }], { title: "make deploy" }],
  app_dockerfile: ["docker/app.Dockerfile", [{ at: "FROM python:${PYTHON_VERSION}-slim-bookworm AS build", to: 'CMD ["api"]' }], { title: "One image for every Python role" }],
  llm_dockerfile: ["docker/llm.Dockerfile", [{ at: "ARG OLLAMA_VERSION=", to: "EXPOSE 11434" }], { title: "Ollama with the model baked in" }],
  verify: ["scripts/verify.sh", [{ at: 'echo "== Security boundary: analysis zone', to: 'expect blocked "ingestor -> llm' }], { title: "make verify: tested from inside the pods" }],
  argocd: ["deploy/argocd/application.yaml", [{ at: "kind: Application", to: "selfHeal: true" }], { title: "Production: Argo CD" }],
};

export default S;
