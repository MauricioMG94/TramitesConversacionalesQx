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

### A) Produccion con HTTPS automatico (recomendado)

El frontend de MiEstado se enchufa al contenedor `nginx-proxy` que esta
corriendo en el mismo VPS (el mismo que sirve `https://directoratlas.online`
de `FacturacionElectronicaQx`). Pasos:

1. **Configurar DNS** en el registrador del dominio:
   - Tipo `A`, host `@` (o `miestadoapp.online`), valor = IP publica del VPS.
   - Propagar (5-30 min tipicamente).
2. **Editar `miestado_app/.env`** en el VPS:
   ```
   DOMAIN=miestadoapp.online
   LETSENCRYPT_EMAIL=tu-correo@ejemplo.com
   ```
3. **Reiniciar frontend** para que `nginx-proxy` lo descubra y emita el cert:
   ```bash
   cd ~/TramitesConversacionalesQx/miestado_app
   docker compose up -d --build frontend
   ```
4. **Verificar**:
   ```bash
   curl -I https://miestadoapp.online/         # 200 OK con TLS de Let's Encrypt
   curl -I https://miestadoapp.online/api/healthz
   curl -I https://miestadoapp.online/api/docs # Swagger UI de FastAPI
   ```

Si el certificado no aparece: `docker logs nginx-proxy` suele decir por que.

### B) Dev local en el VPS (sin dominio, sin HTTPS)

```bash
cd ~/TramitesConversacionalesQx/miestado_app
test -f .env || cp .env.example .env     # DOMAIN=localhost por default
docker compose up -d --build

curl -fsS http://localhost:8888/healthz
curl -I   http://localhost:5173         # puerto host mapeado del frontend
```

Servicios en modo dev:

| Servicio   | Host port | Container port | Descripcion |
|------------|-----------|----------------|-------------|
| mongo      | 27017     | 27017          | MongoDB 7 |
| api        | 8888      | 8888           | FastAPI + Uvicorn |
| frontend   | 5173      | 3000           | Vite build servido por nginx |

### C) Aislamiento total (sin nginx-proxy compartido)

Si en algun momento queres desligarte de `nginx-proxy` y que MiEstado
emita su propio HTTPS, `miestado_app/Caddyfile` ya esta preconfigurado
siguiendo el patron de `FacturacionElectronicaQx`. Pasos de
migracion documentados al inicio del archivo.

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
