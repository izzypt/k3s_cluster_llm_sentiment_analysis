"""Minimal client for the public Bluesky AppView API (no account or API key needed).

- Handles:  app.bsky.feed.getAuthorFeed
- Hashtags: app.bsky.feed.searchPosts
"""

from dataclasses import dataclass
from datetime import datetime, timezone

import httpx


@dataclass(frozen=True)
class Post:
    uri: str
    author: str
    text: str
    posted_at: datetime


class TargetNotFound(Exception):
    """The handle does not exist (or the request is invalid)."""


def _parse_time(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    # Bluesky timestamps look like 2026-10-03T15:01:18.193942Z
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def parse_post_view(view: dict) -> Post | None:
    """Convert an app.bsky.feed.defs#postView into a Post; None when there is no text."""
    record = view.get("record") or {}
    text = (record.get("text") or "").strip()
    if not text:
        return None  # image-only posts carry no sentiment we can read
    return Post(
        uri=view["uri"],
        author=(view.get("author") or {}).get("handle", "unknown"),
        text=text,
        posted_at=_parse_time(record.get("createdAt") or view.get("indexedAt")),
    )


def parse_author_feed(payload: dict) -> list[Post]:
    posts = []
    for item in payload.get("feed", []):
        if item.get("reason"):  # a repost by this author, not their own words
            continue
        post = parse_post_view(item.get("post") or {})
        if post:
            posts.append(post)
    return posts


def parse_search(payload: dict) -> list[Post]:
    return [p for p in (parse_post_view(v) for v in payload.get("posts", [])) if p]


class BlueskyClient:
    def __init__(self, base_url: str, timeout: float = 20.0):
        self._http = httpx.Client(
            base_url=base_url,
            timeout=timeout,
            headers={"User-Agent": "skypulse/0.1 (on-prem sentiment analysis)"},
        )

    def fetch(self, kind: str, value: str, limit: int) -> list[Post]:
        if kind == "handle":
            resp = self._http.get(
                "/xrpc/app.bsky.feed.getAuthorFeed",
                params={"actor": value, "limit": limit, "filter": "posts_no_replies"},
            )
            parse = parse_author_feed
        else:
            resp = self._http.get(
                "/xrpc/app.bsky.feed.searchPosts",
                params={"q": f"#{value}", "sort": "latest", "limit": limit},
            )
            parse = parse_search

        if resp.status_code == 400:
            raise TargetNotFound(resp.json().get("message", resp.text))
        resp.raise_for_status()
        return parse(resp.json())

    def close(self) -> None:
        self._http.close()
