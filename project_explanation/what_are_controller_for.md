# What are controllers for? The controllers behind SkyPulse

Back to: [1 Overview](01-overview.md) · [4 Platform](04-platform.md) · [5 Delivery & operations](05-delivery-and-operations.md) · Related: [The database: CloudNativePG and the migrate Job](db_cnpg_migratejob.md)

In Kubernetes almost everything is done by a controller.

## What a controller is

A controller is a program that runs a loop forever:

```
watch the objects it's responsible for ─▶ compare "desired" (spec) with "actual" (status)
        ▲                                                │
        └──────────── act to close the gap ◀─────────────┘
```

You never tell Kubernetes "start 2 Pods". You write `replicas: 2`, and a controller keeps making that true, including after a Pod crashes or a node dies. This is called **reconciliation**. An **operator** like CNPG is just a controller for a custom kind (`Cluster`) that has database know-how built in.

## The controllers in SkyPulse

### 1. Built into Kubernetes (all inside `kube-controller-manager`)

| Controller | Watches | What it does in SkyPulse |
|---|---|---|
| **Deployment** | `Deployment` | Creates a new ReplicaSet for each version → the rolling updates (`maxSurge: 1, maxUnavailable: 0`) |
| **ReplicaSet** | `ReplicaSet` | Keeps exactly N Pods alive (api, analyzer, ingestor, llm, grafana, prometheus) |
| **Job** | `Job` | Runs `migrate` until it succeeds, with up to `backoffLimit: 10` retries |
| **HorizontalPodAutoscaler** | `HorizontalPodAutoscaler` | Scales the api between min/max replicas based on CPU (it reads metrics from k3s's metrics-server) |
| **EndpointSlice** | `Service` + Pods | Keeps each Service's list of ready Pod IPs up to date. This is how `feeddb-rw` follows a failover and how readiness takes Pods out of rotation. |
| **Namespace** | `Namespace` | Deletes everything inside a namespace when the namespace is deleted |
| **ServiceAccount / token** | `ServiceAccount` | Gives Pods their identity (Prometheus uses one, together with its Role/RoleBinding) |
| **PersistentVolume binder** | `PersistentVolumeClaim` | Matches the database's and Prometheus's PVCs to actual volumes |
| **Node lifecycle** | Nodes | Marks a node `NotReady` and evicts its Pods (what you see in a node-failure drill) |
| **Disruption** | `PodDisruptionBudget` | Tracks how many Pods may be disrupted. `kubectl drain` respects it, which made the 0-failure drains possible. |
| **Garbage collector** | owner references | Deletes children whose owner is gone, e.g. Pods of a deleted ReplicaSet |

### 2. Added by k3s (one reason it's "batteries included")

| Controller | What it does |
|---|---|
| **Helm controller** | Installs Traefik from a bundled Helm chart, and applies your `HelmChartConfig` ([`skypulse/cluster/traefik-ha.yaml`](../skypulse/cluster/traefik-ha.yaml)) to run it with 2 replicas |
| **NetworkPolicy controller** (based on kube-router) | Turns your `NetworkPolicy` objects into iptables rules on each node. Without it, every policy would be ignored. |
| **local-path provisioner** | When a PVC is created, makes a directory on a node and turns it into a volume. That's why storage is node-local (`DESIGN.md` §5 #10). |
| **ServiceLB** (Klipper) | Gives `LoadBalancer` Services an address on the nodes. In production, MetalLB takes this role. |

### 3. Installed by you

| Controller | Watches | What it does |
|---|---|---|
| **Traefik** (ingress controller) | `Ingress` | Turns your `Ingress` rules into actual routing: `localhost:8090` → api Service |
| **CloudNativePG** (operator) | `Cluster` (`postgresql.cnpg.io`) | Postgres Pods, Services, Secrets, users, failover, metrics exporter |

### 4. Production only

| Controller | Watches | What it does |
|---|---|---|
| **Argo CD** | `Application` ([`skypulse/deploy/argocd/application.yaml`](../skypulse/deploy/argocd/application.yaml)) | Desired state is Git, actual state is the cluster: it syncs them and runs `migrate` as a Sync hook |
| *(from §4 of `DESIGN.md`)* cert-manager, External Secrets, Kyverno/policy-controller, MetalLB | `Certificate`, `ExternalSecret`, policies, IP pools | Same pattern: you declare something, a controller makes it real |

## Two that work the same way but aren't usually called controllers

- **The scheduler** watches Pods that have no node yet and assigns one, following your anti-affinity and topology spread rules.
- **The kubelet** runs on each node. It watches the Pods assigned to its node and makes them real through containerd, which pulls the image from the registry and starts the containers.

One common confusion: some `kind:` values in the repo, like `Kustomization` and k3d's `Simple`, are never sent to the cluster. They're files for client tools (kustomize and k3d), so no controller in the cluster ever sees them.

## Example: one `make update`, followed through the controllers

```
you apply a new image tag
 → Deployment controller: new ReplicaSet
 → ReplicaSet controller: new Pod objects
 → scheduler: picks nodes
 → kubelet + containerd: pull image, start containers
 → readiness passes → EndpointSlice controller: adds Pod IPs to the Service
 → Traefik: routes analyst traffic to them
 → Deployment controller: scales the old ReplicaSet down
```

No single component "does the deploy". Each controller does one small job, and the result is a zero-downtime rollout.
