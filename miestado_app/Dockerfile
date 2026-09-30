# ── Etapa de Construcción ──
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

# 1) Copiar solo archivos de dependencias primero (aprovecha cache)
COPY pyproject.toml uv.lock* ./

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev || \
    uv sync --no-install-project --no-dev

# 2) Copiar el codigo fuente y termiar de sincronizar
COPY . /app

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-dev


# ── Etapa final ──
FROM python:3.11-slim AS runtime

WORKDIR /app

# Paquetes del sistema: tini (señal init), curl (healthcheck), ca-certificates
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        tini curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copiar venv y codigo desde builder
COPY --from=builder /app /app

# Asegurar PATH del venv y variables runtime
ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Usuario no-root para evitar rooter en contenedor
RUN useradd --create-home --uid 1001 appuser && chown -R appuser /app
USER appuser

EXPOSE 8888

# Healthcheck: /healthz responde 200 cuando el proceso esta vivo
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8888/healthz || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "main.py"]
