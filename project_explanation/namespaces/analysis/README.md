# `skypulse-analysis`: the analysts' zone (no internet)

Zones: [index](../README.md) · [outside](../outside/README.md) · [your machine](../your-machine/README.md) · [ingestion](../ingestion/README.md) · [data](../data/README.md) · **analysis** · [monitoring](../monitoring/README.md) · [system](../system/README.md)

## What this namespace does

It's the analysis side of the brief: where posts are turned into sentiment and summaries, and where analysts read them. The hard rule: **it may be reached only from the analysts' network, and it may never reach the internet.**

Three workloads, each doing one job:

- **api**: the analysts' web app and JSON API. It only reads precomputed rows, so it's always fast.
- **analyzer**: a background worker that classifies posts with the LLM and keeps the summaries up to date.
- **llm**: Ollama serving a small Gemma model, with the weights built into the image.

| Component | Kind | Replicas | Code |
|---|---|---|---|
| api | Deployment + Service + PDB + HPA | 2–5 (HPA) | [`api.yaml`](../../../skypulse/k8s/base/analysis/api.yaml) · [`api.py`](../../../skypulse/src/skypulse/api.py) · [`targets.py`](../../../skypulse/src/skypulse/targets.py) · [`static/index.html`](../../../skypulse/src/skypulse/static/index.html) |
| analyzer | Deployment | 1 | [`analyzer.yaml`](../../../skypulse/k8s/base/analysis/analyzer.yaml) · [`analyzer.py`](../../../skypulse/src/skypulse/analyzer.py) · [`llm.py`](../../../skypulse/src/skypulse/llm.py) |
| llm | Deployment + Service | 1 (2 in production) | [`llm.yaml`](../../../skypulse/k8s/base/analysis/llm.yaml) · [`llm.Dockerfile`](../../../skypulse/docker/llm.Dockerfile) |
| skypulse | Ingress (for Traefik) | n/a | [`ingress.yaml`](../../../skypulse/k8s/base/analysis/ingress.yaml) |
| analysis-config | ConfigMap (generated) | n/a | [`config.env`](../../../skypulse/k8s/base/analysis/config.env) |
| analysis-db-credentials | Secret (from `make secrets`) | n/a | [`Makefile` L93](../../../skypulse/Makefile#L93) |

## The rules it follows

### Network ([`analysis/networkpolicies.yaml`](../../../skypulse/k8s/base/analysis/networkpolicies.yaml))

There's **no `ipBlock` rule anywhere in this file**. Every allowed path names a specific Pod, so no rule could ever match an internet address.

| Workload | In | Out |
|---|---|---|
| api | Traefik (from `kube-system`), port 8000 only | PostgreSQL :5432 |
| analyzer | Nothing (`ingress: []`) | PostgreSQL :5432, llm :11434 |
| llm | analyzer only, port 11434 | **Nothing** (`egress: []`), apart from DNS |
| all | — | DNS (CoreDNS) |

Everything else is denied by `default-deny-all`. For example, the api can't call the LLM: it never needs to, so it isn't allowed.

### Database: the `analysis` role

The api and the analyzer share the `analysis` user (Secret `analysis-db-credentials`). The migrate Job grants it ([`db.py` L117-L123](../../../skypulse/src/skypulse/db.py#L117-L123)):

- `SELECT, INSERT, DELETE` on `subscriptions`
- `SELECT, DELETE` on `posts`, plus `UPDATE (sentiment, score, analyzed_at)`
- `SELECT, INSERT, UPDATE` on `summaries`

It **can't change the schema**, and it can't see the owner's credentials.

### Configuration ([`analysis/config.env`](../../../skypulse/k8s/base/analysis/config.env))

`LLM_URL=http://llm:11434` (same namespace, so the short name works), `LLM_MODEL=` (empty means "use the model built into the image"), summary window 168 h (7 days), at most 50 posts, refresh at least every 900 s, and `PGHOST=feeddb-rw.skypulse-data.svc.cluster.local` with TLS required.

## The components

### api: the analysts' web app

**Runs** the shared image with `args: ["api"]` ([`api.yaml` L52](../../../skypulse/k8s/base/analysis/api.yaml#L52)), which starts uvicorn with the FastAPI app.

**Key design: it never calls the LLM or Bluesky.** It only reads precomputed rows from PostgreSQL ([`api.py` L1-L6](../../../skypulse/src/skypulse/api.py#L1-L6)), so it stays fast and available even while the LLM or the ingestor are down or being updated (D-1).

| Endpoint | What it does | Code |
|---|---|---|
| `GET /` | Serves the single-page app (plain HTML and JavaScript, refreshes every 10 s) | [L117-L119](../../../skypulse/src/skypulse/api.py#L117-L119) · [`index.html` L126](../../../skypulse/src/skypulse/static/index.html#L126) |
| `GET /api/subscriptions` | One query joining subscriptions, their summary and the pending count | [L50-L68](../../../skypulse/src/skypulse/api.py#L50-L68) |
| `POST /api/subscriptions` | Validates the shape with `parse_target()`, then `INSERT … ON CONFLICT DO NOTHING`; a duplicate returns 409 | [L71-L86](../../../skypulse/src/skypulse/api.py#L71-L86) · [`targets.py` L30-L53](../../../skypulse/src/skypulse/targets.py#L30-L53) |
| `DELETE /api/subscriptions/{id}` | Deletes it; its posts and summary follow (`ON DELETE CASCADE`) | [L89-L96](../../../skypulse/src/skypulse/api.py#L89-L96) |
| `GET /healthz` | Liveness: the process answers. It deliberately doesn't check the database. | [L99-L103](../../../skypulse/src/skypulse/api.py#L99-L103) |
| `GET /readyz` | Readiness: runs a query, so the Pod only gets traffic when the database is reachable **and migrated** | [L106-L114](../../../skypulse/src/skypulse/api.py#L106-L114) |

`parse_target()` can only check the **shape** of a handle or hashtag, because the api has no internet to ask Bluesky whether it exists. Unknown handles are reported later by the ingestor through `last_error`.

**High availability: the critical path** ([`api.yaml`](../../../skypulse/k8s/base/analysis/api.yaml)):

- **HPA, 2–5 replicas** at 70 % CPU ([L124-L142](../../../skypulse/k8s/base/analysis/api.yaml#L124-L142)). The Deployment has no `replicas:` on purpose, so `kubectl apply` never overrides the HPA. Production minimum is 3.
- **Spread across nodes** ([L42-L48](../../../skypulse/k8s/base/analysis/api.yaml#L42-L48)) and a **PodDisruptionBudget** `minAvailable: 1` ([L113-L122](../../../skypulse/k8s/base/analysis/api.yaml#L113-L122)), so a node drain never takes every replica.
- **Zero-downtime rollouts:** `maxSurge: 1, maxUnavailable: 0` ([L24-L28](../../../skypulse/k8s/base/analysis/api.yaml#L24-L28)), the readiness probe, and a 5 s `preStop` sleep ([L88-L91](../../../skypulse/k8s/base/analysis/api.yaml#L88-L91)) so Traefik stops routing to a Pod before it exits.
- **Survives database failover:** the connection pool validates each connection before handing it out ([`api.py` L23-L32](../../../skypulse/src/skypulse/api.py#L23-L32)).

*Measured:* 0 failed requests during a rolling update (96/96), a database failover, and a node drain.

### analyzer: the background worker

**Runs** `args: ["analyzer"]` ([`analyzer.yaml` L31](../../../skypulse/k8s/base/analysis/analyzer.yaml#L31)): a plain `while True` loop with no HTTP port ([`analyzer.py` L140-L172](../../../skypulse/src/skypulse/analyzer.py#L140-L172)).

Each round (`work_once()`, [L124-L137](../../../skypulse/src/skypulse/analyzer.py#L124-L137)):

1. **Classifies up to 10 posts** (`analyze_one()`, [L24-L44](../../../skypulse/src/skypulse/analyzer.py#L24-L44)):
   - claims the newest unanalyzed post with **`FOR UPDATE SKIP LOCKED`**: the row is locked for this transaction, and a second analyzer replica would skip it and take the next, so the table works as a queue;
   - asks the LLM for a label and a score;
   - writes `sentiment, score, analyzed_at` in the same transaction. If the LLM is down, the transaction rolls back and the post returns to the queue.
2. **Finds stale summaries** ([L48-L69](../../../skypulse/src/skypulse/analyzer.py#L48-L69)): never summarised, older than 15 minutes (so the 7-day window keeps moving), or new posts analysed since the last summary (at most once a minute while a backlog drains).
3. **Refreshes each one** (`refresh_summary()`, [L72-L121](../../../skypulse/src/skypulse/analyzer.py#L72-L121)):
   - takes an advisory lock per subscription;
   - reads up to 50 analysed posts from the last 7 days;
   - asks the LLM for a summary of at most two sentences;
   - computes the overall label from the scores;
   - upserts the result into `summaries`.

It also deletes posts older than 14 days, once an hour ([L150-L156](../../../skypulse/src/skypulse/analyzer.py#L150-L156)).

**LLM client** ([`llm.py`](../../../skypulse/src/skypulse/llm.py)):

- **Classification** passes a **JSON schema** as Ollama's `format` ([L26-L33](../../../skypulse/src/skypulse/llm.py#L26-L33), [L107-L109](../../../skypulse/src/skypulse/llm.py#L107-L109)), so the model can only answer with valid JSON and one of three labels.
- The answer is still parsed defensively ([L42-L59](../../../skypulse/src/skypulse/llm.py#L42-L59)).
- Temperature is 0, so the same post gets the same answer.

**Health:** a heartbeat file and an exec liveness probe, as for the ingestor ([`analyzer.yaml` L52-L61](../../../skypulse/k8s/base/analysis/analyzer.yaml#L52-L61)). It handles LLM outages, database failover and "schema not ready yet" by waiting and retrying ([L157-L169](../../../skypulse/src/skypulse/analyzer.py#L157-L169)).

**Scaling:** safe to run more replicas. `SKIP LOCKED` and the advisory locks ensure no two replicas do the same work.

### llm: Ollama + Gemma

**Runs** the separate `skypulse-llm` image with `args: ["serve"]` ([`llm.yaml` L42](../../../skypulse/k8s/base/analysis/llm.yaml#L42)). It serves `gemma4:e2b-it-qat` (4-bit, about 5 GB of RAM) on :11434.

- **The model is built into the image** ([`llm.Dockerfile` L16-L22](../../../skypulse/docker/llm.Dockerfile#L16-L22)): a temporary server pulls the weights **at build time**. This zone may never download anything, so the model travels through the same registry and rollout process as the code (D-5).
- **Resources:** requests 1 CPU / 3 Gi, limit 8 Gi ([L49-L54](../../../skypulse/k8s/base/analysis/llm.yaml#L49-L54)). Liveness allows 6 failures, because inference can make it briefly slow to answer.
- **Rollouts:** `maxSurge: 1, maxUnavailable: 0`: the new version starts before the old one stops.
- **Why one replica is OK locally:** only the analyzer calls it, asynchronously. If it restarts, summaries arrive a little later, and analysts can still read and manage subscriptions. Production runs 2.
- **Hardened:** fixed non-root UID 10001, read-only root filesystem, writable `emptyDir` for `$HOME` and `/tmp`, no API token, no egress.

### The Ingress `skypulse`

[`ingress.yaml`](../../../skypulse/k8s/base/analysis/ingress.yaml) has **no `host`**, so it catches every hostname except `grafana.localhost` and sends it to the api Service. Traefik (in `kube-system`) does the routing; see the [system README](../system/README.md). Production sets `skypulse.analysts.internal` with TLS.

## How it handles failure

| What happens | Effect on analysts |
|---|---|
| LLM down | None: the api serves existing summaries; the analyzer retries every 5 s |
| Analyzer down | None right away; summaries just stop refreshing until it's back |
| One api Pod or node lost | None: the other replicas serve, readiness and the PDB protect them |
| Database failover | None measured: the pool replaces stale connections |
| Ingestor down (other zone) | None: no new posts, but everything else works |

## What `make verify` proves here ([`verify.sh` L47-L51](../../../skypulse/scripts/verify.sh#L47-L51))

- ❌ api → internet **blocked**; ❌ analyzer → internet **blocked**
- ✅ api → PostgreSQL **allowed**; ✅ analyzer → llm **allowed**
- ❌ api → llm **blocked** (not needed, so not allowed)
- ❌ `analysis` role **cannot** `DROP TABLE posts`
- ❌ api → database metrics and api → Prometheus **blocked**

## Design decisions behind it

[`skypulse/DESIGN.md`](../../../skypulse/DESIGN.md): D-1 (precomputed summaries), D-2 (Postgres as queue), D-4 (one image, four roles), D-5 (model built into the image), D-6 (security boundary), D-7 (HA on the critical path). Known limitations: no analyst authentication (§5 #1), DNS side channel (§5 #3), LLM throughput on CPU (§5 #5), LLM image size (§5 #6), sentiment quality not yet evaluated (§5 #9).
