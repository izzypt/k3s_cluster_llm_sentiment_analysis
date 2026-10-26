# SkyPulse, namespace by namespace

Back to: [1 Overview](../01-overview.md) · [6 Security boundary](../06-security-boundary.md) · Interactive version: [SkyPulse Atlas](../interactive-map/README.md)

SkyPulse is split into **zones**, and each zone is a Kubernetes namespace. This folder has one README per namespace. Each explains what the namespace is for, the rules it follows, and what every component in it does, with links to the code.

| Namespace | README | Role in one line | Internet? |
|---|---|---|---|
| `skypulse-ingestion` | [ingestion](ingestion/README.md) | Fetches posts from Bluesky and writes them to the database | ✅ HTTPS to public IPs only |
| `skypulse-data` (+ `cnpg-system`) | [data](data/README.md) | PostgreSQL: the only state, and the only place the zones meet | ❌ |
| `skypulse-analysis` | [analysis](analysis/README.md) | The analysts' app, the analyzer and the local LLM | ❌ |
| `skypulse-monitoring` | [monitoring](monitoring/README.md) | Prometheus and Grafana: reads metrics, never application data | ❌ |
| `kube-system` | [system](system/README.md) | What k3s brings: Traefik (the front door), CoreDNS, storage, policy enforcement | n/a (platform) |

Two more zones aren't namespaces at all, because they're outside the cluster:

| Zone | README | Role in one line |
|---|---|---|
| Outside the cluster | [outside](outside/README.md) | The analysts and operators, each with a browser, entering through one door (`localhost:8090`) |
| Your machine | [your machine](your-machine/README.md) | Where the system is built and deployed from: Makefile, docker build, image registry |

## The big picture

```
                       analysts / operators (browser)
                                  │ :8090
                     ┌────────────▼────────────┐
                     │ kube-system: Traefik     │  the only way in
                     └──────┬─────────────┬─────┘
                  any host  │             │ grafana.localhost
     ┌──────────────────────▼───┐   ┌─────▼──────────────────┐
     │ skypulse-analysis        │   │ skypulse-monitoring    │
     │ api · analyzer · llm     │   │ grafana · prometheus   │
     │ NO internet              │   │ metrics ports only     │
     └──────────┬───────────────┘   └─────┬──────────────────┘
                │ :5432 (role analysis)   │ :9187 (metrics only)
     ┌──────────▼─────────────────────────▼───┐
     │ skypulse-data                          │◀── cnpg-system: CNPG operator
     │ PostgreSQL primary + replica · migrate │
     └──────────▲─────────────────────────────┘
                │ :5432 (role ingestor)
     ┌──────────┴───────────────┐
     │ skypulse-ingestion       │──── HTTPS :443 ───▶ Bluesky (internet)
     │ ingestor                 │
     └──────────────────────────┘
```

The two application zones (**ingestion** and **analysis**) never talk to each other. They only meet in the database, through rows, each logging in as its own least-privilege role.

## Rules every SkyPulse namespace follows

These come from [`skypulse/k8s/base/namespaces.yaml`](../../skypulse/k8s/base/namespaces.yaml) and each zone's `networkpolicies.yaml`. The individual READMEs only describe what's specific to each namespace.

1. **Pod Security Standard `restricted`** ([`namespaces.yaml` L17](../../skypulse/k8s/base/namespaces.yaml#L17)). Kubernetes refuses any Pod that runs as root, keeps Linux capabilities, can escalate privileges, or has no seccomp profile. Every container also uses a read-only root filesystem and gets writable `emptyDir` volumes only where it needs them.
2. **Default deny, then allow-list.** Each namespace starts with a `default-deny-all` NetworkPolicy (`podSelector: {}`, ingress and egress). Then one policy per workload opens exactly the paths it needs, naming the other side by **namespace and Pod label**.
3. **DNS is always allowed** (`allow-dns` → CoreDNS in `kube-system`, port 53). Without it, default deny would break Service names like `feeddb-rw.skypulse-data.svc.cluster.local`.
4. **No Kubernetes API token unless needed** (`automountServiceAccountToken: false`). Only Prometheus has one, and it can only list Pods.
5. **No Service environment variables** (`enableServiceLinks: false`), so a Service called `api` can't inject `API_PORT=…` into the app's settings.
6. **Configuration from ConfigMaps, credentials from Secrets.** Kustomize names each ConfigMap after a hash of its content, so a config change rolls the Pods automatically ([`kustomization.yaml` L33-L52](../../skypulse/k8s/base/kustomization.yaml#L33-L52)).

`make verify` ([`skypulse/scripts/verify.sh`](../../skypulse/scripts/verify.sh)) checks these rules on the running cluster by opening real connections from inside the Pods. Each README lists the checks for its namespace.

## Related pages

- [The database: CloudNativePG and the migrate Job](../db_cnpg_migratejob.md)
- [What are controllers for?](../what_are_controller_for.md)
