# syntax=docker/dockerfile:1
# One image for every Python role (api, ingestor, analyzer, migrate).
# Multi-stage: build the virtualenv with uv, then copy only the venv into a slim runtime image.

ARG PYTHON_VERSION=3.12

# ---------- build stage ----------
# build an isolated, self-contained Python virtual environment (/app/.venv) with all required production dependencies installed
FROM python:${PYTHON_VERSION}-slim-bookworm AS build
COPY --from=ghcr.io/astral-sh/uv:0.12.20 /uv /bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /src
# 1) dependencies only: this layer is cached until pyproject.toml / uv.lock change
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project
# 2) our own code: changes often, rebuilds in seconds
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-editable

# ---------- runtime stage ----------
FROM python:${PYTHON_VERSION}-slim-bookworm
# A fixed, non-root UID: Kubernetes' "restricted" Pod Security Standard requires runAsNonRoot.
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin skypulse
COPY --from=build /app/.venv /app/.venv
ENV PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1
USER 10001
EXPOSE 8000
ENTRYPOINT ["skypulse"]
CMD ["api"]
