# MiEstadoApp

Plataforma ciudadana conversacional para resolver tramites publicos en
lenguaje natural. Este repositorio contiene el **backend orquestado**
de MiEstadoApp (Python + MongoDB + Frontend React, todo via Docker).

> Los tres servicios (Mongo, API, Frontend) se levantan juntos con
> `docker compose`. El frontend se compila con Vite + pnpm dentro de
> su propio Dockerfile y se sirve con nginx desde un multi-stage.
> El navegador llega a la API en `http://localhost:8888` (variable
> `VITE_API_BASE` configurable).

---

## Stack

* Python 3.11 (`python:3.11-slim`)
* FastAPI + Uvicorn (dev) / Gunicorn (prod)
* MongoDB 7 via `motor` (async) sobre `pymongo>=4.3.3,<5`
* Autenticacion: OAuth2 Password flow + JWT HS256 + bcrypt
* Docker multi-stage con `ghcr.io/astral-sh/uv` para el backend
* Docker multi-stage con `node:20` + `nginx:alpine` para el frontend
* pnpm workspaces (monorepo) para resolver la build del frontend
* Zona horaria: `America/Bogota`

Persistencia **100% MongoDB** (no hay Oracle ni S3). Cada dominio vive
en colecciones dentro de la base `miestado`.

## Estructura

```
miestado_app/
├── Dockerfile                  # multi-stage, uv + python 3.11-slim
├── docker-compose.yml          # mongo + api + frontend (orquestados)
├── pyproject.toml              # deps (uv)
├── .env.example                # variables de entorno
├── config/
│   └── settings.yaml           # configuración base
├── metadata/                   # constantes y mensajes
├── core/python/
│   ├── db/mongo_connection.py  # pool motor + índices
│   ├── auth/
│   │   ├── security.py         # bcrypt + JWT
│   │   └── deps.py             # FastAPI Depends
│   ├── schemas/                # Pydantic v2
│   └── services/usuario_service.py
├── routers/
│   ├── auth.py                 # /api/auth/{token,me,me PATCH}
│   ├── usuarios.py             # CRUD admin
│   └── health.py               # /healthz /readyz
└── main.py                     # entrypoint FastAPI
```

Front + Dockerfile del frontend:

```
artifacts/miestado/
├── Dockerfile                  # multi-stage, node + pnpm + nginx
├── nginx.conf                  # SPA fallback (/ -> /index.html)
├── .dockerignore
└── (codigo React + Vite)
```

## Despliegue

### 1) Configurar variables de entorno

```bash
cd miestado_app
cp .env.example .env
# Editar .env: SECRET_KEY fuerte, CORS_ORIGINS, VITE_API_BASE, etc.
```

### 2) Levantar con Docker Compose

```bash
docker compose up -d --build
```

Servicios creados:

| Servicio   | Puerto host | Puerto container | Descripcion |
|------------|-------------|------------------|-------------|
| `mongo`    | `27017`     | `27017`          | MongoDB 7 con volumen `mongo_data` |
| `api`      | `8888`      | `8888`           | FastAPI · OpenAPI en `/docs` |
| `frontend` | `5173`      | `3000`           | Vite build estatico servido por nginx |

El servicio `frontend` espera a que `api` este definido y construye
usando el contexto de build en la raiz del workspace (para que pnpm
pueda resolver el monorepo). El parametro `VITE_API_BASE` define desde
que URL el navegador llamara al backend.

### 3) Verificar

```bash
# Liveness
curl http://localhost:8888/healthz
# → {"status":"ok"}

# Readiness (hace ping a Mongo)
curl http://localhost:8888/readyz
# → {"status":"ok","mongo":"ok"}

# Frontend
curl -I http://localhost:5173
# → HTTP/1.1 200 OK  (nginx sirviendo el bundle estatico)

# Documentacion interactiva de la API
open http://localhost:8888/docs
```

### Script de arranque (Windows / PowerShell)

```bash
cd miestado_app
./scripts/start.ps1
```

Crea `.env` (si no existe), levanta los tres contenedores, hace
healthcheck a Mongo + API + frontend, prueba el login con el admin
sembrado y muestra los ultimos logs.

## Seed del administrador inicial

