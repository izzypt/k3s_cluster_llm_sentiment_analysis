# `skypulse-monitoring`: metrics and dashboards (read-only)

Zones: [index](../README.md) · [outside](../outside/README.md) · [your machine](../your-machine/README.md) · [ingestion](../ingestion/README.md) · [data](../data/README.md) · [analysis](../analysis/README.md) · **monitoring** · [system](../system/README.md)

## What this namespace does

It shows operators whether SkyPulse is healthy: is the pipeline moving, are summaries fresh, are analysts' requests fast and successful?

The guiding rule: **it reads metrics and nothing else**. It never touches the database's SQL port, never calls application ports, and never reaches the internet. The application zones can't reach it either. Losing it never affects analysts: you only lose a few minutes of graphs.

It also adds **no code to the application**. Every metric comes from two places that already see everything (DESIGN.md D-11):

- **the database**, which knows the backlog, summary age and failing subscriptions, because the pipeline hands work over through it;
- **Traefik**, which sees every analyst request: rate, errors and latency.

| Component | Kind | Replicas | Code |
|---|---|---|---|
| Prometheus | Deployment + Service + PVC (2 Gi) + ServiceAccount/RBAC | 1 | [`prometheus.yaml`](../../../skypulse/k8s/base/monitoring/prometheus.yaml) · [`config/prometheus.yml`](../../../skypulse/k8s/base/monitoring/config/prometheus.yml) |
| Grafana | Deployment + Service + Ingress | 1 | [`grafana.yaml`](../../../skypulse/k8s/base/monitoring/grafana.yaml) · [`config/`](../../../skypulse/k8s/base/monitoring/config/) |

## The rules it follows

### Network ([`monitoring/networkpolicies.yaml`](../../../skypulse/k8s/base/monitoring/networkpolicies.yaml))

