## The project at a glance

**SkyPulse** lets analysts subscribe to Bluesky handles and hashtags and see an LLM-generated sentiment summary for each: how many posts it covers and when it was last updated. It runs entirely on-premises with a local Gemma 4 model.

```mermaid
flowchart LR
    internet((Bluesky<br/>public API))
    analyst([Analyst's browser])
    subgraph cluster["Kubernetes cluster (k3s)"]
        subgraph ing["namespace: skypulse-ingestion · internet zone"]
            ingestor[ingestor]
        end
        subgraph data["namespace: skypulse-data · data tier"]
            pg[("PostgreSQL ×2<br/>(CloudNativePG)")]
        end
        subgraph ana["namespace: skypulse-analysis · local-network-only zone"]
            api["api ×2+"]
            analyzer[analyzer]
            llm["llm<br/>(Ollama + Gemma 4)"]
        end
        traefik["ingress controller ×2"]
    end
    internet -- HTTPS --> ingestor
    ingestor -- "INSERT posts" --> pg
    analyst --> traefik --> api --> pg
    analyzer --> pg
    analyzer --> llm
```

```bash
cd skypulse
make build     # install deps, run tests, build the images
make start     # create a 3-node cluster, deploy everything
# open http://localhost:8090
make verify    # prove the security boundary and HA setup
```

What's in it, and where the guide covers it:

| Requirement from the [brief](PROBLEM.md) | How it's solved | Chapters |
|---|---|---|
| Subscribe/unsubscribe, sentiment summary, item count, last updated | FastAPI web app + ingestor + LLM analyzer, all Python/uv | 05–09, 12 |
| Small local LLM | Ollama with Gemma 4 E2B baked into an image (no runtime downloads) | 08, 21 |
| **Security**: ingestion may use the internet; analysis only the local network | Ingestion and analysis namespaces that only meet at a separate data namespace, default-deny NetworkPolicies, a least-privilege DB role per zone, restricted Pod Security | 13, 14 |
| **High availability** | 2+ API replicas across nodes, PDBs, probes, 2-instance PostgreSQL with automatic failover, HA ingress | 09, 15, 18 |
| **Continuous updates** | Immutable image tags, rolling updates with `maxUnavailable: 0`, Kustomize overlays, GitOps-ready | 06, 16, 17 |
| Observability (beyond the brief) | Prometheus + Grafana dashboard fed by the database and the ingress controller, no app code | 09, 18, 20 |

## More documentation

| Document | What it is |
|---|---|
| [`PROBLEM.md`](PROBLEM.md) | The brief: functional, security and deployment requirements |
| [`skypulse/DESIGN.md`](skypulse/DESIGN.md) | Key decisions, alternatives considered, open items |
| [`final_summary.md`](final_summary.md) | The whole project in one read, namespace by namespace |
| [`project_explanation/`](project_explanation/) | Deep dive: build, platform, delivery, security boundary, runtime and code flow, with diagrams and an interactive map |
| [`kubernetes_operations_handbook.md`](kubernetes_operations_handbook.md) | Operating Kubernetes on-prem: common errors, debugging, networking, air-gaps, incidents, flashcards |
| [`Kubernetes_YAML_Practical_Guide.md`](Kubernetes_YAML_Practical_Guide.md) | A practical guide to writing Kubernetes YAML |

## Prerequisites

- A computer with **16 GB RAM** (8 GB works with the small model option) and about 25 GB of free disk space.
- Windows 10/11 (with WSL2), macOS or Linux. [Chapter 03](guide/03-setup-your-machine.md) installs everything else.
- Basic command-line comfort. No prior Kubernetes or Docker knowledge needed.

## Viewing this guide

The chapters are plain Markdown with [Mermaid](https://mermaid.js.org/) diagrams. They render on GitHub/GitLab. In VS Code, install the *Markdown Preview Mermaid Support* extension and press `Ctrl+Shift+V`. A few images come from the official Kubernetes documentation (kubernetes.io, CC BY 4.0) and load from the internet.

## Further reading

- Official docs: <https://kubernetes.io/docs/home/> (the [Concepts](https://kubernetes.io/docs/concepts/) section is excellent)
- Interactive tutorial: <https://kubernetes.io/docs/tutorials/kubernetes-basics/>
- *Kubernetes the Hard Way* (build a cluster by hand): <https://github.com/kelseyhightower/kubernetes-the-hard-way>
- *Production Kubernetes* (O'Reilly) and *Kubernetes Patterns* (O'Reilly), for after this guide
