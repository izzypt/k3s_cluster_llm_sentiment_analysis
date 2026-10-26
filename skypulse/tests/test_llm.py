 # checks that the LLM's answer is cleaned up before it's used. 
# Scores are clamped to [-1, 1], label/score contradictions are fixed, non-JSON answers fall back to neutral or to a regex, and the summary's overall label (positive/negative/mixed/neutral/none) is computed correctly.

import pytest

from skypulse.llm import overall_label, parse_classification


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        ('{"sentiment": "positive", "score": 0.8}', ("positive", 0.8)),
        ('{"sentiment": "NEGATIVE", "score": -2}', ("negative", -1.0)),
        ('{"sentiment": "positive", "score": -0.6}', ("positive", 0.6)),  # inconsistent sign fixed
        ('{"sentiment": "angry", "score": 0}', ("neutral", 0.0)),
        ("I think this is negative.", ("negative", -0.5)),
        ("garbage", ("neutral", 0.0)),
    ],
)
def test_parse_classification(content, expected):
    assert parse_classification(content) == expected


def test_overall_label():
    assert overall_label([]) == "none"
    assert overall_label([0.9, 0.5]) == "positive"
    assert overall_label([-0.9, -0.5]) == "negative"
    assert overall_label([0.9, -0.9]) == "mixed"
    assert overall_label([0.1, 0.0, -0.1]) == "neutral"
