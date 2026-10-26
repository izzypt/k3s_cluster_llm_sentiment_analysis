"""Database access: connections, schema migrations and the queries shared by all roles.

PostgreSQL is the only state in the system. Every other component is stateless,
which is what lets Kubernetes kill, move and replace pods freely.


Order on a fresh install:
"CNPG creates the login roles. The migrate Job creates the schema and then grants each role column-level rights on it."

1. make secrets creates the passwords as Secrets.
2. CNPG creates the database, the owner skypulse, and the logins ingestor and analysis.
3. The migrate Job runs the CREATE TABLEs (the schema) and then the GRANTs (the permissions).

Until step 3, the workers get UndefinedTable or InsufficientPrivilege and wait 5 seconds before retrying. That's the "schema not ready" branch in the analyzer loop.


"""

import logging
import os
import time

import psycopg
from psycopg import sql

from skypulse.config import settings

log = logging.getLogger(__name__)

# Arbitrary constant: only one migration runs at a time, even if several API pods start at once.
_MIGRATION_LOCK_ID = 727_274

MIGRATIONS: list[tuple[int, str]] = [
    (
        1,
        """
        CREATE TABLE subscriptions (
            id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            kind           TEXT NOT NULL CHECK (kind IN ('handle', 'hashtag')),
            value          TEXT NOT NULL,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_polled_at TIMESTAMPTZ,
            last_error     TEXT,
            UNIQUE (kind, value)
        );

        CREATE TABLE posts (
            id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            subscription_id BIGINT NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
            uri             TEXT NOT NULL,
            author          TEXT NOT NULL,
            text            TEXT NOT NULL,
            posted_at       TIMESTAMPTZ NOT NULL,
            ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            sentiment       TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative')),
            score           REAL,
            analyzed_at     TIMESTAMPTZ,
            UNIQUE (subscription_id, uri)
        );
        CREATE INDEX posts_unanalyzed ON posts (posted_at DESC) WHERE analyzed_at IS NULL;
        CREATE INDEX posts_by_subscription ON posts (subscription_id, posted_at DESC);

        CREATE TABLE summaries (
            subscription_id BIGINT PRIMARY KEY REFERENCES subscriptions (id) ON DELETE CASCADE,
            summary         TEXT NOT NULL,
            overall         TEXT NOT NULL,
            positive        INT NOT NULL,
            neutral         INT NOT NULL,
            negative        INT NOT NULL,
            item_count      INT NOT NULL,
            window_start    TIMESTAMPTZ,
            window_end      TIMESTAMPTZ,
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """,
    ),
]


def connect(autocommit: bool = False) -> psycopg.Connection:
    # An empty conninfo makes libpq read PGHOST/PGUSER/PGPASSWORD/PGDATABASE from the env.
    return psycopg.connect(settings.database_url, autocommit=autocommit, connect_timeout=5)


def wait_for_db(timeout: float = 300) -> psycopg.Connection:
    """Connect, retrying while the database is still starting (normal right after a deploy)."""
    deadline = time.monotonic() + timeout
    while True:
        try:
            return connect()
        except psycopg.OperationalError as exc:
            if time.monotonic() > deadline:
                raise
            log.warning("database not reachable yet (%s), retrying in 3s", exc)
            time.sleep(3)


def migrate() -> None:
    """Apply pending schema migrations, then grant each application role its least-privilege rights.

    Runs as a Job in the data namespace (the only place holding the owner's credentials) on
    every deploy. It must therefore be idempotent and safe to run concurrently.
    """
    with wait_for_db() as conn:
        conn.autocommit = True
        conn.execute("SELECT pg_advisory_lock(%s)", (_MIGRATION_LOCK_ID,))
        try:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                " version INT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            )
            applied = {row[0] for row in conn.execute("SELECT version FROM schema_migrations")}
            for version, statements in MIGRATIONS:
                if version in applied:
                    continue
                log.info("applying migration %s", version)
                with conn.transaction():
                    conn.execute(statements)
                    conn.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (version,))
            # The internet-facing ingestor may only read targets, record poll status, insert posts.
            _grant(conn, os.environ.get("INGESTOR_DB_ROLE", "ingestor"), (
                "GRANT USAGE ON SCHEMA public TO {}",
                "GRANT SELECT (id, kind, value) ON subscriptions TO {}",
                "GRANT UPDATE (last_polled_at, last_error) ON subscriptions TO {}",
                "GRANT INSERT ON posts TO {}",
            ))
            # The analysis zone (api + analyzer) manages subscriptions and writes results,
            # but cannot change the schema.
            _grant(conn, os.environ.get("ANALYSIS_DB_ROLE", "analysis"), (
                "GRANT USAGE ON SCHEMA public TO {}",
                "GRANT SELECT, INSERT, DELETE ON subscriptions TO {}",
                "GRANT SELECT, DELETE ON posts TO {}",
                "GRANT UPDATE (sentiment, score, analyzed_at) ON posts TO {}",
                "GRANT SELECT, INSERT, UPDATE ON summaries TO {}",
            ))
            # CloudNativePG's metrics exporter runs our custom queries (k8s/base/data/
            # monitoring-queries.yaml) as the built-in pg_monitor role: it may read timestamps,
            # counters and target names, but never post texts or summaries.
            _grant(conn, "pg_monitor", (
                "GRANT USAGE ON SCHEMA public TO {}",
                "GRANT SELECT (id, kind, value, created_at, last_polled_at, last_error)"
                " ON subscriptions TO {}",
                "GRANT SELECT (subscription_id, ingested_at, analyzed_at) ON posts TO {}",
                "GRANT SELECT (subscription_id, item_count, updated_at) ON summaries TO {}",
            ))
        finally:
            conn.execute("SELECT pg_advisory_unlock(%s)", (_MIGRATION_LOCK_ID,))
    log.info("migrations complete")


def _grant(conn: psycopg.Connection, role: str, statements: tuple[str, ...]) -> None:
    """The roles are created by the CloudNativePG operator (spec.managed.roles), which can
    happen a few seconds after the database is up, so we wait for them."""
    deadline = time.monotonic() + 180
    while not conn.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (role,)).fetchone():
        if time.monotonic() > deadline:
            raise RuntimeError(f"database role {role!r} was never created")
        log.info("waiting for database role %r to be created by the operator", role)
        time.sleep(3)

    ident = sql.Identifier(role)
    for stmt in statements:
        conn.execute(sql.SQL(stmt).format(ident))
    log.info("granted least-privilege access to role %r", role)


def heartbeat() -> None:
    """Touch the heartbeat file checked by the liveness probe of the background workers."""
    with open(settings.heartbeat_file, "w") as fh:
        fh.write(str(time.time()))