| Workload | In | Out |
|---|---|---|
| Grafana | Traefik only, port 3000 ([L47-L56](../../../skypulse/k8s/base/monitoring/networkpolicies.yaml#L47-L56)) | Prometheus :9090 only ([L57-L63](../../../skypulse/k8s/base/monitoring/networkpolicies.yaml#L57-L63)) |
| Prometheus | Grafana only, port 9090 ([L75-L81](../../../skypulse/k8s/base/monitoring/networkpolicies.yaml#L75-L81)) | DB exporters :9187 ([L83-L91](../../../skypulse/k8s/base/monitoring/networkpolicies.yaml#L83-L91)), Traefik metrics :9100 ([L92-L100](../../../skypulse/k8s/base/monitoring/networkpolicies.yaml#L92-L100)), Kubernetes API on private ranges for Pod discovery ([L103-L109](../../../skypulse/k8s/base/monitoring/networkpolicies.yaml#L103-L109)) |

Data-side counterpart: the database accepts Prometheus on :9187 **only**, never on :5432 ([`data/networkpolicies.yaml` L85-L93](../../../skypulse/k8s/base/data/networkpolicies.yaml#L85-L93)). Prometheus has no database login at all.

### Kubernetes API access: the narrowest possible

Prometheus is **the only SkyPulse Pod with a Kubernetes API token**, because it has to discover Pods. Its two Roles allow `get, list, watch` on **Pods**, in **two namespaces only**: `skypulse-data` and `kube-system` ([`prometheus.yaml` L8-L60](../../../skypulse/k8s/base/monitoring/prometheus.yaml#L8-L60)). It can't read Secrets or ConfigMaps, or see any other namespace.

### What the metrics can reveal

The exporter runs SkyPulse's queries as `pg_monitor`. The migrate Job grants that role **only timestamps, counters and target names**, never post texts or summaries ([`db.py` L127-L133](../../../skypulse/src/skypulse/db.py#L127-L133)). So even the monitoring data contains no content.

## The components

### Prometheus

Collects metrics every **30 s** and keeps them for **15 days**, capped at 1.5 GB on a 2 Gi volume ([`prometheus.yaml` L106-L110](../../../skypulse/k8s/base/monitoring/prometheus.yaml#L106-L110)).

**How it finds targets** ([`config/prometheus.yml`](../../../skypulse/k8s/base/monitoring/config/prometheus.yml)). It asks the Kubernetes API for Pods with given labels, and keeps only the container port **named `metrics`**. When a Pod is replaced (rolling update, failover), the new one is picked up automatically.

| Job | Finds | Scrapes | Gives you |
|---|---|---|---|
| `postgres` ([L12-L27](../../../skypulse/k8s/base/monitoring/config/prometheus.yml#L12-L27)) | `skypulse-data` Pods labelled `cnpg.io/cluster=feeddb, podRole=instance` | Every DB instance on :9187 | PostgreSQL health (up, replication lag, connections, size) + SkyPulse metrics from [`monitoring-queries.yaml`](../../../skypulse/k8s/base/data/monitoring-queries.yaml): `posts_pending`, `oldest_pending_seconds`, `posts_ingested_5m`, `posts_analyzed_5m`, per-subscription `summary_age_seconds`, `seconds_since_poll`, `failing` |
| `ingress` ([L31-L39](../../../skypulse/k8s/base/monitoring/config/prometheus.yml#L31-L39)) | `kube-system` Pods labelled `app.kubernetes.io/name=traefik` | Both Traefik Pods on :9100 | Request rate, 5xx ratio, p95 latency of the analysts' requests |

**Deployment details:**

- `strategy: Recreate` ([L84](../../../skypulse/k8s/base/monitoring/prometheus.yaml#L84)): the volume can be mounted by only one Pod at a time, so the old Pod stops before the new one starts.
- Runs as `nobody` (65534), with `fsGroup` so the volume is writable.
- Read-only root filesystem.

### Grafana

Dashboards at **http://grafana.localhost:8090** (browsers resolve `*.localhost` to your own machine, so no `/etc/hosts` edit is needed).

- **Configured by files in Git, not by clicking** ([`grafana.yaml` L1-L7](../../../skypulse/k8s/base/monitoring/grafana.yaml#L1-L7)). The Prometheus data source ([`grafana-datasources.yaml`](../../../skypulse/k8s/base/monitoring/config/grafana-datasources.yaml)) and the SkyPulse dashboard ([`skypulse-dashboard.json`](../../../skypulse/k8s/base/monitoring/config/skypulse-dashboard.json)) come from a generated ConfigMap. A restarted Pod looks exactly the same, so Grafana is stateless and needs no volume.
- **`access: proxy`**: Grafana's server queries Prometheus; the browser never talks to Prometheus directly.
- **Read-only, anonymous access** ([L43-L47](../../../skypulse/k8s/base/monitoring/grafana.yaml#L43-L47)): everyone is a Viewer, with no login form and no admin in use. Fine on a laptop; production needs SSO in front (§5 #8).
- **Air-gap friendly** ([L51-L56](../../../skypulse/k8s/base/monitoring/grafana.yaml#L51-L56)): plugin installs, analytics, update checks and the news feed are disabled. They'd be blocked anyway.
- **Startup probe** with up to 3 minutes for the first start, while Grafana builds its internal database.
- Reached through Traefik via the `grafana` Ingress (host `grafana.localhost`, [L119-L137](../../../skypulse/k8s/base/monitoring/grafana.yaml#L119-L137)). Production uses `grafana.analysts.internal`.

## How it handles failure

| What happens | Effect |
|---|---|
| Prometheus or Grafana down | A gap in the graphs; **no effect on analysts** |
| Database failover | The new primary takes over the SkyPulse queries (`primary: true`); the graphs continue |
| Node with Prometheus's volume drained | Prometheus waits for that node (node-local storage) |

Accepted trade-offs (D-11): one replica each, no alert notifications yet, no Pod CPU/memory/restart metrics (use `kubectl top` / `make status`), no central logs.

## What `make verify` proves here ([`verify.sh` L86-L101](../../../skypulse/scripts/verify.sh#L86-L101))

- ✅ Prometheus → database metrics (:9187) **allowed**
- ❌ Prometheus → database SQL (:5432) **blocked**
- ❌ Prometheus → internet **blocked**
- ❌ api → database metrics **blocked**; ❌ api → Prometheus **blocked**
- ✅ Prometheus actually scrapes **every** expected target (all DB instances + both Traefik Pods)

## Design decisions behind it

[`skypulse/DESIGN.md`](../../../skypulse/DESIGN.md) D-11: why metrics come from the database and the ingress, and why plain manifests rather than kube-prometheus-stack locally. Production path (§4): the site's shared monitoring or kube-prometheus-stack, HA Prometheus, Alertmanager, Grafana behind SSO, Loki for logs.
