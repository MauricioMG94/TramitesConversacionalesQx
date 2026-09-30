"""Servicios CRUD para usuarios persistidos en MongoDB."""

import secrets
from datetime import datetime, timezone

from fastapi import HTTPException

from core.python.auth.security import get_password_hash
from core.python.db.mongo_connection import get_db
from core.python.schemas.usuarios_schemas import (
    UsuarioCreate,
    UsuarioCreateResponse,
    UsuarioResponse,
    UsuarioSelfUpdate,
    UsuarioUpdate,
)
from metadata import (
    EstadoUsuario,
    MensajesDB,
    NombreColecciones,
    RolesUsuario,
)


def _to_response_dict(doc: dict) -> dict:
    """Convierte un documento Mongo en el shape de ``UsuarioResponse``."""
    return {
        'id_usuario': str(doc['_id']),
        'correo': doc['correo'],
        'nombre_completo': doc['nombre_completo'],
        'rol': doc['rol'],
        'activo': doc['estado'] == EstadoUsuario.activo,
        'fecha_creacion': doc['fecha_creacion'],
    }


async def get_all_usuarios() -> list[UsuarioResponse]:
    """Retorna todos los usuarios ordenados por fecha de creacion descendente."""
    db = get_db()
    coll = db[NombreColecciones.resolver('usuarios')]
    cursor = coll.find().sort('fecha_creacion', -1)
    return [UsuarioResponse(**_to_response_dict(d)) async for d in cursor]


async def get_usuarios_basico() -> list[dict]:
    """Lista minima para selects: solo id y nombre completo.

    Solo incluye usuarios activos y excluye administradores.
    """
    db = get_db()
    coll = db[NombreColecciones.resolver('usuarios')]
    cursor = coll.find(
        {'estado': EstadoUsuario.activo, 'rol': {'$ne': RolesUsuario.admin}},
        projection={'nombre_completo': 1},
    ).sort('nombre_completo', 1)
    return [
        {'id_usuario': str(d['_id']), 'nombre_completo': d['nombre_completo']}
        async for d in cursor
    ]


async def get_usuario_by_id(id_usuario: str) -> dict | None:
    """Busca un usuario por ObjectId."""
    from bson import ObjectId
    from bson.errors import InvalidId

    try:
        oid = ObjectId(id_usuario)
    except (InvalidId, TypeError):
        return None
    db = get_db()
    coll = db[NombreColecciones.resolver('usuarios')]
    return await coll.find_one({'_id': oid})


async def create_usuario(
    usuario: UsuarioCreate,
    audit_logger=None,
) -> UsuarioCreateResponse:
    """Crea un usuario nuevo. Si no viene contrasena, genera una aleatoria.

    Args:
        usuario: Payload validado.
        audit_logger: Callable opcional ``await audit_logger(evento)``.

    Returns:
        Usuario recien creado con la contrasena (la generada aleatoria).

    Raises:
        HTTPException 400 si el correo ya existe.
    """
    db = get_db()
    coll = db[NombreColecciones.resolver('usuarios')]
    correo_lc = usuario.correo.strip().lower()

    existing = await coll.find_one({'correo_lc': correo_lc})
    if existing:
        raise HTTPException(status_code=400, detail='El correo ya esta registrado.')

    plain_password = usuario.contrasena or secrets.token_urlsafe(8)
    hashed = get_password_hash(plain_password)
    now = datetime.now(timezone.utc)

    doc = {
        'correo': usuario.correo,
        'correo_lc': correo_lc,
        'nombre_completo': usuario.nombre_completo,
        'rol': usuario.rol if RolesUsuario.es_codigo_valido(usuario.rol) else RolesUsuario.ciudadano,
        'estado': EstadoUsuario.activo,
        'hash_contrasena': hashed,
        'fecha_creacion': now,
        'fecha_actualizacion': now,
    }
    result = await coll.insert_one(doc)
    doc['_id'] = result.inserted_id

    if audit_logger is not None:
        await audit_logger(
            'usuario_creado',
            id_usuario=str(result.inserted_id),
            correo=usuario.correo,
        )

    response = UsuarioCreateResponse(
        **_to_response_dict(doc),
        contrasena_generada=None if usuario.contrasena else plain_password,
    )
    return response


