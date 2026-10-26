"""Analyzer: classifies new posts with the local LLM and maintains per-subscription summaries.

It lives in the analysis namespace and can reach only PostgreSQL and the LLM server:
no internet. Work is claimed with `FOR UPDATE SKIP LOCKED` and summaries with advisory
locks, so several analyzer replicas can run side by side without doing the same work twice.
"""

import logging
import time

import httpx
import psycopg

from skypulse import db
from skypulse.config import settings
from skypulse.llm import LLMClient, overall_label

log = logging.getLogger("skypulse.analyzer")

POSTS_PER_ROUND = 10
RETENTION_DAYS = 14


def analyze_one(conn: psycopg.Connection, llm: LLMClient) -> bool:
    """Classify the newest unanalyzed post. Returns False when there is nothing to do."""
    with conn.transaction():
        row = conn.execute(
            "SELECT id, text FROM posts WHERE analyzed_at IS NULL"
            " ORDER BY posted_at DESC LIMIT 1 FOR UPDATE SKIP LOCKED"
        ).fetchone()
        if not row:
            return False
        post_id, text = row
        try:
            label, score = llm.classify(text)
        except httpx.HTTPStatusError as exc:
            # The server is up but rejected this one post: don't let it block the queue forever.
            log.warning("could not classify post %s (%s), marking neutral", post_id, exc)
            label, score = "neutral", 0.0
        conn.execute(
            "UPDATE posts SET sentiment = %s, score = %s, analyzed_at = now() WHERE id = %s",
            (label, score, post_id),
        )
    return True


# Which subscriptions need a (new) summary?
_STALE_SUMMARIES = """
SELECT s.id, s.kind, s.value
FROM subscriptions s
LEFT JOIN summaries sm ON sm.subscription_id = s.id
WHERE
    -- never summarised
    sm.subscription_id IS NULL
    -- the time window slid: refresh periodically even without new posts
    OR sm.updated_at < now() - make_interval(secs => %(max_age)s)
    -- new posts were analysed since the last summary, and either the backlog is
    -- drained or the current summary is more than a minute old
    OR (
        EXISTS (SELECT 1 FROM posts p
                WHERE p.subscription_id = s.id AND p.analyzed_at > sm.updated_at)
        AND (
            NOT EXISTS (SELECT 1 FROM posts p
                        WHERE p.subscription_id = s.id AND p.analyzed_at IS NULL)
            OR sm.updated_at < now() - interval '60 seconds'
        )
    )
ORDER BY s.id
"""


def refresh_summary(conn: psycopg.Connection, llm: LLMClient, sub_id: int, target: str) -> None:
    with conn.transaction():
        # Skip if another analyzer replica is already summarising this subscription.
        locked = conn.execute("SELECT pg_try_advisory_xact_lock(42, %s)", (sub_id,)).fetchone()[0]
        if not locked:
            return
        posts = conn.execute(
            "SELECT text, sentiment, score, posted_at FROM posts"
            " WHERE subscription_id = %s AND analyzed_at IS NOT NULL"
            "   AND posted_at > now() - make_interval(hours => %s)"
            " ORDER BY posted_at DESC LIMIT %s",
            (sub_id, settings.summary_window_hours, settings.summary_max_items),
        ).fetchall()

        counts = {"positive": 0, "neutral": 0, "negative": 0}
        for _, label, _, _ in posts:
            counts[label] += 1

        if posts:
            summary = llm.summarize(target, [(text, label) for text, label, _, _ in posts])
            window_start, window_end = posts[-1][3], posts[0][3]
        else:
            summary = f"No posts in the last {settings.summary_window_hours} hours."
            window_start = window_end = None

        conn.execute(
            """
            INSERT INTO summaries (subscription_id, summary, overall, positive, neutral, negative,
                                   item_count, window_start, window_end, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (subscription_id) DO UPDATE SET
                summary = EXCLUDED.summary, overall = EXCLUDED.overall,
                positive = EXCLUDED.positive, neutral = EXCLUDED.neutral,
                negative = EXCLUDED.negative, item_count = EXCLUDED.item_count,
                window_start = EXCLUDED.window_start, window_end = EXCLUDED.window_end,
                updated_at = now()
            """,
            (
                sub_id,
                summary,
                overall_label([score for _, _, score, _ in posts]),
                counts["positive"],
                counts["neutral"],
                counts["negative"],
                len(posts),
                window_start,
                window_end,
            ),
        )
    log.info("summary refreshed for %s (%d posts)", target, len(posts))


def work_once(conn: psycopg.Connection, llm: LLMClient) -> bool:
    """One round of work. Returns True if anything was done (so we don't sleep)."""
    did_work = False
    for _ in range(POSTS_PER_ROUND):
        if not analyze_one(conn, llm):
            break
        did_work = True

    stale = conn.execute(_STALE_SUMMARIES, {"max_age": settings.summary_max_age_seconds}).fetchall()
    conn.commit()
    for sub_id, kind, value in stale:
        refresh_summary(conn, llm, sub_id, f"@{value}" if kind == "handle" else f"#{value}")
        did_work = True
    return did_work


def run() -> None:
    log.info("analyzer starting, LLM at %s", settings.llm_url)
    db.heartbeat()
    llm = LLMClient(settings.llm_url, settings.llm_model, settings.llm_timeout_seconds)
    conn = db.wait_for_db()
    last_cleanup = 0.0
    while True:
        did_work = False
        try:
            did_work = work_once(conn, llm)
            if time.monotonic() - last_cleanup > 3600:
                conn.execute(
                    "DELETE FROM posts WHERE posted_at < now() - make_interval(days => %s)",
                    (RETENTION_DAYS,),
                )
                conn.commit()
                last_cleanup = time.monotonic()
        except httpx.HTTPError as exc:
            log.warning("LLM server not available (%s), retrying", exc)
            conn.rollback()
            time.sleep(5)
        except (psycopg.errors.UndefinedTable, psycopg.errors.InsufficientPrivilege) as exc:
            # First install: the migrate Job (skypulse-data) has not created the schema yet.
            log.warning("schema not ready (%s), waiting for migrations", exc.diag.message_primary)
            conn.rollback()
            time.sleep(5)
        except psycopg.OperationalError as exc:
            log.warning("database connection lost (%s), reconnecting", exc)
            conn.close()
            conn = db.wait_for_db()
        db.heartbeat()
        if not did_work:
            time.sleep(5)
