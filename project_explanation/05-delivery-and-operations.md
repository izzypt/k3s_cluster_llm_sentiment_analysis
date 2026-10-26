# 5 · Delivery & operations: how it gets there and stays healthy

Parts: [1 Overview](01-overview.md) · [2 Application](02-application.md) · [3 Build](03-build.md) · [4 Platform](04-platform.md) · **5 Delivery & operations** · [6 Security boundary](06-security-boundary.md) · [7 Runtime](07-runtime.md) · [8 Code flow](08-code-flow.md)

## 5.1 The Makefile: the orchestrator

uv only knows about Python. Delivering SkyPulse also needs Docker, k3d and kubectl, and the Makefile chains all of them. It's the thread through every other part:

```
make build
 ├─ check-tools        → scripts/setup.sh --check   (are docker, k3d, kubectl, uv installed?)
 ├─ uv sync --locked   → .venv with deps + skypulse installed
 ├─ uv run pytest -q   → tests must pass
 ├─ docker build app.Dockerfile → localhost:5050/skypulse-app:<sha>-<timestamp>
 ├─ docker build llm.Dockerfile → only if that tag doesn't exist yet
 └─ write the tags to .build/app-tag and .build/llm-tag

make start  = check-tools + cluster + operator + secrets + push + deploy
 ├─ cluster   → k3d cluster create (or start), wait for nodes, apply traefik-ha.yaml
 ├─ operator  → install CloudNativePG, wait for it
 ├─ secrets   → generate passwords once into .secrets/, create the Secrets in both namespaces
 ├─ push      → push both images to the k3d registry
 └─ deploy    → apply the manifests with the built tags, wait for every rollout

make update = build + push + deploy     (continuous delivery: a new version, zero downtime)
```

Day-2 targets:

| Target | What it does |
|---|---|
| `make status` | Nodes, pods, services, policies, HPA, PDB, database, monitoring |
| `make logs` | Follow the logs of every component |
| `make verify` | Run `scripts/verify.sh` against the live cluster |
| `make test` | Unit tests only |
| `make stop` / `make clean` | Pause the cluster (keeps data) / delete cluster, registry and data |
| `make help` | List every target |

## 5.2 Overlays: one base, several environments

This is Kustomize's base + overlays pattern:

- **`k8s/base/`** describes the whole system once (see [4 Platform](04-platform.md)).
- **`k8s/overlays/<env>/`** points to `../../base` and only changes what differs. Nothing is copied.

| | `overlays/local` | `overlays/production` |
|---|---|---|
| Images | `localhost:5050/...` (the k3d registry) | `registry.analysts.internal/...` (the site's registry) |
| Tags | placeholder `dev`, replaced by `make deploy` | fixed versions (`0.1.0`, ...) |
| Postgres | base: 2 instances, 1 Gi | 3 instances, 50 Gi |
| LLM | base: 1 replica | 2 replicas |
| API (HPA) | base: min 2 | min 3 |
| Ingress | any hostname, plain HTTP | `skypulse.analysts.internal` + TLS |

Adding a `staging` environment would just be another folder with its own `kustomization.yaml` pointing at the base.

## 5.3 What `make deploy` does

1. Generates a **throw-away overlay** in `.build/deploy/kustomization.yaml` on top of `overlays/local`, pinning the exact tags from `.build/app-tag` and `.build/llm-tag`. Every deploy therefore changes the image tag, which makes it a real rolling update.
2. Deletes the previous `migrate` Job: a Job's pod template is immutable, so the new image couldn't be applied otherwise.
3. `kubectl apply -k .build/deploy`.
4. Waits in order: Postgres ready → `migrate` complete → each Deployment rolled out.

## 5.4 Updates without downtime

| Change | How it rolls out |
|---|---|
| Code | `make update`: new unique tag → new pod template → rolling update (`maxSurge: 1, maxUnavailable: 0`, readiness gates traffic) |
| Configuration (`config.env`) | The ConfigMap name hash changes → pod templates change → rolling update |
| Schema | The `migrate` Job runs before the rollout is awaited; migrations must be backward compatible (expand, then contract) so old and new pods can run side by side |

Measured on the local cluster with requests running against the API: a full `make update` passed 96/96 requests, deleting the Postgres primary 114/114, draining a node 59/59.

## 5.5 Scripts

### `scripts/setup.sh`: prerequisites

Checks `make`, `docker`, `kubectl`, `k3d` and `uv`, that the Docker daemon runs with enough memory, and that Docker Hub is reachable with the saved login. Then it offers to install or fix what's missing:

| Mode | Used by | Behaviour |
|---|---|---|
| `./scripts/setup.sh` | you, before the first build | check, then ask before installing |
| `--check` | `make check-tools` (before `build` and `start`) | check only, exit 1 if anything is missing |
| `--yes` | automation | install without asking |

`make build` runs it in check-only mode on purpose: `make` itself may be the missing tool, some fixes need a new shell (the `docker` group), and an install prompt shouldn't appear in the middle of `make update` or CI.

kubectl, k3d and uv go into `~/.local/bin` without sudo. `make` and Docker come from the system package manager.

### `scripts/verify.sh`: proofs against the running cluster

Each connection check runs **inside a real pod** (a small Python snippet, or `nc` in the monitoring images, which have no Python), so it tests exactly what the workloads are allowed to do:

- The analysis zone can't reach the internet.
- The ingestion zone reaches the internet, but not the local network.
- Each zone's database role has only its own rights; the owner credentials exist only in `skypulse-data`.
- Prometheus reaches only metrics ports and scrapes every target.
- HA placement: ≥ 2 API replicas on different nodes, Postgres instances on different nodes.

## 5.6 Production: Argo CD (GitOps)

`deploy/argocd/application.yaml` tells Argo CD, running inside the cluster, to keep it in sync with `k8s/overlays/production` in Git:

```
CI builds + pushes an image ──► commits the new tag to overlays/production ──► Argo CD applies it
```

- **Pull-based:** the cluster pulls from Git, so nothing outside needs access to the cluster. That suits on-prem and air-gapped sites.
- `prune: true` deletes resources removed from Git; `selfHeal: true` undoes manual `kubectl` changes.
- **Rollback** is `git revert`.
- The `migrate` Job carries Argo CD hook annotations, so Argo CD recreates it on every sync, the job `make deploy` does by hand.

The local setup and production differ in more than delivery (cluster, registry, storage, secrets, backups, observability). `skypulse/DESIGN.md` §4 has the full comparison table.
