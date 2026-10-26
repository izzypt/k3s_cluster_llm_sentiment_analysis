# checks that Bluesky API responses are turned into Post objects correctly. 
# Reposts and empty posts are dropped, author and text come out right, and timestamps carry a timezone.
from skypulse.bluesky import parse_author_feed, parse_search


def _view(uri, text, handle="alice.bsky.social", created="2026-10-03T15:01:18.193942Z"):
    return {
        "uri": uri,
        "author": {"handle": handle},
        "record": {"text": text, "createdAt": created},
        "indexedAt": created,
    }


def test_author_feed_skips_reposts_and_empty_posts():
    payload = {
        "feed": [
            {"post": _view("at://1", "hello world")},
            {"post": _view("at://2", "someone else"), "reason": {"$type": "repost"}},
            {"post": _view("at://3", "   ")},
        ]
    }
    posts = parse_author_feed(payload)
    assert [p.uri for p in posts] == ["at://1"]
    assert posts[0].posted_at.tzinfo is not None


def test_search_parses_posts():
    posts = parse_search({"posts": [_view("at://9", "#kubernetes is great", handle="bob.dev")]})
    assert posts[0].author == "bob.dev"
    assert posts[0].text == "#kubernetes is great"
