# `skypulse-ingestion`: the internet zone

Zones: [index](../README.md) · [outside](../outside/README.md) · [your machine](../your-machine/README.md) · **ingestion** · [data](../data/README.md) · [analysis](../analysis/README.md) · [monitoring](../monitoring/README.md) · [system](../system/README.md)

## What this namespace does

It brings data in from the outside world. The **ingestor** is the only SkyPulse component allowed on the internet. Every 60 seconds it reads the subscription list from PostgreSQL, fetches recent posts from the public Bluesky API, and inserts them into the `posts` table.

It's the mirror image of the analysis zone: it **may** reach the internet, but it may **not** reach the local network, apart from the one database port it needs. Nothing may connect to it.

| Component | Kind | Replicas | Code |
|---|---|---|---|
| ingestor | Deployment | 1 | [`ingestor.yaml`](../../../skypulse/k8s/base/ingestion/ingestor.yaml) · [`ingestor.py`](../../../skypulse/src/skypulse/ingestor.py) · [`bluesky.py`](../../../skypulse/src/skypulse/bluesky.py) |
| ingestor-config | ConfigMap (generated) | n/a | [`config.env`](../../../skypulse/k8s/base/ingestion/config.env) |
| ingestor-db-credentials | Secret (from `make secrets`) | n/a | [`Makefile` L93](../../../skypulse/Makefile#L93) |

## The rules it follows

### Network ([`ingestion/networkpolicies.yaml`](../../../skypulse/k8s/base/ingestion/networkpolicies.yaml))

| Direction | Allowed | Where in the code |
|---|---|---|
| **In** | Nothing at all (`ingress: []`) | [L43](../../../skypulse/k8s/base/ingestion/networkpolicies.yaml#L43) |
| **Out** | PostgreSQL in `skypulse-data`, port 5432 only | [L46-L54](../../../skypulse/k8s/base/ingestion/networkpolicies.yaml#L46-L54) |
| **Out** | The internet, HTTPS (443) only, **excluding** private, carrier-grade NAT and link-local ranges | [L56-L66](../../../skypulse/k8s/base/ingestion/networkpolicies.yaml#L56-L66) |
| **Out** | DNS (CoreDNS) | [L13-L31](../../../skypulse/k8s/base/ingestion/networkpolicies.yaml#L13-L31) |

The `except` list is what keeps a compromised ingestor from scanning the LAN or reaching a cloud metadata endpoint (`169.254.169.254`). It can reach Bluesky, but nothing on the local network apart from the database.

### Database: the `ingestor` role

It logs in with its own user, from the Secret `ingestor-db-credentials` ([`ingestor.yaml` L35-L45](../../../skypulse/k8s/base/ingestion/ingestor.yaml#L35-L45)). The migrate Job grants it only ([`db.py` L109-L114](../../../skypulse/src/skypulse/db.py#L109-L114)):

- `SELECT (id, kind, value)` on `subscriptions`: which handles and hashtags to fetch, and nothing else about them
- `UPDATE (last_polled_at, last_error)` on `subscriptions`: to record poll status
- `INSERT` on `posts`

It can't read posts, summaries or the analysts' data, delete anything, or change the schema. The schema owner's credentials (`feeddb-app`) never leave `skypulse-data`.

### Pod hardening ([`ingestor.yaml` L22-L70](../../../skypulse/k8s/base/ingestion/ingestor.yaml#L22-L70))

Non-root, all capabilities dropped, read-only root filesystem with a writable `/tmp` (for the heartbeat file), and no Kubernetes API token.

## The component: ingestor

**What it runs.** The shared `skypulse-app` image with `args: ["ingestor"]` ([`ingestor.yaml` L31](../../../skypulse/k8s/base/ingestion/ingestor.yaml#L31)). [`__main__.py`](../../../skypulse/src/skypulse/__main__.py) dispatches that to `ingestor.run()`.

**The loop** ([`ingestor.py` L62-L85](../../../skypulse/src/skypulse/ingestor.py#L62-L85)):

1. `wait_for_db()` connects, retrying while the database starts.
2. **`poll_once()`** ([L25-L59](../../../skypulse/src/skypulse/ingestor.py#L25-L59)):
   - reads `SELECT id, kind, value FROM subscriptions`;
   - for each subscription, `client.fetch()` calls Bluesky ([`bluesky.py` L70-L87](../../../skypulse/src/skypulse/bluesky.py#L70-L87)): handles use `app.bsky.feed.getAuthorFeed` (own posts, no replies), hashtags use `app.bsky.feed.searchPosts` (latest);
   - inserts the posts in one transaction with **`ON CONFLICT DO NOTHING`**. `UNIQUE(subscription_id, uri)` makes re-polling, or a second replica, harmless;
   - records `last_polled_at` and `last_error`. An unknown handle (HTTP 400 → `TargetNotFound`) becomes `"Not found on Bluesky: …"`, which the analyst sees on the subscription's card.
3. Writes the **heartbeat** file, then sleeps `POLL_INTERVAL_SECONDS` (60).

**Parsing** ([`bluesky.py` L33-L59](../../../skypulse/src/skypulse/bluesky.py#L33-L59)) drops posts with no text (image-only posts carry no sentiment the model can read) and reposts (not the author's own words).

**Configuration** ([`ingestion/config.env`](../../../skypulse/k8s/base/ingestion/config.env)): `BSKY_API_BASE=https://api.bsky.app`, `POLL_INTERVAL_SECONDS=60`, `FETCH_LIMIT=50`, and `PGHOST=feeddb-rw.skypulse-data.svc.cluster.local` with `PGSSLMODE=require`. The database is in another namespace, so it needs the fully qualified name, and CNPG serves TLS by default.

**Health.** A worker has no HTTP port, so the liveness probe checks that `/tmp/heartbeat` was touched in the last 10 minutes ([`ingestor.yaml` L52-L59](../../../skypulse/k8s/base/ingestion/ingestor.yaml#L52-L59); [`db.heartbeat()`](../../../skypulse/src/skypulse/db.py#L155-L158)). If the loop gets stuck, the kubelet restarts the container.

## How it handles failure

| What happens | What the ingestor does |
|---|---|
| Bluesky down or slow | `httpx.HTTPError` → stored in `last_error`; tried again next round |
| Database failover | `psycopg.OperationalError` → reconnects through `feeddb-rw`, which now points at the new primary ([L79-L83](../../../skypulse/src/skypulse/ingestor.py#L79-L83)) |
| First install, schema not created yet | `UndefinedTable` / `InsufficientPrivilege` → waits for the migrate Job ([L74-L78](../../../skypulse/src/skypulse/ingestor.py#L74-L78)) |
| Subscription deleted mid-poll | `ForeignKeyViolation` → skips it ([L46-L49](../../../skypulse/src/skypulse/ingestor.py#L46-L49)) |
| Pod dies | Deployment recreates it. Analysts don't notice, because nothing on their path depends on the ingestor. |

One replica is enough: if it's down, posts arrive a little later, but the analysts' app keeps working.

## What `make verify` proves here ([`verify.sh` L54-L68](../../../skypulse/scripts/verify.sh#L54-L68))

- ✅ ingestor → internet (`api.bsky.app:443`) **allowed**
- ✅ ingestor → PostgreSQL **allowed**
- ❌ ingestor → api **blocked** (the zones never talk directly)
- ❌ ingestor → llm **blocked**
- ❌ ingestor's role **cannot** `DELETE FROM subscriptions`

## Design decisions behind it

[`skypulse/DESIGN.md`](../../../skypulse/DESIGN.md): D-1 (asynchronous pipeline), D-2 (PostgreSQL as the work queue), D-6 (the security boundary). Known limitations: polling rather than streaming (§5 #7); a separate cluster or DMZ for higher assurance (§5 #4).
