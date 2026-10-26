# 7 · Runtime: what runs where

Parts: [1 Overview](01-overview.md) · [2 Application](02-application.md) · [3 Build](03-build.md) · [4 Platform](04-platform.md) · [5 Delivery & operations](05-delivery-and-operations.md) · [6 Security boundary](06-security-boundary.md) · **7 Runtime** · [8 Code flow](08-code-flow.md)

A running local SkyPulse has three layers: Docker containers created by k3d, the Kubernetes components inside each node, and the pods. This part is based on the configuration (`cluster/k3d.yaml`, the manifests and what k3s installs by default). To see the live picture:

```bash
docker ps                      # layer 1
kubectl get nodes -o wide
kubectl get pods -A -o wide    # layer 3, with the node each pod runs on
```

## 7.1 Layer 1: the Docker containers k3d creates

| Container | Image | Role |
|---|---|---|
| `k3d-skypulse-server-0` | `rancher/k3s` | **Control plane + worker**: runs `k3s server` |
| `k3d-skypulse-agent-0` | `rancher/k3s` | **Worker**: runs `k3s agent` |
| `k3d-skypulse-agent-1` | `rancher/k3s` | **Worker**: runs `k3s agent` |
| `k3d-skypulse-serverlb` | `k3d-proxy` (nginx) | Front door: maps `localhost:8090` → port 80 on the nodes, and the Kubernetes API port → the server |
| `k3d-skypulse-registry` | `registry` | Image registry: you push to `localhost:5050`, the nodes pull from it (see [3 Build › From your machine to the pods](03-build.md#from-your-machine-to-the-pods-build-push-pull)) |

The three node containers are the "machines". Each one runs containerd inside it, and **the pods are containers inside those containers**.

## 7.2 Layer 2: what runs in each node, outside of pods

The k3s binary packs the Kubernetes components into one process:

| Component | server-0 | agents |
|---|---|---|
| API server, scheduler, controller-manager | ✅ | – |
| Datastore (SQLite through kine; etcd with 3 servers) | ✅ | – |
| kubelet: starts and watches the pods on its node | ✅ | ✅ |
| containerd: the container runtime | ✅ | ✅ |
| kube-proxy: turns Services into iptables rules | ✅ | ✅ |
| flannel: the pod network between nodes | ✅ | ✅ |
| **Network policy controller**: enforces the NetworkPolicies | ✅ | ✅ |
| ServiceLB and Helm controllers | ✅ | – |

## 7.3 Layer 3: the pods

### `kube-system`: installed by k3s

| Pod | Count | What it does |
|---|---|---|
| `coredns` | 1 | Cluster DNS: resolves `feeddb-rw.skypulse-data.svc.cluster.local`. Every zone's `allow-dns` policy points here |
| `traefik` | 2 (`cluster/traefik-ha.yaml`) | Ingress controller: routes `/` to the `api` Service, `grafana.localhost` to Grafana. The only pod allowed to call the API |
| **`svclb-traefik-*`** | **1 per node** | ServiceLB, see 7.4 |
| `metrics-server` | 1 | CPU and memory per pod: feeds the **HPA** and `kubectl top` |
| `local-path-provisioner` | 1 | Creates volumes as folders on the node's disk, for Postgres and Prometheus |
| `helm-install-traefik(-crd)-*` | Completed | One-off Jobs the Helm controller used to install Traefik |

### `cnpg-system`

| Pod | What it does |
|---|---|
| `cnpg-controller-manager` | The CloudNativePG operator: watches the `Cluster` resource and creates and heals the Postgres pods, Services and failover |

### SkyPulse namespaces

| Namespace | Pod | Count | What it does |
|---|---|---|---|
| `skypulse-data` | `feeddb-1`, `feeddb-2` | 2 | Postgres primary + replica, on **different nodes** (required anti-affinity) |
| | `feeddb-1-initdb-*`, `feeddb-2-join-*` | Completed | CNPG Jobs: create the database, clone the replica |
| | `migrate-*` | Completed | `skypulse migrate`: schema + grants |
| `skypulse-analysis` | `api-*` | 2–5 | The web app, spread across nodes |
| | `analyzer-*` | 1 | Classifies posts, writes summaries |
| | `llm-*` | 1 | Ollama with the model |
| `skypulse-ingestion` | `ingestor-*` | 1 | Polls Bluesky |
| `skypulse-monitoring` | `prometheus-*`, `grafana-*` | 1 each | Metrics and dashboards |

## 7.4 `svclb`: ServiceLB

Traefik's Service is `type: LoadBalancer`. In a cloud, that would create a cloud load balancer. On bare metal and in k3s, nobody provides one, so k3s ships **ServiceLB** (also called Klipper LB):

1. For each LoadBalancer Service, ServiceLB creates a **DaemonSet**, `svclb-traefik-<hash>`, which runs one pod on every node.
2. Each pod claims **hostPort 80 and 443** on its node, and uses iptables rules to forward that traffic to the Traefik Service.
3. The Service's external IP becomes the node IPs.

The path of an analyst's request:

```
browser localhost:8090
  → k3d-skypulse-serverlb (nginx, Docker container)  :80 on any node
  → svclb-traefik pod on that node (hostPort 80, iptables)
  → traefik Service → one of the 2 traefik pods
  → api Service → one of the api pods
```

The svclb pods are tiny and do no proxying themselves: they only set up forwarding rules, which needs the `NET_ADMIN` capability. That's fine in `kube-system`, but it would be rejected in the `restricted` SkyPulse namespaces. On-prem in production, **MetalLB** usually replaces ServiceLB and gives Traefik a real IP on the analysts' VLAN.

## 7.5 Placement

Most pods go wherever the scheduler finds room. Four things are pinned on purpose:

| What | Rule | Strength |
|---|---|---|
| The 2+ API pods | `topologySpreadConstraints` across nodes | preferred (`ScheduleAnyway`) |
| The 2 Postgres instances | pod anti-affinity on `kubernetes.io/hostname` | **required** |
| The 2 Traefik pods | `topologySpreadConstraints` across nodes | required (`DoNotSchedule`) |
| svclb | DaemonSet | one on every node |

`server-0` has no taint in k3d, so it runs workloads like the agents.
