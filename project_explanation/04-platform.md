# 4 · Platform: where and how it runs

Parts: [1 Overview](01-overview.md) · [2 Application](02-application.md) · [3 Build](03-build.md) · **4 Platform** · [5 Delivery & operations](05-delivery-and-operations.md) · [6 Security boundary](06-security-boundary.md) · [7 Runtime](07-runtime.md) · [8 Code flow](08-code-flow.md)

Files: `skypulse/cluster/` (the cluster) and `skypulse/k8s/base/` (everything that runs on it).

## 4.1 The cluster: k3s in Docker (`cluster/k3d.yaml`)

- **k3s** is a lightweight, CNCF-certified Kubernetes distribution used on-prem and at the edge. It includes an ingress controller (Traefik), a load balancer, local storage, metrics-server and **NetworkPolicy enforcement**, which the security zones depend on.
- **k3d** runs k3s nodes as Docker containers: 1 server + 2 agents, plus a private image registry on `localhost:5050`. Port 8090 on your machine reaches the ingress.
- **`cluster/traefik-ha.yaml`** raises Traefik from 1 to 2 replicas spread across nodes. Every analyst request goes through it, so with one replica it was a single point of failure even though the API runs 2+.

### One control plane locally, three in production

A single server is a single point of failure for the control plane. If it dies, running pods keep serving, but nothing is rescheduled, Service endpoints stop updating, CNPG can't fail over and `kubectl` stops working.

Locally that's accepted on purpose: every "node" is a container on the same machine, so **the laptop is the real single point of failure**. Three servers would only add memory without adding availability. The 2 agents are there to test what does matter locally: pod spreading, PodDisruptionBudgets and node drains.

Production runs **3 servers with embedded etcd** behind an API VIP:

- **etcd** is the database holding all cluster state. A single k3s server uses SQLite instead, which is a local file and can't be shared between servers.
- **Embedded** is k3s's term: etcd runs inside the k3s process on each server. (kubeadm's equivalent, "stacked etcd", runs it as a separate static pod on each control-plane node.)
- **Quorum:** etcd uses the Raft algorithm, and a write only counts once a **majority** of members store it: `quorum = floor(n/2) + 1`. A majority prevents split brain: in a network split only one side can have it.

| Members | Quorum | Failures tolerated |
|---|---|---|
| 1 | 1 | 0 |
| 2 | 2 | **0** |
| 3 | 2 | 1 |
| 5 | 3 | 2 |

So control planes come in odd numbers: 2 is worse than 1, and 4 tolerates no more than 3. Losing quorum freezes the cluster (no writes), but running pods keep running. Only control-plane members count; workers can come and go.

## 4.2 `k8s/base/`: the system, described once

`k8s/base/kustomization.yaml` lists every manifest, grouped by zone, and adds two things:

- **A common label** `app.kubernetes.io/part-of: skypulse` on every object and pod.
- **Generated ConfigMaps** from `config.env` and the monitoring config files. Each name gets a hash of its content (`analysis-config-7b5g2kt8f4`), and Kustomize rewrites every reference. A config change therefore changes the pod template and triggers a rolling update automatically.

