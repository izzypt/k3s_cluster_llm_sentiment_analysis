"""Analyst-facing web application: a JSON API plus a single-page UI.

The API never calls the LLM or Bluesky: it only reads precomputed summaries from
PostgreSQL. That keeps it fast and means analysts keep working even while the LLM
or the ingestor are down or being updated.
"""

import logging
from contextlib import asynccontextmanager
from importlib import resources

from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import HTMLResponse
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from pydantic import BaseModel

from skypulse.config import settings
from skypulse.targets import InvalidTarget, parse_target

log = logging.getLogger("skypulse.api")

# check=... validates a connection before handing it out, so after a database failover
# the pool transparently replaces connections that pointed at the old primary.
pool = ConnectionPool(
    settings.database_url,
    min_size=1,
    max_size=10,
    open=False,
    check=ConnectionPool.check_connection,
    kwargs={"row_factory": dict_row, "connect_timeout": 5},
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    pool.open(wait=False)
    yield
    pool.close()


app = FastAPI(title="SkyPulse", lifespan=lifespan)


class SubscriptionIn(BaseModel):
    target: str  # "@handle.bsky.social" or "#hashtag"
    kind: str | None = None  # optional explicit "handle" | "hashtag"


_LIST_SQL = """
SELECT s.id, s.kind, s.value, s.created_at, s.last_polled_at, s.last_error,
       sm.summary, sm.overall, sm.positive, sm.neutral, sm.negative, sm.item_count,
       sm.window_start, sm.window_end, sm.updated_at AS summary_updated_at,
       (SELECT count(*) FROM posts p
         WHERE p.subscription_id = s.id AND p.analyzed_at IS NULL) AS pending
FROM subscriptions s
LEFT JOIN summaries sm ON sm.subscription_id = s.id
ORDER BY s.created_at
"""


@app.get("/api/subscriptions")
def list_subscriptions() -> list[dict]:
    with pool.connection() as conn:
        rows = conn.execute(_LIST_SQL).fetchall()
    for row in rows:
        row["display"] = f"@{row['value']}" if row["kind"] == "handle" else f"#{row['value']}"
    return rows


@app.post("/api/subscriptions", status_code=201)
def subscribe(body: SubscriptionIn) -> dict:
    try:
        target = parse_target(body.target, body.kind)
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
    log.info("subscribed to %s", target.display)
    return {"id": row["id"], "kind": target.kind, "value": target.value}


@app.delete("/api/subscriptions/{sub_id}", status_code=204)
def unsubscribe(sub_id: int) -> Response:
    with pool.connection() as conn:
        deleted = conn.execute("DELETE FROM subscriptions WHERE id = %s", (sub_id,)).rowcount
    if not deleted:
        raise HTTPException(status_code=404, detail="subscription not found")
    log.info("unsubscribed from %s", sub_id)
    return Response(status_code=204)


@app.get("/healthz")
def healthz() -> dict:
    """Liveness: the process is up and serving HTTP. Deliberately does NOT check the database:
    a database outage should take pods out of the load balancer (readiness), not restart them."""
    return {"status": "ok"}


@app.get("/readyz")
def readyz() -> dict:
    """Readiness: only receive traffic when the database is reachable and migrated."""
    try:
        with pool.connection(timeout=2) as conn:
            conn.execute("SELECT 1 FROM subscriptions LIMIT 1")
    except Exception as exc:  # psycopg errors and pool timeouts alike
        raise HTTPException(status_code=503, detail=f"database unavailable: {exc}") from exc
    return {"status": "ready"}


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return resources.files("skypulse").joinpath("static/index.html").read_text(encoding="utf-8")
