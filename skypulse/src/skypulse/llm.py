"""Client for the local LLM server (Ollama) running inside the cluster.

Two tasks:
- classify(): sentiment of a single post -> ("positive" | "neutral" | "negative", score in [-1, 1])
- summarize(): a short natural-language summary of the recent sentiment of a subscription
"""

import json
import logging
import re

import httpx

log = logging.getLogger(__name__)

LABELS = ("positive", "neutral", "negative")

_CLASSIFY_SYSTEM = (
    "You are a sentiment classifier for social media posts. "
    "Classify the overall sentiment the author expresses. "
    'Answer with JSON only: {"sentiment": "positive" | "neutral" | "negative", '
    '"score": number between -1 (very negative) and 1 (very positive)}.'
)

# JSON schema passed to Ollama's structured output: the model can only produce valid JSON.
_CLASSIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "sentiment": {"type": "string", "enum": list(LABELS)},
        "score": {"type": "number"},
    },
    "required": ["sentiment", "score"],
}

_SUMMARY_SYSTEM = (
    "You write very short briefings for analysts who monitor social media. "
    "Given recent posts with their sentiment, write at most two sentences describing the overall "
    "sentiment and the main topics driving it. Plain text, no lists, no preamble."
)


def parse_classification(content: str) -> tuple[str, float]:
    """Parse the model output defensively; small models occasionally misbehave."""
    try:
        data = json.loads(content)
        label = str(data.get("sentiment", "")).strip().lower()
        score = float(data.get("score", 0.0))
    except (ValueError, TypeError, AttributeError):
        match = re.search(r"\b(positive|neutral|negative)\b", content.lower())
        label = match.group(1) if match else "neutral"
        score = {"positive": 0.5, "neutral": 0.0, "negative": -0.5}[label]

    if label not in LABELS:
        label = "neutral"
    score = max(-1.0, min(1.0, score))
    # Keep label and score consistent even if the model contradicts itself.
    if label == "positive" and score < 0 or label == "negative" and score > 0:
        score = -score
    return label, score


def overall_label(scores: list[float]) -> str:
    if not scores:
        return "none"
    mean = sum(scores) / len(scores)
    if mean > 0.2:
        return "positive"
    if mean < -0.2:
        return "negative"
    return "mixed" if max(scores) > 0.3 and min(scores) < -0.3 else "neutral"


class LLMClient:
    def __init__(self, base_url: str, model: str, timeout: float):
        self._http = httpx.Client(base_url=base_url, timeout=timeout)
        self._model = model

    @property
    def model(self) -> str:
        if not self._model:
            # The model is baked into the LLM image; discover it instead of duplicating config.
            models = self._http.get("/api/tags").raise_for_status().json().get("models", [])
            if not models:
                raise RuntimeError("the LLM server has no models installed")
            self._model = models[0]["name"]
            log.info("using model %s", self._model)
        return self._model

    def _chat(self, system: str, user: str, *, fmt: dict | None, max_tokens: int) -> str:
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
            "think": False,
            "keep_alive": "24h",
            "options": {"temperature": 0, "num_predict": max_tokens},
        }
        if fmt:
            body["format"] = fmt
        resp = self._http.post("/api/chat", json=body)
        resp.raise_for_status()
        return resp.json()["message"]["content"].strip()

    def classify(self, text: str) -> tuple[str, float]:
        content = self._chat(_CLASSIFY_SYSTEM, text[:2000], fmt=_CLASSIFY_SCHEMA, max_tokens=48)
        return parse_classification(content)

    def summarize(self, target: str, posts: list[tuple[str, str]]) -> str:
        lines = [f"- [{label}] {text[:280]}" for text, label in posts[:25]]
        prompt = f"Subscription: {target}\nRecent posts (newest first):\n" + "\n".join(lines)
        return self._chat(_SUMMARY_SYSTEM, prompt, fmt=None, max_tokens=160)
