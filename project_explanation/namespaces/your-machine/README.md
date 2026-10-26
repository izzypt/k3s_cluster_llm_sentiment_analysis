# Your machine: Makefile, docker build, registry

Zones: [index](../README.md) · [outside](../outside/README.md) · **your machine** · [ingestion](../ingestion/README.md) · [data](../data/README.md) · [analysis](../analysis/README.md) · [monitoring](../monitoring/README.md) · [system](../system/README.md)

> **Not a namespace.** This zone is outside the cluster: it's your laptop (Docker + `make`). In production its job is done by CI and the site's registry. It's here because everything that runs in the cluster starts here.

## What this zone does

It **builds** the system and **deploys** it. Everything is driven by the [`Makefile`](../../../skypulse/Makefile), and each step is a plain command you could type yourself:

```
make build ──▶ docker build ──▶ 2 images ──make push──▶ registry (localhost:5050)
                                                              │ containerd on each node pulls
make start / make update ──▶ kubectl apply -k ──▶ Kubernetes API ──▶ controllers do the rest
```

| Component | What it is | Code |
|---|---|---|
| **Makefile** | The orchestrator: build, start, update, verify, status, logs, stop, clean | [`Makefile`](../../../skypulse/Makefile) · [`scripts/setup.sh`](../../../skypulse/scripts/setup.sh) · [`scripts/verify.sh`](../../../skypulse/scripts/verify.sh) |
| **docker build** | Builds two images: `skypulse-app` (all four Python roles) and `skypulse-llm` (Ollama + model) | [`app.Dockerfile`](../../../skypulse/docker/app.Dockerfile) · [`llm.Dockerfile`](../../../skypulse/docker/llm.Dockerfile) |
| **Registry** | A private image registry container at `localhost:5050`, created by k3d | [`cluster/k3d.yaml` L22-L34](../../../skypulse/cluster/k3d.yaml#L22-L34) |

## The rules it follows

1. **Reproducible builds.** Dependencies come from the lock file only (`uv sync --locked`), and tests must pass before any image is built ([`Makefile` L54-L55](../../../skypulse/Makefile#L54-L55)).
2. **Immutable, traceable tags.** Every app build gets a unique tag `<git sha>-<timestamp>` ([L30](../../../skypulse/Makefile#L30)), never `latest`. Every deploy is therefore a real rolling update, and you can always tell which commit is running.
3. **Deploy exactly what was built.** `make build` writes the tags to `.build/` ([L65-L67](../../../skypulse/Makefile#L65-L67)); `make push` and `make deploy` read them from there, so they can't pick up a different image by accident.
4. **Secrets never go into Git.** Database passwords are generated once into `.secrets/` (git-ignored) and loaded straight into Kubernetes Secrets ([L93-L109](../../../skypulse/Makefile#L93-L109)).
5. **Images are hardened by construction.** Non-root UID 10001, no build tools in the runtime image, and the model built in so the analysis zone never downloads anything.

## The components

### Makefile: the orchestrator

| Target | What it does | Code |
|---|---|---|
| `make setup` / `check-tools` | Installs or checks make, Docker, kubectl, k3d, uv | [L42-L48](../../../skypulse/Makefile#L42-L48) · [`setup.sh`](../../../skypulse/scripts/setup.sh) |
| **`make build`** | `uv sync --locked` → `pytest` → build the app image → build the LLM image (**only if not already built**: it downloads several GB) → record both tags | [L52-L68](../../../skypulse/Makefile#L52-L68) |
| **`make start`** | `cluster` → `operator` → `secrets` → `push` → `deploy` | [L72-L73](../../../skypulse/Makefile#L72-L73) |
| ↳ `cluster` | Creates (or restarts) the k3d cluster and registry from [`k3d.yaml`](../../../skypulse/cluster/k3d.yaml), waits for the nodes, applies [`traefik-ha.yaml`](../../../skypulse/cluster/traefik-ha.yaml) | [L75-L85](../../../skypulse/Makefile#L75-L85) |
| ↳ `operator` | Installs CloudNativePG (pinned version 1.30.1) and waits for it | [L87-L90](../../../skypulse/Makefile#L87-L90) |
| ↳ `secrets` | Creates the namespaces, generates one password per role, and writes each Secret into **both** `skypulse-data` and the zone's own namespace | [L92-L109](../../../skypulse/Makefile#L92-L109) |
| ↳ `push` | Pushes exactly the two tags recorded by `make build` | [L111-L115](../../../skypulse/Makefile#L111-L115) |
| ↳ **`deploy`** | Writes a throw-away Kustomize overlay that pins the new tags, deletes the old migrate Job, `kubectl apply -k`, then waits **in dependency order**: database ready → migrate done → api → analyzer → ingestor → llm → prometheus → grafana | [L117-L146](../../../skypulse/Makefile#L117-L146) |
| **`make update`** | `build` → `push` → `deploy`: continuous delivery with zero downtime | [L150-L151](../../../skypulse/Makefile#L150-L151) |
| `make verify` | Proves the security boundary and the HA setup from inside the real Pods | [L167-L169](../../../skypulse/Makefile#L167-L169) · [`verify.sh`](../../../skypulse/scripts/verify.sh) |
| `make status` / `logs` | Everything running in the four namespaces; follow all logs | [L153-L165](../../../skypulse/Makefile#L153-L165) |
| `make stop` / `clean` | Stop the cluster (data kept) / delete the cluster, registry and data | [L175-L182](../../../skypulse/Makefile#L175-L182) |

**Why the throw-away overlay?** The base manifests say `image: skypulse-app`. The [local overlay](../../../skypulse/k8s/overlays/local/kustomization.yaml) rewrites that to `localhost:5050/skypulse-app`, and the generated overlay in `.build/deploy/` pins the tag that was just built. Git never changes, and every deploy names an exact image.

### docker build: the two images

**`skypulse-app`** ([`app.Dockerfile`](../../../skypulse/docker/app.Dockerfile)): one image for api, ingestor, analyzer and migrate (DESIGN.md D-4). About 58 MB compressed.

- **Multi-stage build.** The build stage uses uv to create a virtualenv in `/app/.venv` ([L9-L25](../../../skypulse/docker/app.Dockerfile#L9-L25)). The runtime stage copies **only that virtualenv** into a clean slim Python image ([L28-L31](../../../skypulse/docker/app.Dockerfile#L28-L31)), so there's no uv and no build cache in the final image.
- **Layer caching.** Dependencies are installed before the code is copied ([L18-L25](../../../skypulse/docker/app.Dockerfile#L18-L25)). A code-only change rebuilds in seconds.
- **Non-root:** a fixed user, UID 10001 ([L30](../../../skypulse/docker/app.Dockerfile#L30), [L34](../../../skypulse/docker/app.Dockerfile#L34)), which the `restricted` Pod Security Standard requires.
- **`ENTRYPOINT ["skypulse"]`, `CMD ["api"]`** ([L36-L37](../../../skypulse/docker/app.Dockerfile#L36-L37)). Each manifest overrides `CMD` with `args:` to pick the role, and [`__main__.py`](../../../skypulse/src/skypulse/__main__.py) dispatches to it.
- [`.dockerignore`](../../../skypulse/.dockerignore) keeps `.git`, `.secrets`, `k8s/` and docs out of the build context.

**`skypulse-llm`** ([`llm.Dockerfile`](../../../skypulse/docker/llm.Dockerfile)): Ollama 0.35.1 with `gemma4:e2b-it-qat` built in. About 7.4 GB compressed.

- **The model is pulled at build time** ([L16-L22](../../../skypulse/docker/llm.Dockerfile#L16-L22)): a temporary Ollama server starts, pulls the weights and stops. The analysis zone may never reach the internet, so the model has to travel inside the image (D-5).
- **Tagged by content**, not by commit: `<ollama version>-<model>` ([`Makefile` L28](../../../skypulse/Makefile#L28)). It's rebuilt only when one of those changes.
- Non-root (UID 10001), and `OLLAMA_NOPRUNE`, because the weights are read-only in the container.

### Registry: `localhost:5050`

A private registry **container**, created by k3d next to the cluster ([`k3d.yaml` L22-L34](../../../skypulse/cluster/k3d.yaml#L22-L34)). It's **outside the cluster**: not a Pod, and invisible to `kubectl get pods`, but visible to `docker ps`.

- **Your machine pushes** to `localhost:5050`.
- **The nodes pull** `localhost:5050/...` as well. Inside a node container, `localhost` would mean the node itself, so k3d configures containerd to **redirect** that name to `http://k3d-skypulse-registry:5000` on the shared Docker network.
- **Who pulls:** the kubelet on the node where a Pod is scheduled asks containerd for the image. A namespace never pulls anything, and NetworkPolicies don't apply to image pulls, because they come from the node, not a Pod.

## Local vs production

| Here | In production |
|---|---|
| `make build` on a laptop | **CI**: build, test, **scan** (Trivy/Grype), **sign** (cosign), push |
| `localhost:5050` (k3d registry container) | The site's internal registry, e.g. Harbor at `registry.analysts.internal` ([production overlay](../../../skypulse/k8s/overlays/production/kustomization.yaml#L13-L19)); images **mirrored** across the air gap |
| `make deploy` (`kubectl apply -k`) | CI commits the new tag to `k8s/overlays/production`; **Argo CD** syncs it ([`application.yaml`](../../../skypulse/deploy/argocd/application.yaml)) |
| `make secrets` | External Secrets (Vault) or Sealed Secrets |

Open items: there's no CI pipeline in the repo yet, and no scanning, signing or signature checks at admission (see DESIGN.md §4 and §5).

## Design decisions behind it

[`skypulse/DESIGN.md`](../../../skypulse/DESIGN.md): D-4 (one image, four roles), D-5 (model built into the image), D-8 (continuous delivery, immutable tags), D-9 (k3d with a private registry).
