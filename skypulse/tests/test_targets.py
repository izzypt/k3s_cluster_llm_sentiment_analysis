# checks that what the analyst types is validated and normalized. 
# @handle and #hashtag are detected, input is trimmed and lowercased, invalid input is rejected (the API turns that into a 422), and targets display correctly.

import pytest

from skypulse.targets import InvalidTarget, parse_target


@pytest.mark.parametrize(
    ("raw", "kind", "value"),
    [
        ("@bsky.app", "handle", "bsky.app"),
        ("Alice.BSKY.social", "handle", "alice.bsky.social"),
        ("  #Kubernetes ", "hashtag", "kubernetes"),
        ("#café", "hashtag", "café"),
        ("#cloud-native", "hashtag", "cloud-native"),
    ],
)
def test_parse_valid(raw, kind, value):
    target = parse_target(raw)
    assert (target.kind, target.value) == (kind, value)


@pytest.mark.parametrize(
    "raw", ["", "   ", "@", "#", "no spaces.com x", "#two words", "@-bad.com", "@nodot"]
)
def test_parse_invalid(raw):
    with pytest.raises(InvalidTarget):
        parse_target(raw)


def test_explicit_kind_overrides_prefix_detection():
    assert parse_target("kubernetes", kind="hashtag").kind == "hashtag"


def test_display():
    assert parse_target("bsky.app").display == "@bsky.app"
    assert parse_target("#k8s").display == "#k8s"
