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

MiEstado trae su propio reverse proxy (**Caddy** dentro del compose).
Solo él escucha 80/443 — no comparte puertos ni red con jwilder/nginx-proxy
de otros proyectos del VPS. Caddy emite los certs Let's Encrypt y enruta
por dominio a los contenedores backend en su red interna (`miestado_net`).

```
                     puerto 80/443 del VPS
                            |
                            v
                  ┌──────────────────┐
                  │ miestado_gateway    │ (Caddy, dentro de este compose)
                  └───────┬──────────┘
       ┌───────────────────┴────────────────────┐
       |                                  |
 miestadoapp.217.216.85.110.nip.io      directoratlas.online (placeholder OK /
       |                                    o proxy a facturacion_frontend cuando
       v                                     vuelva a estar disponible en miestado_net)
 miestado_app_frontend
       |
 miestado_app_api
```

### A) Produccion — `miestadoapp.<dominio>`

`DOMAIN` en `.env` apunta al host público. Hay dos formas válidas:

| DNS | Cómo |
|---|---|
| Dominio real (ej. `miestadoapp.directoratlas.online`) | Requiere crear un registro A en el panel del dominio padre. |
| Subdominio mágico via `nip.io` (lo que usamos de prueba) | `miestadoapp.<IP-VPS>.nip.io` resuelve a `<IP-VPS>` sin comprar nada. |

`nip.io` es útil cuando no tenés acceso al panel DNS del dominio padre
y querés probar el stack. Para producción real, se recomienda comprar
el dominio o coordinar con quien lo tenga.

Levantar el stack:

```bash
cd ~/TramitesConversacionesQx
git pull origin master
cd miestado_app
test -f .env || cp .env.example .env
# Ajustar DOMAIN segun corresponda
docker compose up -d --build

# Esperar 30-60s a que Caddy emita cert via HTTP-01
docker logs miestado_gateway --tail=30
# cuando veas: 'certificate obtained successfully'
curl -Iv https://$DOMAIN/
```

### B) Multi-tenant: directoratlas.online también desde este Caddy

El Caddyfile YA tiene un site block para `directoratlas.online`. Por ahora
responde con `503 "servicio en migración, mientras tanto visitá
https://miestadoapp.217.216.85.110.nip.io/"` para que el browser NO muestre
`ERR_SSL_PROTOCOL_ERROR` cuando lo visitemos.

Si querés **recuperar el servicio real de directoratlas** (Facturacion):

1. Asegurate que el contenedor frontend de directoratlas esté levantado
   en el VPS (ej. `directoratlas_frontend` o `facturacion_frontend`).
2. Conectá ese contenedor a la red de MiEstado:
   ```bash
   docker network connect miestado_app_miestado_net <container_name>
   ```
3. En `miestado_app/Caddyfile`, cambiá el bloque `directoratlas.online`:
   ```diff
   -    respond 503 "directoratlas.online - servicio en migracion."
   +    reverse_proxy directoratlas_frontend:3000 {
   +        header_up X-Forwarded-Proto "https"
   +    }
   ```
4. Reiniciá Caddy: `docker compose restart gateway`.
5. Esperá ~30s a que Caddy emita cert para `directoratlas.online`.

Ambas URLs quedan operativas con HTTPS automático.

### C) Dev local en el VPS (sin dominio, sin HTTPS)

```bash
cd ~/TramitesConversacionesQx/miestado_app
test -f .env || cp .env.example .env     # DOMAIN=localhost por default
# Levantar todo EXCEPTO el gateway (no pelea por 80/443):
docker compose up -d --build
docker compose stop gateway   # si lo tienes corriendo, lo apagas

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
