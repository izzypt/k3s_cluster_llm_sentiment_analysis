# 6 · The security boundary: how the network requirements are implemented

Parts: [1 Overview](01-overview.md) · [2 Application](02-application.md) · [3 Build](03-build.md) · [4 Platform](04-platform.md) · [5 Delivery & operations](05-delivery-and-operations.md) · **6 Security boundary** · [7 Runtime](07-runtime.md) · [8 Code flow](08-code-flow.md)

The other parts follow the path of a change. This one follows **one requirement through every layer**, because no single file implements it: the architecture, the code, the image, the cluster and the scripts each do a share.

## 6.1 The requirement

From the brief ([`PROBLEM.md`](../PROBLEM.md), also `skypulse/DESIGN.md` §1):

| # | Requirement |
|---|---|
| S1 | Feed ingestion **may** connect to the internet |
| S2 | The analysis application may **only** access the analysts' local network |

So one component must reach the internet, and another must never reach it, while they still exchange data.

### What we're protecting against

| Threat | Why it's realistic | What must hold |
|---|---|---|
| **Data leaving the site** from the analysis side | It holds the subscriptions, posts and summaries analysts work with | The analysis zone has no route to the internet, even if a pod is compromised |
| **A compromised ingestor** pivoting inward | It talks to the internet and parses untrusted data from Bluesky: the most exposed component | The ingestor can't reach the analysis zone, the LAN, or anything in the database beyond its job |

## 6.2 The idea: zones that never talk directly

```
                 ┌─────────────── skypulse-ingestion ───────────────┐
 internet ◄─443──┤ ingestor                                         │  may reach: public internet (443), Postgres
 (public IPs     └───────────┬──────────────────────────────────────┘  may NOT reach: LAN, analysis zone
  only)                      │ 5432, role "ingestor"
                 ┌───────────▼────────── skypulse-data ─────────────┐
                 │ PostgreSQL (feeddb)  ◄── migrate Job (owner)     │  the ONLY place the zones meet
                 └───────────▲──────────────────────────────────────┘  no internet
                             │ 5432, role "analysis"
                 ┌───────────┴───────── skypulse-analysis ──────────┐
 analysts ──────►│ Traefik ─► api        analyzer ─► llm            │  may reach: Postgres, llm
 (local network) └──────────────────────────────────────────────────┘  may NOT reach: internet, ingestion zone
```

Three design choices make the boundary possible before any policy is written:

