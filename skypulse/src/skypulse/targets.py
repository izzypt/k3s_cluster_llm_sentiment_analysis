"""Parsing and validation of subscription targets (Bluesky handles and hashtags).

The API cannot ask Bluesky whether a handle exists (it has no internet access by
design), so it only validates the *shape* here. The ingestor reports unknown
handles back through the `last_error` column.
"""

import re
from dataclasses import dataclass

# A Bluesky handle is a DNS name: labels of [a-z0-9-], separated by dots, TLD starts with a letter.
_HANDLE_RE = re.compile(r"^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$")
_HASHTAG_RE = re.compile(r"^[\w-]{1,64}$")


class InvalidTarget(ValueError):
    pass


@dataclass(frozen=True)
class Target:
    kind: str  # "handle" | "hashtag"
    value: str  # normalised, without "@" or "#"

    @property
    def display(self) -> str:
        return f"@{self.value}" if self.kind == "handle" else f"#{self.value}"


def parse_target(raw: str, kind: str | None = None) -> Target:
    """Turn user input such as "@bsky.app", "#kubernetes" or "bsky.app" into a Target.

    Without an explicit kind, a leading "#" means hashtag and anything else is a handle.
    """
    text = raw.strip()
    if not text:
        raise InvalidTarget("empty subscription target")

    if kind is None:
        kind = "hashtag" if text.startswith("#") else "handle"

    if kind == "hashtag":
        value = text.lstrip("#").lower()
        if not _HASHTAG_RE.match(value):
            raise InvalidTarget(f"invalid hashtag: {raw!r}")
    elif kind == "handle":
        value = text.lstrip("@").lower()
        if len(value) > 253 or not _HANDLE_RE.match(value):
            raise InvalidTarget(f"invalid Bluesky handle: {raw!r} (expected e.g. @bsky.app)")
    else:
        raise InvalidTarget(f"unknown kind: {kind!r}")

    return Target(kind=kind, value=value)
