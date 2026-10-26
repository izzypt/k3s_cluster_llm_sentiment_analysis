# 8 · Code flow: how the pieces interact, step by step

Parts: [1 Overview](01-overview.md) · [2 Application](02-application.md) · [3 Build](03-build.md) · [4 Platform](04-platform.md) · [5 Delivery & operations](05-delivery-and-operations.md) · [6 Security boundary](06-security-boundary.md) · [7 Runtime](07-runtime.md) · **8 Code flow**

[2 Application](02-application.md) describes the modules. This part follows the code as it runs, with snippets from `skypulse/src/skypulse/`, from process start to a summary on the analyst's screen.

## 8.1 Who talks to whom

```
 browser (static/index.html)
    │  fetch /api/subscriptions  (every 10 s, and on add/delete)
    ▼
 api.py ──────────── SQL ──────────┐
                                   ▼
 ingestor.py ── SQL ──────────► PostgreSQL ◄──── SQL ──── analyzer.py
    │                              ▲                         │
    │ bluesky.py (HTTP)            │ db.migrate()            │ llm.py (HTTP)
    ▼                              │                         ▼
 Bluesky API                    migrate Job               Ollama (llm pod)
```

The processes never call each other. Every interaction between them is a row written by one and read by another. Within a process, the imports are:

| Role | Imports |
|---|---|
| every role | `__main__` → `config.settings`, `db` |
| `api` | `api` → `targets` |
| `ingestor` | `ingestor` → `bluesky` |
| `analyzer` | `analyzer` → `llm` |
| `migrate` | `db.migrate` |

### "Asynchronous pipeline": an architecture, not `async`/`await`

`DESIGN.md` D-1 calls this an *asynchronous pipeline*. That describes the architecture: the slow work (Bluesky, the LLM at ~1.5 s per post) happens **outside the analyst's request**, in separate processes on their own schedule, and the API only reads precomputed rows.

```
synchronous (avoided):  analyst clicks → API calls Bluesky → API calls the LLM 50× → answer after a minute+
asynchronous (used):    ingestor and analyzer loop on their own; analyst clicks → SELECT → answer in ms
```

No async framework is involved: no asyncio, Celery or message broker. The tools are separate processes (one Deployment per role), plain `while True` loops, and Postgres in between. The code itself is synchronous (sync `httpx` and `psycopg`; FastAPI runs `def` endpoints in a thread pool). This decoupling is also the main HA lever: the LLM, the ingestor or Bluesky can be down while analysts still see the last summaries.

## 8.2 Startup: the same for every role

