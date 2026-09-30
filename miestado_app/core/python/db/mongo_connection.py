"""Pool async de MongoDB (motor) gestionado por el lifespan de FastAPI.

* Lee la configuracion desde ``config.get_mongo_config`` y ``config.get_settings``.
* Crea indices necesarios en el arranque para garantizar unicidad y rendimiento.
* Ofrece acceso a una unica instancia de ``AsyncIOMotorClient`` y ``AsyncIOMotorDatabase``.
"""

import logging
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from config import get_mongo_config, get_settings
from metadata import MensajesDB, NombreColecciones

logger = logging.getLogger(__name__)

_client: Optional[AsyncIOMotorClient] = None
_db: Optional[AsyncIOMotorDatabase] = None


async def init_pool() -> None:
    """Inicializa el cliente motor, abre conexion y crea indices base.

    Raises:
        RuntimeError: Si MongoDB no responde en el tiempo de seleccion configurado.
    """
    global _client, _db

    cfg = get_mongo_config()
    settings = get_settings()
    pool_cfg = settings.get('database_pool', {})

    min_size = int(pool_cfg.get('min_size', 5))
    max_size = int(pool_cfg.get('max_size', 30))
    server_selection_timeout_ms = int(
        cfg.get('server_selection_timeout_ms', 5000)
        or settings.get('database', {})
        .get('mongo', {})
        .get('server_selection_timeout_ms', 5000)
    )

    _client = AsyncIOMotorClient(
        cfg['uri'],
        minPoolSize=min_size,
        maxPoolSize=max_size,
        serverSelectionTimeoutMS=server_selection_timeout_ms,
        uuidRepresentation='standard',
    )

    await _client.admin.command('ping')
    _db = _client[cfg['database']]
    logger.info(MensajesDB.pool_inicializado, cfg['uri'])

    await _ensure_indexes(_db)


async def _ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    """Crea los indices necesarios para unicidad y consultas frecuentes."""
    usuarios = db[NombreColecciones.resolver('usuarios')]
    await usuarios.create_index('correo', unique=True, name='uq_correo')
    await usuarios.create_index('rol', name='idx_rol')
    logger.info(MensajesDB.indice_creado, usuarios.name, 'correo')


async def close_pool() -> None:
    """Cierra el cliente de MongoDB."""
    global _client, _db
    if _client is not None:
        _client.close()
        _client = None
        _db = None
        logger.info(MensajesDB.pool_cerrado)


def get_db() -> AsyncIOMotorDatabase:
    """Retorna la base de datos activa.

    Raises:
        RuntimeError: Si init_pool() no fue invocado antes.
    """
    if _db is None:
        raise RuntimeError(MensajesDB.pool_no_inicializado)
    return _db


def get_client() -> AsyncIOMotorClient:
    """Retorna el cliente motor activo."""
    if _client is None:
        raise RuntimeError(MensajesDB.pool_no_inicializado)
    return _client