async def update_usuario(
    id_usuario: str,
    usuario: UsuarioUpdate,
    audit_logger=None,
) -> UsuarioResponse:
    """Actualiza datos o estado de un usuario.

    Args:
        id_usuario: ObjectId del usuario a actualizar.
        usuario: Campos a modificar (cualquier combinacion).
        audit_logger: Callable opcional para registrar cambio.

    Returns:
        Usuario actualizado.

    Raises:
        HTTPException 400 correo duplicado, 404 no encontrado.
    """
    db = get_db()
    coll = db[NombreColecciones.resolver('usuarios')]
    doc = await get_usuario_by_id(id_usuario)
    if doc is None:
        raise HTTPException(status_code=404, detail='Usuario no encontrado.')

    update: dict = {'fecha_actualizacion': datetime.now(timezone.utc)}
    if usuario.correo is not None:
        correo_lc = usuario.correo.strip().lower()
        existing = await coll.find_one(
            {'correo_lc': correo_lc, '_id': {'$ne': doc['_id']}}
        )
        if existing:
            raise HTTPException(status_code=400, detail='El correo ya esta en uso.')
        update['correo'] = usuario.correo
        update['correo_lc'] = correo_lc
    if usuario.nombre_completo is not None:
        update['nombre_completo'] = usuario.nombre_completo
    if usuario.rol is not None:
        if not RolesUsuario.es_codigo_valido(usuario.rol):
            raise HTTPException(status_code=400, detail='Rol invalido.')
        update['rol'] = usuario.rol
    if usuario.activo is not None:
        update['estado'] = (
            EstadoUsuario.activo if usuario.activo else EstadoUsuario.inactivo
        )

    await coll.update_one({'_id': doc['_id']}, {'$set': update})
    refreshed = await coll.find_one({'_id': doc['_id']})
    if audit_logger is not None:
        await audit_logger(
            'usuario_actualizado',
            id_usuario=id_usuario,
            cambios=list(update.keys()),
        )
    return UsuarioResponse(**_to_response_dict(refreshed))


async def delete_usuario(id_usuario: str, audit_logger=None) -> dict:
    """Desactivacion logica (no se elimina el documento)."""
    db = get_db()
    coll = db[NombreColecciones.resolver('usuarios')]
    doc = await get_usuario_by_id(id_usuario)
    if doc is None:
        raise HTTPException(status_code=404, detail='Usuario no encontrado.')

    await coll.update_one(
        {'_id': doc['_id']},
        {
            '$set': {
                'estado': EstadoUsuario.inactivo,
                'fecha_actualizacion': datetime.now(timezone.utc),
            }
        },
    )
    if audit_logger is not None:
        await audit_logger('usuario_desactivado', id_usuario=id_usuario)
    return {'detail': 'Usuario desactivado exitosamente'}


async def update_self_usuario(
    id_usuario: str,
    data: UsuarioSelfUpdate,
    audit_logger=None,
) -> dict:
    """Permite al usuario modificar su correo, nombre y/o contrasena."""
    db = get_db()
    coll = db[NombreColecciones.resolver('usuarios')]
    doc = await get_usuario_by_id(id_usuario)
    if doc is None:
        raise HTTPException(status_code=404, detail='Usuario no encontrado.')

    update: dict = {'fecha_actualizacion': datetime.now(timezone.utc)}
    if data.correo is not None:
        correo_lc = data.correo.strip().lower()
        existing = await coll.find_one(
            {'correo_lc': correo_lc, '_id': {'$ne': doc['_id']}}
        )
        if existing:
            raise HTTPException(
                status_code=400, detail='El correo ya esta en uso por otro usuario.'
            )
        update['correo'] = data.correo
        update['correo_lc'] = correo_lc
    if data.nombre_completo is not None:
        update['nombre_completo'] = data.nombre_completo
    if data.contrasena is not None:
        update['hash_contrasena'] = get_password_hash(data.contrasena)

    if len(update) > 1:
        await coll.update_one({'_id': doc['_id']}, {'$set': update})

    if audit_logger is not None:
        await audit_logger(
            'self_update',
            id_usuario=id_usuario,
            campos=list(update.keys()),
        )

    return {
        'detail': 'Datos actualizados exitosamente',
        'correo_cambiado': data.correo is not None,
        'password_cambiado': data.contrasena is not None,
    }


async def ensure_seed_admin(
    get_password_hash_fn=None,
) -> dict | None:
    """Inserta el administrador inicial si la coleccion esta vacia para ese correo.

    Args:
        get_password_hash_fn: Inyectable para testing; si no se pasa, usa la
            funcion real del modulo security.

    Returns:
        Documento creado o None si ya existia.
    """
    from config import get_seed_admin_config
    import logging

    cfg = get_seed_admin_config()
    if not cfg['enabled']:
        return None

    hash_fn = get_password_hash_fn or get_password_hash

    db = get_db()
    coll = db[NombreColecciones.resolver('usuarios')]
    correo_lc = cfg['correo'].strip().lower()
    existing = await coll.find_one({'correo_lc': correo_lc})
    if existing:
        logging.getLogger('seed').info(
            MensajesDB.seed_omitido, cfg['correo']
        )
        return None

    now = datetime.now(timezone.utc)
    doc = {
        'correo': cfg['correo'],
        'correo_lc': correo_lc,
        'nombre_completo': cfg['nombre_completo'],
        'rol': cfg['rol'] if RolesUsuario.es_codigo_valido(cfg['rol']) else RolesUsuario.admin,
        'estado': EstadoUsuario.activo,
        'hash_contrasena': hash_fn(cfg['contrasena']),
        'fecha_creacion': now,
        'fecha_actualizacion': now,
        'seed_origen': 'auto_bootstrap',
    }
    result = await coll.insert_one(doc)
    doc['_id'] = result.inserted_id
    logging.getLogger('seed').info(MensajesDB.seed_insertado, cfg['correo'])
    return doc