The base is environment-independent. What differs per environment lives in the overlays: see [5 Delivery › Overlays](05-delivery-and-operations.md#52-overlays-one-base-several-environments).

## 4.3 How Kubernetes objects link together

Kubernetes uses three different mechanisms:

| Link | Mechanism | Example in `k8s/base/analysis/api.yaml` |
|---|---|---|
| Object → namespace | `metadata.namespace` | `namespace: skypulse-analysis` |
| Object → pods | **labels + selector** | Deployment, Service and PDB select `app.kubernetes.io/name: api` |
| Object → named object | name reference | HPA `scaleTargetRef: {kind: Deployment, name: api}` |

### Namespace: `metadata.namespace`

A single key places an object in a namespace. It must match `metadata.name` of a Namespace object (`k8s/base/namespaces.yaml`):

```yaml
kind: Deployment
metadata:
  name: api
  namespace: skypulse-analysis   # ← the link
```

- **The Namespace must exist first**, otherwise the apply fails with "namespace not found". That's why `namespaces.yaml` is the first resource in the kustomization, and why `make secrets` applies it on its own first.
- **Pods inherit it.** The pod template has no namespace field, so the ReplicaSet and pods land in the same namespace.
- **Without the key**, the object goes into kubectl's current namespace, usually `default`. SkyPulse sets it explicitly everywhere.
- **Name references stay inside the namespace.** `name: api` never crosses namespaces.

### Labels and selectors: object → pods

```yaml
# Deployment
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: api      # "the pods I manage are the ones with this label"
  template:
    metadata:
      labels:
        app.kubernetes.io/name: api    # the label every pod is created with
---
# Service: send traffic to pods with this label
selector:
  app.kubernetes.io/name: api
---
# PodDisruptionBudget: protect pods with this label during a drain
selector:
  matchLabels:
    app.kubernetes.io/name: api
```

A selector only searches **inside its own namespace**. The namespace limits where it looks; the labels choose which pods inside it match.

### Namespace labels

Namespaces have labels too:

```yaml
kind: Namespace
metadata:
  name: skypulse-analysis
  labels:
    skypulse.io/zone: analysis
    pod-security.kubernetes.io/enforce: restricted
```

- **NetworkPolicies** match them with a `namespaceSelector` to refer to pods in another namespace, for example `kubernetes.io/metadata.name: kube-system` for DNS.
- **Pod Security:** `pod-security.kubernetes.io/enforce: restricted` makes Kubernetes reject any pod in the namespace that runs as root, can escalate privileges, keeps Linux capabilities, and so on. That's why every container sets `runAsNonRoot`, `allowPrivilegeEscalation: false` and `capabilities: drop: ["ALL"]`.

## 4.4 The security boundary: NetworkPolicies

This is a summary. [6 Security boundary](06-security-boundary.md) explains the requirement, how NetworkPolicies work, every layer and the known limitations in full.

NetworkPolicies are allow-lists. Each zone starts with `default-deny-all` (no traffic in or out for any pod), then every further policy opens exactly one required path. Every zone also gets `allow-dns` to CoreDNS.

| Zone | Allowed in | Allowed out |
|---|---|---|
| **analysis** `api` | from Traefik, port 8000 | Postgres 5432 |
| **analysis** `analyzer` | nothing | Postgres 5432, `llm` 11434 |
| **analysis** `llm` | from analyzer, 11434 | **nothing** (model is in the image) |
| **ingestion** `ingestor` | nothing | Postgres 5432; internet on 443, **except private ranges** (10/8, 172.16/12, 192.168/16, …) |
| **data** Postgres | ingestor, api, analyzer, migrate on 5432; replicas + operator; Prometheus on 9187 only | other instances; the Kubernetes API server (private range) |

The result: the analysis zone can't reach the internet, and the internet-facing ingestor can't reach the local network. `make verify` proves this by opening real connections from inside the pods.

Network policies limit *where* a pod can connect. **Database grants** limit *what* it can do once connected: each zone logs in as its own role (`ingestor`, `analysis`) with only the table rights it needs (see [2 Application › Patterns](02-application.md#26-patterns-that-make-it-kubernetes-friendly)).

## 4.5 PostgreSQL: CloudNativePG

Postgres isn't run with a hand-written StatefulSet. The **CloudNativePG operator** (installed by `make operator`) watches a custom resource, `kind: Cluster` (`k8s/base/data/postgres.yaml`), and from ~30 lines creates:

- **2 instances** (1 primary + 1 streaming replica), forced onto different nodes (`podAntiAffinityType: required`), each with its own volume.
- **Services:** `feeddb-rw` (always the primary), `feeddb-ro` (replicas), `feeddb-r` (any). The apps connect to `feeddb-rw.skypulse-data.svc.cluster.local`.
- **Automatic failover:** if the primary dies, the replica is promoted and `feeddb-rw` follows it. The apps reconnect (see their retry loops).
- **Roles:** `ingestor` and `analysis` login roles, with passwords from Secrets created by `make secrets`.
- **The owner Secret** `feeddb-app`, used only by the `migrate` Job, so it never leaves `skypulse-data`.
- **Metrics** on port 9187, including SkyPulse's own SQL queries (backlog, summary age, ingest errors) from `monitoring-queries.yaml`.

`migrate` (`k8s/base/data/migrate.yaml`) is a **Job**, not a Deployment: it runs `skypulse migrate` once per deploy, applies the schema and the grants, and exits.

## 4.6 Workloads and high availability

| Workload | Kind | Replicas | Probes |
|---|---|---|---|
| `api` | Deployment | 2–5 (HPA) | readiness `/readyz`, liveness `/healthz` |
| `analyzer` | Deployment | 1 | liveness: heartbeat file younger than 10 min |
| `ingestor` | Deployment | 1 | liveness: heartbeat file |
| `llm` | Deployment | 1 (2 in production) | – |
| `migrate` | Job | runs to completion | – |
| Postgres | CNPG Cluster | 2 (3 in production) | managed by the operator |

**HA vs HPA:**

- **HA (High Availability)** is a goal, not an object: the system keeps working when a part fails. You get it through redundancy.
- **HPA (HorizontalPodAutoscaler)** is an object that adds or removes replicas based on load (CPU above 70% for `api`). Its minimum of 2 also helps HA.

The API is the component analysts depend on, so it gets the full HA toolbox (`api.yaml`):

| Tool | What it does |
|---|---|
| ≥ 2 replicas + `topologySpreadConstraints` | Replicas on different nodes, so losing one node isn't an outage |
| Readiness probe | A pod only gets traffic once it can query the database |
| `RollingUpdate` with `maxUnavailable: 0` | New pods start and become ready before old ones stop: zero-downtime updates |
| `preStop: sleep 5` | Gives the ingress time to stop routing to a terminating pod |
| PodDisruptionBudget `minAvailable: 1` | `kubectl drain` can never take all replicas down at once |
| No `replicas:` in the Deployment | The HPA owns the number; otherwise every `kubectl apply` would reset it |

The analyzer, ingestor and LLM run 1 replica locally because analysts never wait on them: if one restarts, summaries are just a little late.

## 4.7 Configuration and secrets

| What | Source | Reaches the pod as |
|---|---|---|
| Settings (`LLM_URL`, `PGHOST`, poll interval, …) | `k8s/base/*/config.env` → generated ConfigMap | `envFrom: configMapRef` |
| Zone DB login | `make secrets` → `<role>-db-credentials` Secret, in the data namespace **and** the zone's namespace | `PGUSER` / `PGPASSWORD` via `secretKeyRef` |
| Owner DB login | CNPG → `feeddb-app` Secret | `DATABASE_URL`, only in the `migrate` Job |

All of it becomes environment variables, which `config.py` reads. The application never knows it's running in Kubernetes.

## 4.8 Monitoring (`k8s/base/monitoring/`)

- **Prometheus** discovers pods through the Kubernetes API, scoped by RBAC Roles to the namespaces it scrapes. It scrapes the Postgres exporters (including SkyPulse's custom queries) and Traefik, so the app needs no metrics code.
- **Grafana** is provisioned from files (data source + the SkyPulse dashboard) and served at `http://grafana.localhost:8090`.
- Both run in `skypulse-monitoring`, whose NetworkPolicies let Prometheus reach **only the metrics ports**. It has no database login, so it can read counters and timestamps but never post texts.
