# `kube-system`: the platform underneath

Zones: [index](../README.md) · [outside](../outside/README.md) · [your machine](../your-machine/README.md) · [ingestion](../ingestion/README.md) · [data](../data/README.md) · [analysis](../analysis/README.md) · [monitoring](../monitoring/README.md) · **system**

## What this namespace does

`kube-system` holds the components that **came with k3s**, the Kubernetes distribution SkyPulse runs on. SkyPulse doesn't own this namespace and changes only one thing in it (Traefik's replica count). But every request, every name lookup, every volume and every NetworkPolicy depends on what runs here, so it's worth knowing.

k3s is "batteries included" (DESIGN.md D-9): one install gives you an ingress controller, DNS, storage, a load balancer, metrics and NetworkPolicy enforcement. With plain Kubernetes, you'd install each one yourself.

| Component | What it's for in SkyPulse | Touched by SkyPulse? |
|---|---|---|
| **Traefik** | The only way into the cluster: routes analysts to the api and operators to Grafana | ✅ 2 replicas + PDB ([`traefik-ha.yaml`](../../../skypulse/cluster/traefik-ha.yaml)) |
| **CoreDNS** | Resolves Service names (`feeddb-rw.skypulse-data…`, `llm`) | Allowed by every namespace's `allow-dns` policy |
| **metrics-server** | CPU usage for the api's HorizontalPodAutoscaler and `kubectl top` | No |
| **local-path provisioner** | Creates the volumes for PostgreSQL and Prometheus | No |
| **ServiceLB** (Klipper) | Gives Traefik's `LoadBalancer` Service an address on the nodes | No |
| **NetworkPolicy controller** (built into k3s) | Turns every NetworkPolicy into iptables rules on each node | No, but the whole security boundary relies on it |

Outside this namespace, but part of the same platform: the **k3s nodes** (kubelet + containerd), the **Kubernetes API server** (control plane), and in local development the **k3d load balancer** and **image registry** containers ([`cluster/k3d.yaml`](../../../skypulse/cluster/k3d.yaml)).

## The rules that touch this namespace

SkyPulse adds no NetworkPolicies to `kube-system`. Instead, the SkyPulse namespaces point **at** it, always by **namespace and Pod label**, so only the real component matches, not just any Pod in `kube-system`:

