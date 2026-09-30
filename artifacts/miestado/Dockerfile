# ── Etapa de Construcción ──
# Build context: raiz del workspace (para resolver el pnpm monorepo).
FROM node:20-bookworm-slim AS builder

ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:${PATH}" \
    PORT=3000 \
    BASE_PATH=/ \
    NODE_ENV=production \
    CI=true

# Habilita pnpm via corepack (lee la version del package.json del workspace)
RUN corepack enable

WORKDIR /repo

# Copiar SOLO lo necesario para resolver dependencias (optimiza cache).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json tsconfig.json ./
COPY lib ./lib
COPY scripts ./scripts
COPY artifacts ./artifacts

# Instalacion reproducible con el lockfile del workspace.
# pnpm@10+ bloquea por defecto los postinstall scripts (esbuild, swc...).
# 1) Instalamos con --ignore-scripts para que el install no falle por
#    ERR_PNPM_IGNORED_BUILDS.
# 2) Luego invocamos pnpm rebuild sobre los paquetes que SI necesitan
#    ejecutar su build (descargar binario nativo de esbuild, JSC de swc...).
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts && \
    pnpm rebuild esbuild @swc/core msw unrs-resolver

# Construir SOLO el paquete del frontend MiEstado.
ARG VITE_API_BASE=http://localhost:8888
ENV VITE_API_BASE=${VITE_API_BASE}

RUN pnpm --filter @workspace/miestado build

# ── Etapa Final: nginx sirviendo los estaticos ──
FROM nginx:1.27-alpine AS runtime

RUN rm -f /etc/nginx/conf.d/default.conf

# IMPORTANTE: el contexto de build de este Dockerfile es la RAIZ del
# workspace (definido en docker-compose.yml como context: ..).
# Por eso nginx.conf se referencia con la ruta completa desde la raiz.
# Si algun dia se mueve este Dockerfile, ajustar el COPY en consecuencia.
COPY artifacts/miestado/nginx.conf /etc/nginx/conf.d/default.conf

# Vite escribe el build en dist/public segun vite.config.ts.
COPY --from=builder /repo/artifacts/miestado/dist/public /usr/share/nginx/html

EXPOSE 3000

HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