1. **Postgres is the only meeting point.** The ingestor writes posts; the analysis side reads them. There is no API call between the zones, so there is no network path to open between them. (See [2 Application › Postgres is the hub](02-application.md#21-the-central-idea-postgres-is-the-hub).)
2. **The API never needs the internet.** It validates `@handle` / `#hashtag` only by format (`targets.py`). Whether the handle exists is discovered later by the ingestor and reported back through `subscriptions.last_error`.
3. **The model is baked into the LLM image** (`docker/llm.Dockerfile`). A model downloaded at startup would need an internet hole in the analysis zone; a model inside the image needs none. The `llm` pod has **no egress at all**. (See [3 Build › The images](03-build.md#34-the-images).)

## 6.3 Layer 1: namespaces as zones

Each zone is a namespace (`k8s/base/namespaces.yaml`): `skypulse-ingestion`, `skypulse-analysis`, `skypulse-data`, `skypulse-monitoring`.

A namespace by itself **blocks no traffic**: by default every pod can reach every other pod in the cluster. Namespaces are the unit the other layers attach to: NetworkPolicies select them by label, Pod Security is enforced per namespace, and Secrets are only readable within their namespace.

## 6.4 Layer 2: NetworkPolicies, the actual network boundary

### How NetworkPolicies work

- A NetworkPolicy **selects pods** (`podSelector`) and lists what they may receive (`ingress`) and send (`egress`).
- **Once any policy selects a pod for a direction, that direction becomes deny-by-default.** Everything not explicitly allowed is dropped.
- Policies are **additive**: a pod's allowed traffic is the union of all policies that select it. There's no "deny" rule, only allow-lists.
- Kubernetes only stores policies; the **network plugin enforces them**. k3s includes an enforcing policy controller. Docker Desktop's built-in Kubernetes doesn't, which is one reason SkyPulse uses k3s (`DESIGN.md` D-9). On a cluster without enforcement, every policy here would silently do nothing.

### The pattern in every zone

```yaml
# 1. deny everything, in and out, for every pod in the namespace
kind: NetworkPolicy
metadata: { name: default-deny-all, namespace: skypulse-analysis }
spec:
  podSelector: {}                 # {} = all pods
  policyTypes: [Ingress, Egress]
---
# 2. allow DNS to CoreDNS, otherwise no pod can resolve service names
kind: NetworkPolicy
metadata: { name: allow-dns, namespace: skypulse-analysis }
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } }
          podSelector:       { matchLabels: { k8s-app: kube-dns } }
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
---
# 3. one policy per workload, opening exactly the paths it needs
```

### Reading a selector: AND vs OR

The indentation matters:

```yaml
from:
  - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: skypulse-analysis } }
    podSelector:       { matchLabels: { app.kubernetes.io/name: api } }   # same item → AND: api pods IN skypulse-analysis
  - podSelector:       { matchLabels: { app.kubernetes.io/name: migrate } } # new item → OR: migrate pods in this namespace
```

The Postgres policy relies on this: a pod labelled `app.kubernetes.io/name: api` in any *other* namespace doesn't match. `kubernetes.io/metadata.name` is a label Kubernetes sets automatically on every namespace, so it can't be forged by editing a namespace's labels to a different name.

### S2: the analysis zone (`k8s/base/analysis/networkpolicies.yaml`)

| Pod | May receive | May send |
|---|---|---|
| `api` | Traefik (kube-system), port 8000 | Postgres 5432 |
| `analyzer` | nothing | Postgres 5432, `llm` 11434 |
| `llm` | `analyzer`, 11434 | **nothing** |

There is **no `ipBlock` rule anywhere in this zone**. Every allowed destination is a pod selected by label, so no rule can match an internet address. Even `api → llm` is blocked, because the API doesn't need it.

How analysts get in: they reach Traefik (the ingress controller in `kube-system`), and only Traefik may call the API. On-prem, Traefik's load-balancer IP is placed on the analysts' VLAN only (for example with MetalLB), so "the analysts' local network" is the only way in.

### S1: the ingestion zone (`k8s/base/ingestion/networkpolicies.yaml`)

The mirror image: internet yes, local network no.

```yaml
egress:
  - to:   # the database, and nothing else in the cluster
      - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: skypulse-data } }
        podSelector:       { matchLabels: { cnpg.io/cluster: feeddb } }
    ports: [{ protocol: TCP, port: 5432 }]
  - to:   # the public internet over HTTPS, minus every private range
      - ipBlock:
          cidr: 0.0.0.0/0
          except:
            - 10.0.0.0/8
            - 172.16.0.0/12
            - 192.168.0.0/16
            - 100.64.0.0/10    # carrier-grade NAT
            - 169.254.0.0/16   # link-local (cloud metadata endpoints)
    ports: [{ protocol: TCP, port: 443 }]
ingress: []   # nothing may connect to the ingestor
```

Excluding the private ranges is what stops a compromised ingestor from scanning the LAN, the nodes or other pods: those all live in private ranges. Only port 443 is open, so it can't use other protocols either.

### The data tier (`k8s/base/data/networkpolicies.yaml`)

Postgres accepts 5432 only from the ingestor, the api, the analyzer and the migrate Job, plus replication between its own instances and the CNPG operator's health checks. Prometheus may reach port 9187 (metrics) but **not** 5432 (SQL).

Its only outbound traffic is replication and the Kubernetes API server (443/6443 on private ranges), which CNPG's instance manager uses for leader election. No internet.

### Monitoring (`k8s/base/monitoring/networkpolicies.yaml`)

Prometheus may reach only the metrics ports (Postgres 9187, Traefik 9100) and the Kubernetes API to discover pods. Grafana only talks to Prometheus. No internet, and the application zones can't reach monitoring.

## 6.5 Layer 3: database least privilege

NetworkPolicies decide *where* a pod can connect. Database grants decide *what* it can do once connected. Both zones reach the same Postgres, so this is what keeps a compromised ingestor from reading or destroying the analysis data.

| Role | Used by | Can | Can't |
|---|---|---|---|
| `ingestor` | ingestor | `SELECT (id, kind, value)` and `UPDATE (last_polled_at, last_error)` on `subscriptions`; `INSERT` on `posts` | read posts or summaries, delete anything, change the schema |
| `analysis` | api, analyzer | manage subscriptions, read/classify/delete posts, write summaries | change the schema |
| `skypulse` (owner) | migrate Job only | create tables, grant rights | – |
| `pg_monitor` | Postgres exporter | read timestamps, counters, target names | read post texts or summaries |

Where this is implemented:

- **The roles** are declared in the CNPG `Cluster` (`k8s/base/data/postgres.yaml`, `managed.roles`).
- **The passwords** are generated by `make secrets` into `.secrets/` and stored as Secrets in the data namespace (CNPG sets the password from it) **and** in the zone's own namespace (the pods log in with it). Neither zone ever holds the other's password.
- **The grants** are applied by `db.migrate()` on every deploy (`src/skypulse/db.py`, `_grant`).
- **The owner's credentials** (`feeddb-app`, generated by CNPG) are only used by the migrate Job, which runs in `skypulse-data`. Secrets can't be read across namespaces, so they never reach the application zones.

## 6.6 Layer 4: hardening every pod

If an attacker gets code running in a pod, these limit what they can do inside it:

| Setting | Where | Effect |
|---|---|---|
| `pod-security.kubernetes.io/enforce: restricted` | every namespace | Kubernetes **rejects** any pod that doesn't meet the rules below |
| `runAsNonRoot: true`, fixed UID 10001 | pod `securityContext`, Dockerfiles | No root inside the container |
| `allowPrivilegeEscalation: false` | container | No `sudo`/setuid escalation |
| `capabilities: drop: ["ALL"]` | container | No raw sockets, no network changes, no mounts |
| `readOnlyRootFilesystem: true` | container | Can't modify the application or drop tools on disk |
| `seccompProfile: RuntimeDefault` | pod | Blocks dangerous system calls |
| `automountServiceAccountToken: false` | pod | No Kubernetes API token in the pod (only Prometheus gets one, limited to reading pods in `skypulse-data` and `kube-system`) |
| `enableServiceLinks: false` | pod | No environment variables listing every Service in the namespace |

## 6.7 Verified, not assumed: `make verify`

`scripts/verify.sh` runs connection attempts **from inside the real pods**, so it tests what the workloads are actually allowed to do, not what the YAML seems to say:

| Check | Expected |
|---|---|
| api → internet (`api.bsky.app:443`) | blocked |
| analyzer → internet (`1.1.1.1:443`) | blocked |
| api → Postgres, analyzer → llm | allowed |
| api → llm | blocked |
| ingestor → internet (`api.bsky.app:443`) | allowed |
| ingestor → Postgres | allowed |
| ingestor → api, ingestor → llm | blocked |
| ingestor runs `DELETE FROM subscriptions` | permission denied |
| analysis role runs `DROP TABLE posts` | permission denied |
| `feeddb-app` Secret outside `skypulse-data` | absent |
| Prometheus → Postgres metrics / SQL / internet | allowed / blocked / blocked |
| api → Postgres metrics, api → Prometheus | blocked |

Testing "blocked" matters as much as "allowed". A policy that was never applied, or a cluster that doesn't enforce policies, would pass every "allowed" check and fail every "blocked" one.

## 6.8 Known limitations

Recorded in `skypulse/DESIGN.md` §5:

- **DNS is a theoretical side channel.** Analysis pods may query CoreDNS, which forwards external names. They can't *connect* anywhere, but data could in principle be encoded in DNS queries. For strict air-gaps: restrict CoreDNS forwarding, or use DNS-aware policies (Cilium `toFQDNs`).
- **One cluster for both zones.** The boundary depends on the cluster's network plugin and control plane being intact. Higher-assurance sites would run ingestion in a separate cluster or DMZ, with a firewall opening only the database port. The policies map one-to-one onto that design.
- **The data tier and Prometheus may reach private ranges on 443/6443** to talk to the Kubernetes API server. Its address depends on the site, so the rule is broader than strictly needed; production can narrow it to the API server's IP.
- **No analyst authentication yet.** Anyone on the analysts' network can use the UI. Production adds OIDC in front of the ingress (for example oauth2-proxy with the site's identity provider).
