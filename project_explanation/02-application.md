# 2 · Application: what the code does

Parts: [1 Overview](01-overview.md) · **2 Application** · [3 Build](03-build.md) · [4 Platform](04-platform.md) · [5 Delivery & operations](05-delivery-and-operations.md) · [6 Security boundary](06-security-boundary.md) · [7 Runtime](07-runtime.md) · [8 Code flow](08-code-flow.md)

Everything here lives in `skypulse/src/skypulse/` (≈900 lines) and `skypulse/tests/`.

## 2.1 The central idea: Postgres is the hub

The four roles never call each other. Each one only reads and writes the database. The analyzer is the only one that also calls something else, the LLM.

This is why the security zones work. The internet-facing ingestor and the analysis side share no network path except the database port, and the database grants each one only what it needs.

## 2.2 One program, four roles

`__main__.py` is the single entrypoint:

```python
parser.add_argument("role", choices=["api", "ingestor", "analyzer", "migrate"])
args = parser.parse_args()        # reads sys.argv[1:]
if args.role == "api": uvicorn.run("skypulse.api:app", ...)
elif args.role == "ingestor": ingestor.run()
elif args.role == "analyzer": analyzer.run()
elif args.role == "migrate": db.migrate()
```

How the role gets from a Kubernetes manifest into `sys.argv` is explained once, in [3 Build › How the role reaches `main()`](03-build.md#35-how-the-role-reaches-main).

## 2.3 The modules

| Module | What it is | Used by |
|---|---|---|
| `__main__.py` | Entrypoint: picks the role | all |
| `config.py` | All settings, read from environment variables | all |
| `db.py` | Connections, the schema (migrations), grants, heartbeat | all |
| `targets.py` | Validates `@handle` / `#hashtag` input | api |
| `api.py` | FastAPI: JSON API + serves `static/index.html` | api |
| `bluesky.py` | HTTP client for Bluesky's public API | ingestor |
| `ingestor.py` | Polling loop: Bluesky → `posts` | ingestor |
| `llm.py` | HTTP client for Ollama: `classify()` and `summarize()` | analyzer |
| `analyzer.py` | Work loop: classifies posts, writes `summaries` | analyzer |

The layering is simple: the role modules use the client modules, and everything uses `config` and `db`.

## 2.4 The data model (`db.py`, migration 1)

```
subscriptions (id, kind, value, last_polled_at, last_error)      ← what analysts follow
   │ 1:N
posts (subscription_id, uri, text, posted_at, sentiment, score, analyzed_at)
   │ analyzed_at IS NULL = waiting for the LLM
   │ N:1 (aggregated)
summaries (subscription_id, summary, overall, positive/neutral/negative, item_count, updated_at)
```

The schema belongs to the application. Keeping the database itself alive (replicas, failover, storage) belongs to the platform: see [4 Platform › PostgreSQL](04-platform.md#45-postgresql-cloudnativepg).

## 2.5 One subscription's journey

1. **The analyst adds `#kubernetes`** (`api.py` `subscribe`). `targets.py` checks only the format, because the API has no internet access and can't ask Bluesky whether the target exists. It then inserts a row into `subscriptions`.
2. **The ingestor polls** (`ingestor.py` `poll_once`, every 60 s). It reads all subscriptions and calls Bluesky (`getAuthorFeed` for handles, `searchPosts` for hashtags). New posts are stored with `ON CONFLICT DO NOTHING`, so polling the same posts again never creates duplicates. Errors such as an unknown handle go into `last_error`, which the UI displays.
3. **The analyzer classifies** (`analyzer.py` `analyze_one`). It takes the newest unanalyzed post with `FOR UPDATE SKIP LOCKED`, asks the LLM for `{"sentiment", "score"}` (forced to valid JSON by a schema) and fills in `sentiment`, `score` and `analyzed_at`.
4. **The analyzer summarizes** (`refresh_summary`). The `_STALE_SUMMARIES` query picks subscriptions that have no summary yet, whose summary is older than 15 minutes, or that have newly analyzed posts. For each one it asks the LLM for a two-sentence briefing and upserts it into `summaries`.
5. **The analyst sees it** (`api.py` `list_subscriptions`). That's one SQL query joining subscriptions, summaries and a count of pending posts. The API **never calls the LLM**, so it stays fast and keeps working while the LLM is down.

[8 Code flow](08-code-flow.md) follows this journey through the actual code, step by step.

## 2.6 Patterns that make it Kubernetes-friendly

| Pattern | Where | Why it matters |
|---|---|---|
| Config only from env vars | `config.py` | The same image runs everywhere; ConfigMaps and Secrets fill in the values |
| Stateless roles | all | Pods can be killed, moved or scaled freely; all state lives in Postgres |
| Idempotent writes | `ON CONFLICT` in the ingestor and api | Retries and extra replicas are harmless |
| `SKIP LOCKED` + advisory locks | analyzer | Several analyzer replicas never do the same work twice |
| Advisory lock in migrations | `db.migrate` | Concurrent migration runs are safe |
| Least-privilege grants | `db.migrate` → `_grant` | The ingestor can only insert posts and update poll status; it can't read summaries or delete anything |
| Retry and reconnect loops | `wait_for_db`, `except OperationalError` | Survives a Postgres failover or a slow first start |
| Heartbeat file | `db.heartbeat` | The liveness probe of the background workers (they have no HTTP port) |
| `/healthz` vs `/readyz` | api | A database outage takes pods out of rotation (readiness) instead of restarting them (liveness) |

## 2.7 Tests (`skypulse/tests/`)

Unit tests for the pure functions, the parts that don't need a database, an LLM or the internet:

| File | Tests |
|---|---|
| `test_targets.py` | Valid and invalid handles/hashtags, explicit `kind`, display format |
| `test_bluesky.py` | Parsing Bluesky responses: skipping reposts and empty posts, search results |
| `test_llm.py` | Parsing the model's answer defensively, the overall label from scores |

Run them with `uv run pytest` or `make test`. `make build` runs them before building any image, so a failing test stops the build. The behaviour with real Postgres, Bluesky and the LLM is checked on the running cluster by `make verify` (see [5 Delivery](05-delivery-and-operations.md#55-scripts)).
