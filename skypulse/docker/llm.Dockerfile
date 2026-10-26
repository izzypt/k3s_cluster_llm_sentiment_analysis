# syntax=docker/dockerfile:1
# The LLM server image: Ollama with the model weights baked in at build time.
#
# Why bake the model in? The analysis side of the system must never reach the internet,
# so the model cannot be downloaded at runtime. Shipping it inside a versioned image means
# it travels through the same registry, scanning and rollout process as the code, and
# works in fully air-gapped sites.

ARG OLLAMA_VERSION=0.35.1
FROM ollama/ollama:${OLLAMA_VERSION}

ARG OLLAMA_VERSION
ARG LLM_MODEL=gemma4:e2b-it-qat
ENV OLLAMA_MODELS=/models

# Start a temporary server, pull the model, stop the server.
RUN ollama serve >/tmp/ollama.log 2>&1 & pid=$!; \
    for i in $(seq 1 60); do ollama list >/dev/null 2>&1 && break; sleep 1; done; \
    ollama pull "${LLM_MODEL}" && \
    kill $pid && \
    chmod -R a+rX /models && \
    rm -rf /root/.ollama /tmp/ollama.log

ENV OLLAMA_HOST=0.0.0.0:11434 \
    # The weights are read-only inside the container: never try to clean up "unused" blobs.
    OLLAMA_NOPRUNE=1 \
    # Keep the model in memory between requests.
    OLLAMA_KEEP_ALIVE=24h \
    # Ollama writes its key pair to $HOME/.ollama; point it at a writable emptyDir.
    HOME=/home/ollama

LABEL org.opencontainers.image.description="Ollama ${OLLAMA_VERSION} with ${LLM_MODEL} baked in"
USER 10001
EXPOSE 11434
