# 1 · Overview: what SkyPulse is and how it fits together

Parts: **1 Overview** · [2 Application](02-application.md) · [3 Build](03-build.md) · [4 Platform](04-platform.md) · [5 Delivery & operations](05-delivery-and-operations.md) · [6 Security boundary](06-security-boundary.md) · [7 Runtime](07-runtime.md) · [8 Code flow](08-code-flow.md)

Prefer pictures? **[SkyPulse in pictures](diagrams/README.md)** covers the same ground in 11 annotated posters with the code next to each step.
Or explore it: **[SkyPulse Atlas](interactive-map/README.md)** is an interactive, zoomable map of the infrastructure and the code, with guided tours.
Or watch it: **[SkyPulse, explained](video/README.md)** is a Remotion video that walks through everything, step by step, with the code behind each step.

## What it does

Analysts subscribe to **Bluesky handles and hashtags**. For each subscription SkyPulse shows an **LLM-generated summary of recent sentiment**, how many posts it covers and when it was last updated. Everything runs on-premises on Kubernetes, with a local Gemma model served by Ollama.

The hard requirement behind most design decisions: **the analysis side must never reach the internet**, while something still has to fetch posts from Bluesky.

## The big picture

```
 internet                 skypulse-ingestion          skypulse-data           skypulse-analysis
                                                                          ┌──► api ◄── analysts (browser)
 Bluesky ◄──HTTP── ingestor ──INSERT posts──► PostgreSQL ◄──────────────┤
                                                ▲                        └──► analyzer ──HTTP──► llm (Ollama)
                                     migrate ───┘ (creates tables + grants)

                          skypulse-monitoring: Prometheus + Grafana (read metrics only)
```

- **Four zones, four namespaces.** Ingestion may reach the internet, but not the local network. Analysis has no internet at all. Data is the only place the two meet. Monitoring only reads metrics.
- **Postgres is the hub.** The roles never call each other; each one only reads and writes the database. That is what makes the security boundary possible.
- **One image, four roles.** The same Python image runs as `api`, `ingestor`, `analyzer` or `migrate`; Kubernetes picks the role. The LLM is a second image with the model baked in.

## The repository, by part

| Path | What it is | Part |
|---|---|---|
| `src/skypulse/` | The Python application | [2 Application](02-application.md) |
| `tests/` | Unit tests (pytest) | [2 Application](02-application.md) |
| `pyproject.toml`, `uv.lock` | Python project + exact dependency versions | [3 Build](03-build.md) |
| `docker/` | `app.Dockerfile`, `llm.Dockerfile` | [3 Build](03-build.md) |
| `cluster/` | The local k3d cluster + Traefik HA | [4 Platform](04-platform.md) |
| `k8s/base/` | Every Kubernetes object, environment-independent | [4 Platform](04-platform.md) |
| `k8s/overlays/` | Per-environment changes (local, production) | [5 Delivery](05-delivery-and-operations.md) |
| `Makefile` | The commands that drive everything | [5 Delivery](05-delivery-and-operations.md) |
| `scripts/` | `setup.sh` (prerequisites), `verify.sh` (proofs) | [5 Delivery](05-delivery-and-operations.md) |
| `deploy/argocd/` | GitOps for a real site | [5 Delivery](05-delivery-and-operations.md) |
| `README.md`, `DESIGN.md` | How to run it, why it is built this way | – |

The security boundary (S1/S2) isn't in one folder: the architecture, code, images, NetworkPolicies, database grants and `verify.sh` each implement a share. [6 Security boundary](06-security-boundary.md) follows that one requirement through every layer.

## The path of a change

The parts follow the path a change takes, from code to a running system:

```
 2 Application          3 Build                    4 Platform                  5 Delivery
 src/skypulse/  ──►  uv sync + docker build  ──►  k8s/base on k3s  ◄──  Makefile / overlays / Argo CD
 (what it does)      (code → image)              (where it runs)        (how it gets there)
```

In commands, a first run is:

```bash
./scripts/setup.sh   # install missing tools
make build           # deps, tests, images
make start           # cluster, Postgres operator, secrets, push, deploy
make verify          # prove the security boundary and HA
```