The container runs `skypulse <role>` (see [3 Build › How the role reaches `main()`](03-build.md#35-how-the-role-reaches-main)), which calls `main()` in `__main__.py`:

```python
from skypulse.config import settings      # ← runs config.py first

def main() -> None:
    parser = argparse.ArgumentParser(prog="skypulse")
    parser.add_argument("role", choices=["api", "ingestor", "analyzer", "migrate"])
    args = parser.parse_args()

    logging.basicConfig(level=settings.log_level, ...)
    logging.getLogger("httpx").setLevel(logging.WARNING)   # httpx logs every request at INFO

    if args.role == "api":
        import uvicorn
        uvicorn.run("skypulse.api:app", host="0.0.0.0", port=settings.http_port, ...)
    elif args.role == "ingestor":
        from skypulse.ingestor import run
        run()
    ...
```

- **Settings are read once, at import.** `config.py` builds a frozen `Settings` object from environment variables, filled in by the ConfigMap and Secret (`PGHOST`, `LLM_URL`, `POLL_INTERVAL_SECONDS`, …):

  ```python
  @dataclass(frozen=True)
  class Settings:
      database_url: str = field(default_factory=lambda: os.environ.get("DATABASE_URL", ""))
      poll_interval_seconds: int = field(default_factory=lambda: _int("POLL_INTERVAL_SECONDS", 60))
      llm_url: str = field(default_factory=lambda: os.environ.get("LLM_URL", "http://llm:11434"))
      ...
  settings = Settings()
  ```

- **An empty `DATABASE_URL` is deliberate.** `db.connect()` passes it to psycopg, and libpq then reads the standard variables `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE` from the environment. The app pods get those from their ConfigMap and Secret; only the migrate Job sets `DATABASE_URL` (the owner's URI).
- **Each role imports only its own modules.** The `import` statements sit inside the `if` branches, so the ingestor never loads FastAPI and the API never loads the Bluesky client.

## 8.3 `migrate`: preparing the database

Runs first on every deploy, as a Job. `db.migrate()`:

```python
def migrate() -> None:
    with wait_for_db() as conn:                       # retry every 3 s while Postgres starts
        conn.autocommit = True
        conn.execute("SELECT pg_advisory_lock(%s)", (_MIGRATION_LOCK_ID,))   # one migration at a time
        try:
            conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (...)")
            applied = {row[0] for row in conn.execute("SELECT version FROM schema_migrations")}
            for version, statements in MIGRATIONS:
                if version in applied:
                    continue                          # already done: idempotent
                with conn.transaction():              # schema change + bookkeeping, atomically
                    conn.execute(statements)
                    conn.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (version,))
            _grant(conn, "ingestor", (...))           # least-privilege rights, every time
            _grant(conn, "analysis", (...))
            _grant(conn, "pg_monitor", (...))
        finally:
            conn.execute("SELECT pg_advisory_unlock(%s)", (_MIGRATION_LOCK_ID,))
```

- `wait_for_db()` is shared by all roles: it retries the connection every 3 s for up to 5 minutes, because right after a deploy the database may still be starting.
- `schema_migrations` records which versions ran, so running the Job again changes nothing.
- `_grant` first waits for the role to exist (CloudNativePG creates it, sometimes a few seconds after the database is up), then applies the `GRANT`s.

Until this has run, the other roles get `UndefinedTable` or `InsufficientPrivilege`. They catch both, log "schema not ready" and retry every 5 s (see 8.5 and 8.6), so the start order doesn't matter.

## 8.4 `api`: the analyst's side

### Startup

```python
pool = ConnectionPool(
    settings.database_url, min_size=1, max_size=10, open=False,
    check=ConnectionPool.check_connection,      # validate before handing out: survives failover
    kwargs={"row_factory": dict_row, "connect_timeout": 5},
)

@asynccontextmanager
async def lifespan(_: FastAPI):
    pool.open(wait=False)      # don't block startup if the database isn't up yet
    yield
    pool.close()

app = FastAPI(title="SkyPulse", lifespan=lifespan)
```

A pool of up to 10 connections is shared by all requests. `dict_row` makes each row a dict, so it can be returned as JSON directly. `check_connection` tests a connection before lending it out: after a Postgres failover, connections to the old primary are replaced transparently.

### The browser

`GET /` returns `static/index.html`, a single page whose JavaScript calls the API:

```javascript
async function refresh() {
  const res = await fetch("/api/subscriptions");
  const subs = await res.json();
  $("#list").innerHTML = subs.map(card).join("");
}
refresh();
setInterval(refresh, 10000);          // poll every 10 s: summaries appear without reloading
```

### Subscribe: `POST /api/subscriptions`

```python
class SubscriptionIn(BaseModel):
    target: str                  # "@handle.bsky.social" or "#hashtag"
    kind: str | None = None

@app.post("/api/subscriptions", status_code=201)
def subscribe(body: SubscriptionIn) -> dict:
    try:
        target = parse_target(body.target, body.kind)          # targets.py: format only
    except InvalidTarget as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO subscriptions (kind, value) VALUES (%s, %s)"
            " ON CONFLICT (kind, value) DO NOTHING RETURNING id",
            (target.kind, target.value),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=409, detail=f"already subscribed to {target.display}")
    return {"id": row["id"], "kind": target.kind, "value": target.value}
```

1. FastAPI validates the JSON body against `SubscriptionIn` (pydantic).
2. `parse_target` normalizes the input: `#Kubernetes` → `Target(kind="hashtag", value="kubernetes")`, `@bsky.app` → `Target(kind="handle", value="bsky.app")`. It checks only the **shape**, with regular expressions: the API has no internet access, so it can't ask Bluesky whether the handle exists.
3. The INSERT creates the subscription. `ON CONFLICT ... RETURNING id` returns nothing for a duplicate, which becomes HTTP 409.

That's all the API does. It doesn't trigger the ingestor or the analyzer: they will discover the new row on their next loop.

### List: `GET /api/subscriptions`

One query builds the whole screen:

```sql
SELECT s.id, s.kind, s.value, s.created_at, s.last_polled_at, s.last_error,
       sm.summary, sm.overall, sm.positive, sm.neutral, sm.negative, sm.item_count,
       sm.window_start, sm.window_end, sm.updated_at AS summary_updated_at,
       (SELECT count(*) FROM posts p
         WHERE p.subscription_id = s.id AND p.analyzed_at IS NULL) AS pending
FROM subscriptions s
LEFT JOIN summaries sm ON sm.subscription_id = s.id
ORDER BY s.created_at
```

- `LEFT JOIN`: a new subscription has no summary yet; it still appears, with NULLs ("Waiting for the first analysis…").
- `last_error` is written by the **ingestor** (8.5), so this is how "handle not found" reaches the analyst.
- `pending` counts the posts still in the analysis queue (8.6).

### Unsubscribe: `DELETE /api/subscriptions/{id}`

```python
deleted = conn.execute("DELETE FROM subscriptions WHERE id = %s", (sub_id,)).rowcount
```

`ON DELETE CASCADE` on `posts` and `summaries` removes everything belonging to it, in the same statement.

### Probes

```python
@app.get("/healthz")            # liveness: the process answers HTTP. Never checks the database,
def healthz(): ...              # so a database outage doesn't restart every API pod

@app.get("/readyz")             # readiness: database reachable and migrated
def readyz():
    with pool.connection(timeout=2) as conn:
        conn.execute("SELECT 1 FROM subscriptions LIMIT 1")
```

## 8.5 `ingestor`: from Bluesky into the queue

### The loop (`ingestor.run`)

```python
def run() -> None:
    db.heartbeat()
    client = BlueskyClient(settings.bsky_api_base)
    conn = db.wait_for_db()
    while True:
        try:
            poll_once(conn, client)
        except (psycopg.errors.UndefinedTable, psycopg.errors.InsufficientPrivilege) as exc:
            log.warning("schema not ready (%s), waiting for migrations", ...)   # migrate hasn't run yet
            conn.rollback()
            time.sleep(5)
        except psycopg.OperationalError as exc:
            log.warning("database connection lost (%s), reconnecting", exc)    # e.g. a failover
            conn.close()
            conn = db.wait_for_db()
        db.heartbeat()                           # liveness probe: "the loop is still turning"
        time.sleep(settings.poll_interval_seconds)    # 60 s
```

`db.heartbeat()` writes the current time to `/tmp/heartbeat`. The pod's liveness probe restarts the container if that file is older than 10 minutes, which catches a loop that hangs without crashing.

### One poll (`ingestor.poll_once`)

```python
def poll_once(conn, client) -> None:
    subscriptions = conn.execute("SELECT id, kind, value FROM subscriptions").fetchall()
    conn.commit()

    for sub_id, kind, value in subscriptions:
        error = None
        try:
            posts = client.fetch(kind, value, settings.fetch_limit)        # bluesky.py
            with conn.transaction():
                for post in posts:
                    conn.execute(
                        "INSERT INTO posts (subscription_id, uri, author, text, posted_at)"
                        " VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
                        (sub_id, post.uri, post.author, post.text, post.posted_at),
                    )
        except TargetNotFound as exc:
            error = f"Not found on Bluesky: {exc}"
        except httpx.HTTPError as exc:
            error = f"Bluesky request failed: {exc}"
        except psycopg.errors.ForeignKeyViolation:
            conn.rollback()
            continue                                  # unsubscribed while we were polling

        conn.execute(
            "UPDATE subscriptions SET last_polled_at = now(), last_error = %s WHERE id = %s",
            (error, sub_id),
        )
        conn.commit()
```

- The ingestor reads **only** `id, kind, value`: its database role has no right to read anything else (see [6 Security boundary](06-security-boundary.md#65-layer-3-database-least-privilege)).
- One failing subscription doesn't stop the others: its error is recorded and the loop moves on.
- `last_error = NULL` on success clears an earlier error.

### Fetching from Bluesky (`bluesky.py`)

```python
def fetch(self, kind, value, limit) -> list[Post]:
    if kind == "handle":
        resp = self._http.get("/xrpc/app.bsky.feed.getAuthorFeed",
                              params={"actor": value, "limit": limit, "filter": "posts_no_replies"})
        parse = parse_author_feed
    else:
        resp = self._http.get("/xrpc/app.bsky.feed.searchPosts",
                              params={"q": f"#{value}", "sort": "latest", "limit": limit})
        parse = parse_search
    if resp.status_code == 400:
        raise TargetNotFound(resp.json().get("message", resp.text))    # unknown handle
    resp.raise_for_status()
    return parse(resp.json())
```

The public Bluesky API needs no account. The parsers skip **reposts** (not the author's own words) and **posts without text** (image-only posts carry no readable sentiment), and turn each post into a small `Post(uri, author, text, posted_at)`.

## 8.6 `analyzer`: the work queue

### The loop (`analyzer.run`)

```python
def run() -> None:
    llm = LLMClient(settings.llm_url, settings.llm_model, settings.llm_timeout_seconds)
    conn = db.wait_for_db()
    while True:
        did_work = False
        try:
            did_work = work_once(conn, llm)
            if time.monotonic() - last_cleanup > 3600:          # once an hour: retention
                conn.execute("DELETE FROM posts WHERE posted_at < now() - make_interval(days => %s)",
                             (RETENTION_DAYS,))                 # 14 days
                conn.commit()
        except httpx.HTTPError as exc:
            log.warning("LLM server not available (%s), retrying", exc)
            conn.rollback()
            time.sleep(5)
        except (psycopg.errors.UndefinedTable, psycopg.errors.InsufficientPrivilege): ...
        except psycopg.OperationalError: ...                     # reconnect, as in the ingestor
        db.heartbeat()
        if not did_work:
            time.sleep(5)                                       # idle: ask again in 5 s
```

When there's a backlog, the loop never sleeps. When the queue is empty, it checks every 5 s.

### One round (`analyzer.work_once`)

```python
def work_once(conn, llm) -> bool:
    did_work = False
    for _ in range(POSTS_PER_ROUND):          # up to 10 posts, one transaction each
        if not analyze_one(conn, llm):
            break
        did_work = True

    stale = conn.execute(_STALE_SUMMARIES, {"max_age": settings.summary_max_age_seconds}).fetchall()
    conn.commit()
    for sub_id, kind, value in stale:
        refresh_summary(conn, llm, sub_id, f"@{value}" if kind == "handle" else f"#{value}")
        did_work = True
    return did_work
```

At most 10 posts per round, then summaries, so a large backlog never starves the summaries.

### Postgres as a work queue

A queue needs a way to add work, to claim it without two workers taking the same item, and to recover when a worker dies. Here it's all plain rows, and one rule makes it work: **a row lock lives exactly as long as the transaction that took it.**

| Queue operation | How |
|---|---|
| **Enqueue** | The ingestor `INSERT`s a post; `analyzed_at IS NULL` means "waiting" |
| **Claim** | `SELECT ... WHERE analyzed_at IS NULL ... FOR UPDATE SKIP LOCKED` |
| **Acknowledge** | `UPDATE ... analyzed_at = now()`, then `COMMIT` |
| **Worker crash** | The transaction rolls back, the lock disappears, and the post is waiting again |
| **Queue length** | `count(*) WHERE analyzed_at IS NULL`: the UI's "pending" |

The table is built for it (`db.py`, migration 1):

```sql
analyzed_at     TIMESTAMPTZ,          -- no DEFAULT: a new row starts as NULL = "waiting"
...
CREATE INDEX posts_unanalyzed ON posts (posted_at DESC) WHERE analyzed_at IS NULL;
```

`posts_unanalyzed` is a **partial index**: it contains only the waiting rows. However big `posts` grows, finding "the newest waiting post" only looks at the queue.

### Claim, work, acknowledge (`analyzer.analyze_one`)

```python
def analyze_one(conn, llm) -> bool:
    with conn.transaction():                                         # (a) BEGIN
        row = conn.execute(
            "SELECT id, text FROM posts WHERE analyzed_at IS NULL"   # (b) waiting posts, newest first
            " ORDER BY posted_at DESC LIMIT 1 FOR UPDATE SKIP LOCKED"  # (c) lock it, skip locked ones
        ).fetchone()
        if not row:
            return False                                             #     queue empty (or all claimed)
        post_id, text = row
        try:
            label, score = llm.classify(text)                        # (d) ~1.5 s, lock still held
        except httpx.HTTPStatusError as exc:
            # The server is up but rejected this one post: don't let it block the queue forever.
            label, score = "neutral", 0.0
        conn.execute(
            "UPDATE posts SET sentiment = %s, score = %s, analyzed_at = now() WHERE id = %s",
            (label, score, post_id),                                 # (e) out of the queue
        )
    return True                                                      # (f) COMMIT: result visible + lock released
```

- **(a)** Opens a transaction. Every lock taken from here on is held until it ends.
- **(b)** Served by the partial index. Newest first is deliberate: after a backlog, recent posts matter more to analysts.
- **(c)** `FOR UPDATE` locks the returned row. `SKIP LOCKED` treats rows locked by someone else as invisible. Without it, a second analyzer would **wait** on the same row, then find it already analyzed.
- **(d)** The LLM call happens **while the lock is held**, which is what makes the claim exclusive.
- **(e)** Setting `analyzed_at` takes the row out of the queue: it no longer matches the `WHERE` and leaves the partial index.
- **(f)** Leaving the block commits. The result becomes visible **and** the lock is released in one atomic step, so there's never a moment when the post is unlocked but not yet marked.

You never release the lock explicitly: commit or rollback does it.

Two kinds of LLM failure are handled differently:

| Failure | Example | What happens |
|---|---|---|
| `HTTPStatusError` | Ollama answers with an error for this specific post | Marked `neutral` and moved on. Otherwise a "poison" post would fail forever at the head of the queue |
| Other `httpx.HTTPError` | Ollama down, connection refused, timeout | Leaves the `with` block → **ROLLBACK** → lock released, post still waiting. `run()` sleeps 5 s and retries |

### Two analyzers side by side

With posts A (newest), B and C waiting:

```
time   analyzer-1                                  analyzer-2
 t0    BEGIN; SELECT ... SKIP LOCKED → A (locks A)
 t1                                                BEGIN; SELECT ... SKIP LOCKED → A locked, skip → B (locks B)
 t2    llm.classify(A) ...                         llm.classify(B) ...
 t3    UPDATE A; COMMIT  → A done, lock released
 t4    BEGIN; SELECT ... → B locked, skip → C
 t5                                                UPDATE B; COMMIT
 t6    UPDATE C; COMMIT
 t7    BEGIN; SELECT ... → nothing → return False
```

No post is analyzed twice, no analyzer waits for another, and nothing coordinates them except the database.

### When things go wrong

| Situation | Result |
|---|---|
| Analyzer pod killed mid-classification | Its connection drops, Postgres aborts the open transaction, the lock disappears. The post is still NULL, so the next `SELECT` picks it up |
| Postgres failover mid-transaction | `OperationalError`; `run()` reconnects. The transaction never committed, so the post is still waiting |
| Ingestor inserts while analyzers work | No conflict: new rows aren't locked by anyone; they're new candidates once committed |
| Analyst unsubscribes during analysis | The `DELETE ... CASCADE` waits for the row lock, then removes the post |

### Why Postgres and not Redis (or RabbitMQ, NATS, Kafka)

`DESIGN.md` D-2:

| Argument | Explanation |
|---|---|
| **One less stateful system** | Postgres is needed anyway and is already HA. A Redis queue would need its own HA, backups, monitoring, upgrades, NetworkPolicies and credentials |
| **No dual-write problem** | With Redis, the ingestor writes the post to Postgres **and** publishes a message. If one succeeds and the other fails, a post is never analyzed or a message points to nothing. Here the data and the queue entry are the same row, in one transaction |
| **Crash recovery for free** | No acknowledgements, visibility timeouts or stuck-message handling: the transaction does it |
| **Security boundary** | A broker would be a second place where the zones meet, with more paths to open and verify |
| **Scale** | The bottleneck is the LLM (~1.5 s per post). Postgres handles thousands of `SKIP LOCKED` claims per second |
| **Visibility** | The queue is queryable with SQL: backlog per subscription, oldest pending post, for the UI and Grafana |

A dedicated broker would win with very high throughput, fan-out to many consumers, streaming with replay (Kafka), or work that isn't tied to rows in the database. If the 5-second idle poll ever mattered, Postgres's `LISTEN/NOTIFY` could wake the analyzer immediately without adding a broker.

### Talking to the LLM (`llm.py`)

Both tasks go through one method, a call to Ollama's chat API:

```python
def _chat(self, system, user, *, fmt, max_tokens) -> str:
    body = {
        "model": self.model,                 # discovered from /api/tags if LLM_MODEL is empty
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "stream": False, "think": False, "keep_alive": "24h",
        "options": {"temperature": 0, "num_predict": max_tokens},
    }
    if fmt:
        body["format"] = fmt                 # JSON schema: Ollama can only produce matching JSON
    resp = self._http.post("/api/chat", json=body)
    resp.raise_for_status()
    return resp.json()["message"]["content"].strip()

def classify(self, text):
    content = self._chat(_CLASSIFY_SYSTEM, text[:2000], fmt=_CLASSIFY_SCHEMA, max_tokens=48)
    return parse_classification(content)
```

- **`classify`** sends one post with a JSON schema (`{"sentiment": "positive"|"neutral"|"negative", "score": number}`), so the answer is always parseable. `parse_classification` still checks defensively: it clamps the score to [-1, 1], falls back to a regex if the JSON is broken, and fixes contradictions (a "positive" label with a negative score).
- **`temperature: 0`** makes answers repeatable: the same post gets the same label.
- **The model name** isn't configured twice: if `LLM_MODEL` is empty, the client asks Ollama (`/api/tags`) which model is baked into the image.

### Summaries (`_STALE_SUMMARIES` and `refresh_summary`)

Which subscriptions need a new summary:

```sql
WHERE sm.subscription_id IS NULL                                          -- never summarised
   OR sm.updated_at < now() - make_interval(secs => %(max_age)s)          -- older than 15 min
   OR (EXISTS (SELECT 1 FROM posts p                                      -- new results since the
               WHERE p.subscription_id = s.id AND p.analyzed_at > sm.updated_at)   -- last summary...
       AND (NOT EXISTS (... p.analyzed_at IS NULL)                        -- ...and the backlog is drained
            OR sm.updated_at < now() - interval '60 seconds'))            -- or it's been a minute
```

`analyzed_at`, written in step (e) above, is also the signal that a subscription has something new. The last condition avoids rewriting a summary after every single post while a backlog is being processed.

Rebuilding one summary:

```python
def refresh_summary(conn, llm, sub_id, target) -> None:
    with conn.transaction():
        locked = conn.execute("SELECT pg_try_advisory_xact_lock(42, %s)", (sub_id,)).fetchone()[0]
        if not locked:
            return                                    # another replica is summarising this one
        posts = conn.execute(
            "SELECT text, sentiment, score, posted_at FROM posts"
            " WHERE subscription_id = %s AND analyzed_at IS NOT NULL"
            "   AND posted_at > now() - make_interval(hours => %s)"        # last 7 days
            " ORDER BY posted_at DESC LIMIT %s",                           # newest 50
            (sub_id, settings.summary_window_hours, settings.summary_max_items),
        ).fetchall()
        counts = {"positive": 0, "neutral": 0, "negative": 0}
        for _, label, _, _ in posts:
            counts[label] += 1
        summary = llm.summarize(target, [(text, label) for text, label, _, _ in posts])
        conn.execute("INSERT INTO summaries (...) VALUES (...)"
                     " ON CONFLICT (subscription_id) DO UPDATE SET ...", (...))   # upsert
```

- The same claim idea one level up: `pg_try_advisory_xact_lock(42, sub_id)` locks the *number* `sub_id` instead of a row. If another replica holds it, this one skips that subscription. It's released at commit.
- **The counts are computed in Python**, not by the LLM: the numbers the analyst sees are exact.
- **The overall label** (`overall_label`) is the mean score: above 0.2 positive, below -0.2 negative, otherwise "mixed" if there are strong opinions both ways, else neutral.
- **The text** comes from `llm.summarize`: up to 25 posts with their labels, and a prompt asking for at most two sentences.
- The upsert keeps exactly one summary row per subscription.

## 8.7 The whole journey of one subscription

```
t = 0 s     analyst types "#kubernetes", clicks Add
            index.html  POST /api/subscriptions
            api         parse_target → INSERT subscriptions → 201

t ≤ 60 s    ingestor    SELECT subscriptions → sees #kubernetes
            bluesky     GET searchPosts?q=#kubernetes → 50 posts
            ingestor    INSERT posts (analyzed_at NULL) → COMMIT        → 50 posts queued
            ingestor    UPDATE subscriptions SET last_polled_at, last_error = NULL

t ≤ 10 s    index.html  GET /api/subscriptions → card shows "pending: 50", no summary yet
(repeats)

~1.5 s/post analyzer    BEGIN; SELECT ... FOR UPDATE SKIP LOCKED → newest waiting post
            llm         POST /api/chat (classify, JSON schema) → {"sentiment", "score"}
            analyzer    UPDATE posts SET sentiment, score, analyzed_at → COMMIT   (× 10 per round)
            analyzer    _STALE_SUMMARIES → #kubernetes has never been summarised
            analyzer    advisory lock → SELECT newest 50 analysed posts → counts
            llm         POST /api/chat (summarize) → two sentences
            analyzer    INSERT ... ON CONFLICT DO UPDATE summaries → COMMIT

next 10 s   index.html  GET /api/subscriptions → summary, overall label, counts, "updated at"

afterwards  ingestor polls every 60 s (only new posts get inserted)
            analyzer refreshes the summary when new posts are analysed, and at least every 15 min
            analyzer deletes posts older than 14 days, once an hour
```

## 8.8 Failure handling, all in one place

| What fails | Who notices | What happens |
|---|---|---|
| Database not up yet | every role | `wait_for_db()` retries every 3 s; the API's `/readyz` fails, so it gets no traffic |
| Schema not migrated yet | ingestor, analyzer | `UndefinedTable` / `InsufficientPrivilege` → "schema not ready", retry every 5 s |
| Postgres failover | every role | Connections break; workers reconnect, the API pool replaces connections, uncommitted work rolls back |
| Bluesky down or handle unknown | ingestor | Written to `last_error`, shown in the UI; other subscriptions continue |
| LLM down | analyzer | Rollback, post stays queued, retry every 5 s; the API keeps serving the last summaries |
| LLM rejects one post | analyzer | Marked neutral so it doesn't block the queue |
| A worker's loop hangs | kubelet | Heartbeat file older than 10 min → liveness probe restarts the container |
| An API pod crashes | Kubernetes | Other replicas keep serving; the Deployment replaces it |
