"""Ingestor: the ONLY component allowed to talk to the internet.

Every POLL_INTERVAL_SECONDS it reads the subscription list, fetches recent posts
from Bluesky and inserts them into PostgreSQL. It runs in its own namespace with
a dedicated, least-privilege database role (granted in db.migrate):
it can read targets and insert posts, nothing else.

Inserts are idempotent (UNIQUE(subscription_id, uri)), so running two replicas
or re-polling the same posts never creates duplicates.
"""

import logging
import time

import httpx
import psycopg

from skypulse import db
from skypulse.bluesky import BlueskyClient, TargetNotFound
from skypulse.config import settings

log = logging.getLogger("skypulse.ingestor")


def poll_once(conn: psycopg.Connection, client: BlueskyClient) -> None:
    subscriptions = conn.execute("SELECT id, kind, value FROM subscriptions").fetchall()
    conn.commit()

    for sub_id, kind, value in subscriptions:
        error = None
        inserted = 0
        try:
            posts = client.fetch(kind, value, settings.fetch_limit)
            with conn.transaction():
                for post in posts:
                    cur = conn.execute(
                        "INSERT INTO posts (subscription_id, uri, author, text, posted_at)"
                        " VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
                        (sub_id, post.uri, post.author, post.text, post.posted_at),
                    )
                    inserted += cur.rowcount
        except TargetNotFound as exc:
            error = f"Not found on Bluesky: {exc}"
        except httpx.HTTPError as exc:
            error = f"Bluesky request failed: {exc}"
        except psycopg.errors.ForeignKeyViolation:
            conn.rollback()
            log.info("subscription %s was removed while polling", sub_id)
            continue

        conn.execute(
            "UPDATE subscriptions SET last_polled_at = now(), last_error = %s WHERE id = %s",
            (error, sub_id),
        )
        conn.commit()
        if error:
            log.warning("%s %s: %s", kind, value, error)
        else:
            log.info("%s %s: %d new posts", kind, value, inserted)


def run() -> None:
    log.info(
        "ingestor starting, polling %s every %ss",
        settings.bsky_api_base,
        settings.poll_interval_seconds,
    )
    db.heartbeat()
    client = BlueskyClient(settings.bsky_api_base)
    conn = db.wait_for_db()
    while True:
        try:
            poll_once(conn, client)
        except (psycopg.errors.UndefinedTable, psycopg.errors.InsufficientPrivilege) as exc:
            # First install: the migrate Job (skypulse-data) has not created the schema yet.
            log.warning("schema not ready (%s), waiting for migrations", exc.diag.message_primary)
            conn.rollback()
            time.sleep(5)
        except psycopg.OperationalError as exc:
            # Typical during a database failover: reconnect and carry on.
            log.warning("database connection lost (%s), reconnecting", exc)
            conn.close()
            conn = db.wait_for_db()
        db.heartbeat()
        time.sleep(settings.poll_interval_seconds)
