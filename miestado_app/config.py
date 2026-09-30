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


@lru_cache(maxsize=1)
def get_runt_config() -> dict:
    """Devuelve la configuracion de la integracion con RUNT.

    Combina defaults declarados en ``config/settings.yaml`` con variables
    de entorno. Cada variable de entorno listada en ``mtls.*_path_env``
    determina la ruta del archivo PEM del certificado/clave/CA.

    Returns:
        Diccionario con todas las claves efectivas para inicializar el
        cliente de RUNT.
    """
    settings = get_settings()
    base = settings.get('runt', {})
    mtls_base = base.get('mtls', {})

    enabled_env = str(get_env_var('RUNT_ENABLED', base.get('enabled', True))).lower()
    mode_env = get_env_var('RUNT_MODE', base.get('mode', 'mock'))

    mtls_cert_env_name = mtls_base.get('cert_path_env', 'RUNT_CERT_PATH')
    mtls_key_env_name = mtls_base.get('key_path_env', 'RUNT_KEY_PATH')
    mtls_ca_env_name = mtls_base.get('ca_path_env', 'RUNT_CA_PATH')

    mtls_enabled = str(get_env_var('RUNT_MTLS_ENABLED', mtls_base.get('enabled', False))).lower()
    mtls_enabled_bool = mtls_enabled in {'1', 'true', 'yes'}

    return {
        'enabled': enabled_env in {'1', 'true', 'yes'},
        'mode': str(mode_env).lower(),
        'base_url': get_env_var('RUNT_BASE_URL', base.get('base_url', '')).rstrip('/'),
        'token_path': base.get('token_path', '/oauth/token'),
        'vehiculo_path': base.get('vehiculo_path', '/api/vehiculo/consultar'),
        'timeout_seconds': int(get_env_var('RUNT_TIMEOUT_SECONDS', base.get('timeout_seconds', 15))),
        'token_ttl_seconds': int(base.get('token_ttl_seconds', 3600)),
        'token_refresh_skew_seconds': int(base.get('token_refresh_skew_seconds', 60)),
        'client_id': get_env_var('RUNT_CLIENT_ID', ''),
        'client_secret': get_env_var('RUNT_CLIENT_SECRET', ''),
        'mtls': {
            'enabled': mtls_enabled_bool,
            'cert_path': get_env_var(mtls_cert_env_name, '') if mtls_enabled_bool else '',
            'key_path': get_env_var(mtls_key_env_name, '') if mtls_enabled_bool else '',
            'ca_path': get_env_var(mtls_ca_env_name, '') if mtls_enabled_bool else '',
        },
    }


@lru_cache(maxsize=1)
def get_chat_config() -> dict:
    """Devuelve la configuracion del bot conversacional.

    Returns:
        Diccionario con claves: enabled, persist_conversaciones,
        max_historial y debug_vehiculo.
    """
    settings = get_settings()
    base = settings.get('chat', {})

    enabled = str(get_env_var('CHAT_ENABLED', base.get('enabled', True))).lower() in {'1', 'true', 'yes'}
    persist = str(get_env_var('CHAT_PERSIST_CONVERSACIONES', base.get('persist_conversaciones', True))).lower() in {
        '1', 'true', 'yes',
    }
    debug_vehiculo = str(get_env_var('CHAT_DEBUG_VEHICULO', base.get('debug_vehiculo', False))).lower() in {
        '1', 'true', 'yes',
    }

    return {
        'enabled': enabled,
        'persist_conversaciones': persist,
        'max_historial': int(get_env_var('CHAT_MAX_HISTORIAL', base.get('max_historial', 10))),
        'debug_vehiculo': debug_vehiculo,
    }
