"""Configuration comes exclusively from environment variables (12-factor style).

In Kubernetes these are filled from ConfigMaps and Secrets, so the same image
runs unchanged in every environment.
"""

import os
from dataclasses import dataclass, field


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


@dataclass(frozen=True)
class Settings:
    # Empty DATABASE_URL means "use the standard libpq env vars" (PGHOST, PGUSER, ...).
    database_url: str = field(default_factory=lambda: os.environ.get("DATABASE_URL", ""))
    log_level: str = field(default_factory=lambda: os.environ.get("LOG_LEVEL", "INFO"))

    # API
    http_port: int = field(default_factory=lambda: _int("HTTP_PORT", 8000))

    # Ingestor (internet side)
    bsky_api_base: str = field(
        default_factory=lambda: os.environ.get("BSKY_API_BASE", "https://api.bsky.app")
    )
    poll_interval_seconds: int = field(default_factory=lambda: _int("POLL_INTERVAL_SECONDS", 60))
    fetch_limit: int = field(default_factory=lambda: _int("FETCH_LIMIT", 50))

    # Analyzer (local side)
    llm_url: str = field(default_factory=lambda: os.environ.get("LLM_URL", "http://llm:11434"))
    # Empty LLM_MODEL means "use whatever model the LLM server ships with".
    llm_model: str = field(default_factory=lambda: os.environ.get("LLM_MODEL", ""))
    llm_timeout_seconds: int = field(default_factory=lambda: _int("LLM_TIMEOUT_SECONDS", 180))
    summary_window_hours: int = field(default_factory=lambda: _int("SUMMARY_WINDOW_HOURS", 168))
    summary_max_items: int = field(default_factory=lambda: _int("SUMMARY_MAX_ITEMS", 50))
    summary_max_age_seconds: int = field(
        default_factory=lambda: _int("SUMMARY_MAX_AGE_SECONDS", 900)
    )

    # Both background workers touch this file every loop; the liveness probe checks its age.
    heartbeat_file: str = field(
        default_factory=lambda: os.environ.get("HEARTBEAT_FILE", "/tmp/heartbeat")
    )


settings = Settings()
