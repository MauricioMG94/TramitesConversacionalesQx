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

MiEstado trae su propio reverse proxy (Caddy) **aislado del VPS**:
solo escucha 80/443 para el dominio configurado en `DOMAIN` y no comparte
red, puertos ni certificados con otros proyectos del servidor.

### A) Produccion con HTTPS automatico (recomendado)

1. **Detener cualquier otro servicio en 80/443** del VPS (ej. un
   `nginx-proxy` compartido de otro proyecto). Caddy necesita esos
   puertos libres o el contenedor no arranca:
   ```bash
   docker ps | grep -E 'nginx-proxy|caddy'
   docker stop nginx-proxy nginx-proxy-acme 2>/dev/null
   docker rm -f nginx-proxy nginx-proxy-acme 2>/dev/null
   ```

2. **Configurar DNS** en el registrador de `miestadoapp.online`:
   - Tipo `A`, host `@`, valor = IP publica del VPS.
   - Propagar (5-30 min tipicamente).

3. **Editar `miestado_app/.env`** en el VPS:
   ```
   DOMAIN=miestadoapp.online
   LETSENCRYPT_EMAIL=tu-correo@ejemplo.com
   ```

4. **Levantar el stack completo**:
   ```bash
   cd ~/TramitesConversacionalesQx/miestado_app
   docker compose up -d --build

   # Esperar 30s a que Caddy emita el cert via HTTP-01
   docker logs miestado_gateway --tail=30
   # esperado: 'obtained certificate' y 'miestadoapp.online'
   ```

5. **Verificar**:
   ```bash
   curl -I https://miestadoapp.online/             # 200 con TLS Let's Encrypt
   curl -I https://miestadoapp.online/api/healthz  # JSON {"status":"ok"}
   curl -I https://miestadoapp.online/api/docs     # Swagger UI
   ```

### B) Dev local en el VPS (sin dominio, sin HTTPS)

```bash
cd ~/TramitesConversacionesQx/miestado_app
test -f .env || cp .env.example .env     # DOMAIN=localhost por default
# Quitar el gateway del compose para no pelearse por 80/443:
docker compose up -d --build --scale gateway=0
# OJO: scale=0 puede no dar el efecto deseado; la alternativa limpia:
docker compose up -d --build mongo api frontend
docker compose stop gateway   # si lo tienes corriendo, lo apagas

curl -fsS http://localhost:8888/healthz
curl -I   http://localhost:5173          # frontend por puerto host
```

Servicios en modo dev:

| Servicio   | Host port | Container port | Descripcion |
|------------|-----------|----------------|-------------|
| mongo      | 27017     | 27017          | MongoDB 7 |
| api        | 8888      | 8888           | FastAPI + Uvicorn |
| frontend   | 5173      | 3000           | Vite servido por nginx |
| gateway    | (off)     | 80, 443         | Caddy (solo prod) |

### C) Por qué Caddy y no nginx-proxy compartido

Antes, el compose intentaba conectarse a un `nginx-proxy` global del
VPS (el mismo que sirve `directoratlas.online` de Facturacion). Eso
acoplaba MiEstado con cualquier otro proyecto del servidor. Ahora
MiEstado trae su **propio** Caddy dentro de su compose:

- El cert y la red son de MiEstado, no del VPS.
- Los logs de `docker logs miestado_gateway` muestran solo este proyecto.
- Si querés borrar MiEstado, `docker compose down -v` desaparece todo
  sin afectar a nadie más.

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
