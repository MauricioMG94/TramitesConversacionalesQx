"""Punto de entrada principal para la API de MiEstado.

* Levanta el lifespan de FastAPI con conexiones a MongoDB.
* Configura CORS desde settings o env.
* Registra rutas publicas (auth, health) y protegidas via ``get_current_active_user``.
"""

import asyncio
import logging
import os
import sys
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Fix Windows: motor/asyncio en Windows requiere el SelectorEventLoop
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn

from core.python.db.mongo_connection import close_pool, init_pool
from core.python.services import usuario_service
from routers import auth, health, usuarios

load_dotenv()


def _configure_logging() -> None:
    """Configura logging basico desde variables de entorno."""
    level = os.environ.get('LOG_LEVEL', 'INFO').upper()
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format='%(asctime)s [%(levelname)s] %(name)s - %(message)s',
    )


_configure_logging()
logger = logging.getLogger('miestado_app')


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Inicializa y cierra el pool Mongo + ejecuta seed del admin inicial."""
    await init_pool()
    logger.info('API iniciada - pool Mongo listo.')

    try:
        await usuario_service.ensure_seed_admin()
        logger.info('Seed admin verificado o insertado.')
    except Exception as exc:
        logger.error('Error en seed admin: %s', exc)

    yield

    await close_pool()
    logger.info('API detenida - pool Mongo cerrado.')


app = FastAPI(
    title='MiEstadoApp API',
    version='0.1.0',
    description='MiEstadoApp - plataforma conversacional ciudadana. Persistencia 100% MongoDB.',
    lifespan=lifespan,
)

# CORS: permitir origenes segun CORS_ORIGINS (separados por coma)
cors_env = os.environ.get('CORS_ORIGINS')
if cors_env:
    origins = [o.strip() for o in cors_env.split(',') if o.strip()]
else:
    from config import get_settings

    origins = get_settings().get('app', {}).get(
        'cors_origins',
        ['http://localhost:5173', 'http://localhost:3000'],
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


# ── Rutas publicas ──
app.include_router(health.router)
app.include_router(auth.router)


# ── Rutas protegidas (requieren usuario activo) ──
from core.python.auth.deps import get_current_active_user

api_router = APIRouter(dependencies=[Depends(get_current_active_user)])
api_router.include_router(usuarios.router)
app.include_router(api_router)


@app.get('/')
async def root() -> dict:
    """Health endpoint raiz."""
    return {
        'status': 'online',
        'service': 'MiEstado API',
        'version': '0.1.0',
    }


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Captura errores no manejados y devuelve un payload seguro.

    Se loguea el stack real; al cliente solo se le expone un mensaje generico.
    """
    logger.exception('Error no manejado en %s %s', request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={'detail': 'Error interno del servidor.'},
    )


if __name__ == '__main__':
    if sys.platform == 'win32':
        # Forzar SelectorEventLoop antes de uvicorn
        import selectors

        loop = asyncio.SelectorEventLoop(selectors.SelectSelector())
        asyncio.set_event_loop(loop)

    host = os.environ.get('API_HOST', '0.0.0.0')
    port = int(os.environ.get('API_PORT', '8888'))
    uvicorn.run('main:app', host=host, port=port, reload=False)
