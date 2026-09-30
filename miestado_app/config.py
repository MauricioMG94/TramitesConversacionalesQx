"""Configuracion global de MiEstadoApp.

Centraliza la lectura de variables de entorno, parametros de MongoDB y,
opcionalmente, secretos desde archivos YAML/Docker secrets.
"""

import os
from functools import lru_cache
from pathlib import Path

import yaml
from dotenv import load_dotenv

load_dotenv()


@lru_cache(maxsize=128)
def get_env_var(key: str, default=None):
    """Lee una variable de entorno con cache.

    Args:
        key: Nombre de la variable.
        default: Valor por defecto si la variable no esta definida.

    Returns:
        El valor de la variable o el valor por defecto.
    """
    return os.environ.get(key, default)


def get_config(key: str, default=None):
    """Orquestador de lectura de configuracion.

    Args:
        key: Clave a buscar en el entorno.
        default: Valor por defecto.

    Returns:
        El valor resuelto.
    """
    return get_env_var(key, default)


@lru_cache(maxsize=1)
def get_mongo_config() -> dict:
    """Devuelve la configuracion del cluster MongoDB.

    Si la variable MONGO_URI esta presente tiene prioridad. En caso contrario,
    se construye desde MONGO_HOST/MONGO_PORT/MONGO_DB.

    Returns:
        Diccionario con claves: uri, database, host, port, db.
    """
    uri = get_env_var('MONGO_URI')
    host = get_env_var('MONGO_HOST', 'mongo')
    port = get_env_var('MONGO_PORT', '27017')
    database = get_env_var('MONGO_DB', 'miestado')

    if not uri:
        uri = f'mongodb://{host}:{port}'
    return {
        'uri': uri,
        'host': host,
        'port': int(port),
        'db': database,
        'database': database,
    }


def load_yaml_config(file_name: str) -> dict:
    """Carga un archivo YAML desde la carpeta config/.

    Args:
        file_name: Nombre del archivo .yml/.yaml a leer.

    Returns:
        Diccionario con la configuracion cargada. Vacio si hay error.
    """
    base_path = Path(__file__).resolve().parent / 'config'
    file_path = base_path / file_name
    try:
        with file_path.open('r', encoding='utf-8') as f:
            return yaml.safe_load(f) or {}
    except Exception:
        return {}


@lru_cache(maxsize=1)
def get_settings() -> dict:
    """Carga y cachea el archivo config/settings.yaml."""
    return load_yaml_config('settings.yaml')


@lru_cache(maxsize=1)
def get_seed_admin_config() -> dict:
    """Devuelve la configuracion de seed del administrador inicial."""
    settings = get_settings()
    base = settings.get('seed_admin', {})
    return {
        'enabled': str(base.get('enabled', True)).lower() in {'1', 'true', 'yes'},
        'correo': get_env_var('SEED_ADMIN_CORREO', base.get('correo', 'admin@miestado.local')),
        'nombre_completo': get_env_var(
            'SEED_ADMIN_NOMBRE', base.get('nombre_completo', 'Administrador')
        ),
        'contrasena': get_env_var(
            'SEED_ADMIN_CONTRASENA',
            base.get('contrasena', 'CambiarEnProduccion123*'),
        ),
        'rol': get_env_var('SEED_ADMIN_ROL', base.get('rol', 'admin')),
    }


def get_collection_name(name: str) -> str:
    """Devuelve el nombre real de una coleccion desde settings.yaml.

    Args:
        name: Clave logica (ej: 'usuarios').

    Returns:
        Nombre fisico de la coleccion en MongoDB.
    """
    settings = get_settings()
    collections = settings.get('database', {}).get('collections', {})
    return collections.get(name, name)
