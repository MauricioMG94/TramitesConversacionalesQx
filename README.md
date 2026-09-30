# MiEstado

Plataforma ciudadana conversacional para resolver tramites publicos en
lenguaje natural.

## Stack

- **Frontend**: React + Vite + pnpm workspaces (servido por nginx).
- **Backend**: Python 3.11 + FastAPI + MongoDB Persistencia 100% Mongo (ver `miestado_app/README.md`).
- **Infraestructura**: Docker Compose (3 servicios: mongo, api, frontend).

## Estructura del repo

```
.
├── artifacts/
│   ├── miestado/                # Frontend React + Vite
│   │   ├── Dockerfile           # Multi-stage node:20 + nginx:alpine
│   │   ├── nginx.conf           # SPA fallback + headers de seguridad
│   │   └── vite.config.ts
│   ├── api-server/              # (legacy Express) No se usa en deploy Docker
│   └── mockup-sandbox/          # Sandbox local para prototipos
├── lib/                         # Bibliotecas compartidas (api-spec, db)
├── scripts/                     # Utilidades de mantenimiento
├── miestado_app/                # Backend Python (FastAPI)
│   ├── README.md                # Documentacion detallada del backend
│   ├── docker-compose.yml
│   ├── Dockerfile
│   ├── pyproject.toml
│   └── ...
├── pnpm-workspace.yaml          # Config pnpm@9.15.4 (catalog / overrides)
├── package.json                 # Raiz pnpm
└── pnpm-lock.yaml               # Lockfile bloqueado
```

## Despliegue (Docker)

Este proyecto se enchufa al mismo **reverse proxy compartido** del VPS
que sirve tu otro proyecto (Facturacion directoratlas.online). Es
el mismo patron que usaste ahi: un contenedor `jwilder/nginx-proxy`
unico en el VPS que enruta por dominio a los frontends de cada
proyecto. La razon: hay una sola IP publica y una sola pareja de
puertos 80/443, asi que compartir proxy es la unica opcion.

```
                    puerto 80/443 del VPS
                            |
                            v
                    ┌──────────────┐
                    │ nginx-proxy    │ (jwilder, compartido del VPS)
                    └────────┬──────┘
       ┌─────────────────────┴─────────────────────┐
       |                                            |
directoratlas.online                       miestadoapp.directoratlas.online
       |                                            |
       v                                            v
directoratlas_frontend                       miestado_app_frontend
       |                                            |
directoratlas_api                            miestado_app_api
```

### A) Produccion con HTTPS automatico

Requisitos:

1. `jwilder/nginx-proxy` + `nginxproxy/acme-companion` corriendo en el
   VPS. Si no los tenés, una linea cada uno:
   ```bash
   docker run -d --name nginx-proxy --restart always \
     -p 80:80 -p 443:443 \
     -v /var/run/docker.sock:/tmp/docker.sock:ro \
     -v /etc/docker/nginx-proxy/certs:/etc/nginx/certs:ro \
     -v /etc/docker/nginx-proxy/htpasswd:/etc/nginx/htpasswd:ro \
     jwilder/nginx-proxy:latest

   docker run -d --name nginx-proxy-acme --restart always \
     -v /var/run/docker.sock:/var/run/docker.sock:ro \
     -v /etc/docker/nginx-proxy/certs:/etc/nginx/certs:rw \
     -v /etc/docker/nginx-proxy/acme:/etc/acme.sh:rw \
     -e NGINX_PROXY_CONTAINER=nginx-proxy \
     -e DEFAULT_EMAIL=admin@directoratlas.online \
     nginxproxy/acme-companion:latest

   docker network create nginx-proxy
   ```

2. DNS configurado en el panel de `directoratlas.online`:
   | Tipo | Nombre | Valor | TTL |
   |------|--------|-------|-----|
   | A | `miestadoapp` | IP publica del VPS | 300 |

3. `.env` correctos:
   ```
   DOMAIN=miestadoapp.directoratlas.online
   LETSENCRYPT_EMAIL=admin@directoratlas.online
   PROXY_NETWORK=nginx-proxy
   ```

4. Levantar MiEstado:
   ```bash
   cd ~/TramitesConversacionesQx/miestado_app
   docker compose up -d --build
   docker compose logs --tail=30
   ```

5. `docker logs nginx-proxy-acme --tail=40` debería mostrar
   `obtained certificate for miestadoapp.directoratlas.online` en
   30s-2min. Cuando eso pase:
   ```bash
   curl -Iv https://miestadoapp.directoratlas.online/
   curl -Iv https://directoratlas.online/   # Director Atlas sigue vivo
   ```

### B) Dev local en el VPS (sin dominio, sin HTTPS)

```bash
cd ~/TramitesConversacionesQx/miestado_app
test -f .env || cp .env.example .env     # DOMAIN=localhost por default
docker compose up -d --build

curl -fsS http://localhost:8888/healthz
curl -I   http://localhost:5173          # puerto host mapeado del frontend
```

Puertos en modo dev:

| Servicio   | Host port | Container port | Descripcion |
|------------|-----------|----------------|-------------|
| mongo      | 27017     | 27017          | MongoDB 7 |
| api        | 8888      | 8888           | FastAPI + Uvicorn |
| frontend   | 5173      | 3000           | Vite servido por nginx |

## Sin dependencias de Replit

El proyecto esta pensado para correr **solo en Docker**: no requiere la
plataforma Replit, ni sus plugins de Vite, ni `replit.nix`, ni
`.upm/`. Los archivos `.replit` y `.replit-artifact/` se eliminaron
del repo.

Para desarrollo local del frontend sin Docker:

```bash
pnpm install
cd artifacts/miestado
pnpm dev          # Vite dev server (HMR)
```

Para desarrollo local del backend sin Docker:

```bash
cd miestado_app
uv sync --dev                          # o pip install -e .
docker run -d --name miestado_mongo -p 27017:27017 mongo:7
MONGO_HOST=localhost MONGO_URI=mongodb://localhost:27017 \
  uv run uvicorn main:app --host 0.0.0.0 --port 8888 --reload
```

## Convenciones

- **Backend Python**: ver `.kilo/skills/skill.md`.
- **Frontend TS** (componentes React, Vite, Tailwind): ver
  `artifacts/miestado/README.md` (cuando exista).
- **MongoDB unica fuente de verdad**: no usar SQL/Postgres.
- **Configuracion**: valores parametrizables en `miestado_app/config/settings.yaml`
  y `miestado_app/.env`. Constantes y mensajes en `miestado_app/metadata/metadata.py`.

## Documentacion por modulo

- `miestado_app/README.md` - Backend FastAPI, integracion con RUNT, endpoints
  expuestos (`/api/vehiculo/consultar`, `/api/conversaciones/mensaje`).
- `miestado_app/secrets/README.md` - Como poblar los certificados mTLS de RUNT.