| Rule | In | Selects |
|---|---|---|
| Every Pod may query DNS on :53 | each `allow-dns` policy, e.g. [`analysis/networkpolicies.yaml`](../../../skypulse/k8s/base/analysis/networkpolicies.yaml) | `kube-system` + `k8s-app: kube-dns` |
| The api accepts :8000 only from Traefik | [`analysis/networkpolicies.yaml`](../../../skypulse/k8s/base/analysis/networkpolicies.yaml) | `kube-system` + `app.kubernetes.io/name: traefik` |
| Grafana accepts :3000 only from Traefik | [`monitoring/networkpolicies.yaml` L47-L56](../../../skypulse/k8s/base/monitoring/networkpolicies.yaml#L47-L56) | same |
| Prometheus may scrape Traefik on :9100 | [`monitoring/networkpolicies.yaml` L92-L100](../../../skypulse/k8s/base/monitoring/networkpolicies.yaml#L92-L100) | same |
| Prometheus may list Pods here | [`prometheus.yaml` L38-L60](../../../skypulse/k8s/base/monitoring/prometheus.yaml#L38-L60) (Role + RoleBinding **in** `kube-system`) | Pods only, read-only |

## The components

### Traefik: the ingress controller

Traefik is a reverse proxy that **watches every `Ingress` object in every namespace** and turns them into live routing rules. It's the cluster's single HTTP entry point.

**What it does in SkyPulse:**

1. **Routes two apps by hostname**, both arriving on `localhost:8090`:

   | Ingress | Namespace | Rule | Goes to |
   |---|---|---|---|
   | `skypulse` ([`ingress.yaml`](../../../skypulse/k8s/base/analysis/ingress.yaml)) | skypulse-analysis | **no host**: matches any hostname | `api` Service → the analyst app |
   | `grafana` ([`grafana.yaml` L119-L137](../../../skypulse/k8s/base/monitoring/grafana.yaml#L119-L137)) | skypulse-monitoring | host `grafana.localhost` | `grafana` Service → dashboards |

   The more specific host rule wins; everything else falls through to the api. The ingestion and data zones have **no Ingress at all**: nothing outside the cluster can reach them.
2. **Is the "source" the NetworkPolicies allow.** Traefik sends requests straight to Pod IPs, so the api and Grafana see traffic from the Traefik Pods, and allow exactly that.
3. **Measures every analyst request** (rate, status codes, latency) on its metrics port :9100, which Prometheus scrapes. That gives you request metrics without touching the app.
4. **Runs highly available.** k3s installs it with one replica. A node-drain drill with one replica caused about 16 s of failed requests. [`cluster/traefik-ha.yaml`](../../../skypulse/cluster/traefik-ha.yaml) (a k3s `HelmChartConfig`, applied by `make cluster`) sets **2 replicas, a PDB with `minAvailable: 1`, and spread across nodes** ([L13-L25](../../../skypulse/cluster/traefik-ha.yaml#L13-L25)). The same drill then gave 59/59 successes.

**A request's full path (local):**

```
browser http://localhost:8090
  → k3d load-balancer container (host :8090 → node :80)
  → ServiceLB → Traefik Service (LoadBalancer)
  → a Traefik Pod: picks the Ingress rule by Host header
  → directly to an api Pod :8000      ← the api's NetworkPolicy checks "from Traefik" here
```

In production the first two hops become a MetalLB IP reachable only from the analysts' network, plus a real hostname with TLS (cert-manager, internal CA).

### CoreDNS

The cluster's DNS server. Every Service gets a name: `<service>.<namespace>.svc.cluster.local`. Inside the same namespace the short name works (`llm`); across namespaces you need the full one (`feeddb-rw.skypulse-data.svc.cluster.local`, in each zone's `config.env`).

Because every SkyPulse namespace is default-deny, each one has an `allow-dns` policy to :53. Without it, nothing could resolve any name.

⚠️ CoreDNS also forwards **external** names. The analysis zone can't *connect* to the internet, but it can *resolve* internet names, which is a theoretical DNS side channel (DESIGN.md §5 #3).

### metrics-server

Collects CPU and memory usage from each node's kubelet. The **HorizontalPodAutoscaler** reads it to scale the api between 2 and 5 replicas at 70 % CPU ([`api.yaml` L124-L142](../../../skypulse/k8s/base/analysis/api.yaml#L124-L142)). It's also what answers `kubectl top`.

### local-path provisioner

When a PersistentVolumeClaim is created (each PostgreSQL instance, Prometheus's 2 Gi), it creates a directory **on one node** and turns it into a volume. It's simple and fast, but the data lives on that node only, so a Pod with a volume can't move elsewhere while its node is down (DESIGN.md §5 #10). Production uses replicated storage (Longhorn or Ceph) or local NVMe with 3 database instances.

### ServiceLB (Klipper)

Gives `LoadBalancer` Services (Traefik's) an address by listening on the nodes' ports. Locally, the k3d load balancer forwards host port 8090 to node port 80, where ServiceLB hands the traffic to Traefik. **MetalLB** does this job in production.

### NetworkPolicy enforcement

A NetworkPolicy is only a request until something enforces it. k3s includes an embedded controller (based on kube-router) that turns every policy into **iptables rules on every node**. That's why the project uses k3s/k3d: Docker Desktop's Kubernetes accepts NetworkPolicy objects but **doesn't enforce them**, so the boundary would exist only on paper (D-9). `make verify` proves that enforcement actually happens.

## Also part of the platform (not Pods in `kube-system`)

| Piece | Role | Code |
|---|---|---|
| **k3s nodes** (1 server + 2 agents) | Each runs a **kubelet** (starts Pods, runs probes) and **containerd** (pulls images, runs containers). Locally, each node is a Docker container. | [`cluster/k3d.yaml`](../../../skypulse/cluster/k3d.yaml) |
| **Kubernetes API server** | Where every object lives; every controller reads from it and writes to it. Only the CNPG instance manager, Prometheus and the operators talk to it. | — |
| **Image registry** | Outside the cluster: a Docker container locally (`localhost:5050`); the site's Harbor in production. containerd on each node pulls from it. | [`cluster/k3d.yaml`](../../../skypulse/cluster/k3d.yaml) |
| **k3d load balancer** | Local only: maps `localhost:8090` to the nodes | [`cluster/k3d.yaml`](../../../skypulse/cluster/k3d.yaml) |

One control plane locally is a single point of failure, accepted on purpose (the laptop is one anyway). Production runs 3 servers with embedded etcd behind a virtual IP (D-9).

## What `make verify` proves here

Indirectly, everything: each "blocked" result in the other namespaces' checks is the NetworkPolicy controller doing its job, and each "allowed" result depends on CoreDNS resolving the name first. It also checks that Prometheus scrapes **both** Traefik Pods.

## Related pages

- [What are controllers for?](../../what_are_controller_for.md): Traefik, the HPA and the others as controllers
- [`skypulse/DESIGN.md`](../../../skypulse/DESIGN.md) D-7 (HA, the Traefik finding), D-9 (why k3s), §4 (production platform)