Al arrancar, el `lifespan` de FastAPI ejecuta
`usuario_service.ensure_seed_admin()`. Si no existe el correo definido
en `SEED_ADMIN_CORREO` (por defecto `admin@miestado.local`), inserta un
documento con el hash bcrypt de la contrasena indicada (por defecto
`CambiarEnProduccion123*`).

Para forzar la reinsercion (entorno de pruebas):

```bash
docker compose down -v   # borra volumen mongo
docker compose up -d --build
```

Las credenciales se imprimen en los logs del contenedor:

```bash
docker logs miestado_app_api | grep -i seed
```

## Autenticacion

### Login (OAuth2 Password flow)

```bash
curl -X POST http://localhost:8888/api/auth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin@miestado.local&password=CambiarEnProduccion123*"
```

Respuesta:

```json
{ "access_token": "<JWT>", "token_type": "bearer" }
```

### Usar el token

```bash
curl http://localhost:8888/api/auth/me \
  -H "Authorization: Bearer <JWT>"
```

### Gestion de usuarios (solo admin)

```bash
# Listar
curl http://localhost:8888/api/usuarios \
  -H "Authorization: Bearer <JWT-admin>"

# Crear
curl -X POST http://localhost:8888/api/usuarios \
  -H "Authorization: Bearer <JWT-admin>" \
  -H "Content-Type: application/json" \
  -d '{
    "correo": "operador@miestado.local",
    "nombre_completo": "Operador Demo",
    "rol": "operador"
  }'
```

## Colecciones MongoDB

Todas las colecciones viven dentro de la base `miestado`:

| Logica            | Nombre fisico | Descripcion                                |
|-------------------|---------------|--------------------------------------------|
| `usuarios`        | `usuarios`    | Ciudadanos, operadores y admins            |
| `conversaciones`  | `conversaciones` | Mensajes del chat conversacional         |
| `tramites`        | `tramites`    | Instancias de tramite                      |
| `pagos`           | `pagos`       | Pagos generados a partir de un tramite     |
| `consentimientos` | `consentimientos` | Consentimientos explicitos por accion   |
| `audit`           | `audit_events`| Eventos de auditoria inmutables            |

Los nombres logicos se mapean a nombres fisicos en
`config/settings.yaml` (`database.collections`). Para renombrar la
coleccion de auditoria fisica, basta editar ese YAML.

## Frontend

El frontend React (`artifacts/miestado` en este workspace) vive en su
propio Dockerfile dentro del monorepo pnpm. Se compila, sirve con
nginx y es accesible en `http://localhost:5173`.

Para correr el frontend **fuera de Docker** (modo dev con HMR):

```bash
cd artifacts/miestado
# Crear .env.local con VITE_API_BASE=http://localhost:8888
pnpm dev
```

> En modo dockerizado el frontend se reconstruye ejecutando
> `pnpm --filter @workspace/miestado build` y se sirve como estatico
> desde `/usr/share/nginx/html`. SPA routing: cualquier ruta
> desconocida cae a `/index.html` para que wouter funcione.
>
> Los endpoints viven directamente bajo `/api/...` (sin prefijo
> `/api/v1`). El frontend despacha `fetch` contra
> `VITE_API_BASE` que por defecto es `http://localhost:8888`.

## Desarrollo local sin Docker

```bash
cd miestado_app
# 1) Crear venv con uv
uv sync --dev

# 2) Levantar Mongo en local (si no existe)
docker run -d --name miestado_mongo -p 27017:27017 mongo:7

# 3) Lanzar la API con autoreload
MONGO_HOST=localhost MONGO_URI=mongodb://localhost:27017 \
  uv run uvicorn main:app --host 0.0.0.0 --port 8888 --reload
```

## Convenciones aplicadas

* PEP 8, comillas simples, f-strings, type hints en firmas.
* Sin anotaciones de variables locales salvo donde la firma lo exige.
* Docstrings Google en espanol.
* Routers delgados: solo endpoints decorados; toda la logica esta en
  `core/python/services/` o `core/python/auth/`.
* Constantes en clases de `metadata/` con docstring por atributo, sin
  variables globales.
* Configuracion en YAML (`config/settings.yaml`) y en `.env` para
  secretos.
