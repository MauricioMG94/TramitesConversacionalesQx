"""Endpoints de administracion de usuarios (CRUD)."""
from fastapi import APIRouter, Depends, Request

from core.python.auth.deps import (
    get_current_active_user,
    get_current_admin_user,
)
from core.python.schemas.auth_schemas import UserInDB
from core.python.schemas.usuarios_schemas import (
    UsuarioCreate,
    UsuarioCreateResponse,
    UsuarioResponse,
    UsuarioUpdate,
)
from core.python.services import usuario_service

router = APIRouter(prefix='/api/usuarios', tags=['usuarios'])


async def _audit_event(request: Request, current_user: UserInDB, accion: str, **detalles) -> None:
    """Helper para insertar audit_events desde los handlers."""
    from core.python.db.mongo_connection import get_db
    from metadata import NombreColecciones
    from datetime import datetime, timezone

    db = get_db()
    coll = db[NombreColecciones.resolver('audit')]
    await coll.insert_one(
        {
            'accion': accion,
            'actor_correo': current_user.correo,
            'ip': request.client.host if request.client else None,
            'detalles': detalles,
            'ts': datetime.now(timezone.utc),
        }
    )


@router.get('/activos', dependencies=[Depends(get_current_active_user)])
async def list_usuarios_activos() -> list[dict]:
    """Lista basica (id + nombre) para selects del frontend. Solo usuarios activos."""
    return await usuario_service.get_usuarios_basico()


@router.get(
    '',
    response_model=list[UsuarioResponse],
    dependencies=[Depends(get_current_admin_user)],
)
async def list_usuarios() -> list[UsuarioResponse]:
    """Lista todos los usuarios. Solo administradores."""
    return await usuario_service.get_all_usuarios()


@router.post(
    '',
    response_model=UsuarioCreateResponse,
    dependencies=[Depends(get_current_admin_user)],
)
async def create_usuario(
    usuario: UsuarioCreate,
    request: Request,
    current_user: UserInDB = Depends(get_current_admin_user),
) -> UsuarioCreateResponse:
    """Crea un usuario nuevo. Si no se envia contrasena, se genera una aleatoria."""

    async def _audit_event(accion: str, **detalles) -> None:
        await _audit_event(request, current_user, accion, **detalles)

    return await usuario_service.create_usuario(usuario, audit_logger=_audit_event)


@router.put(
    '/{id_usuario}',
    response_model=UsuarioResponse,
    dependencies=[Depends(get_current_admin_user)],
)
async def update_usuario(
    id_usuario: str,
    usuario: UsuarioUpdate,
    request: Request,
    current_user: UserInDB = Depends(get_current_admin_user),
) -> UsuarioResponse:
    """Actualiza datos o estado de un usuario. Solo administradores."""

    async def _audit_event(accion: str, **detalles) -> None:
        await _audit_event(request, current_user, accion, **detalles)

    return await usuario_service.update_usuario(
        id_usuario, usuario, audit_logger=_audit_event
    )


@router.delete(
    '/{id_usuario}',
    dependencies=[Depends(get_current_admin_user)],
)
async def delete_usuario(
    id_usuario: str,
    request: Request,
    current_user: UserInDB = Depends(get_current_admin_user),
) -> dict:
    """Desactivacion logica de un usuario. Solo administradores."""

    async def _audit_event(accion: str, **detalles) -> None:
        await _audit_event(request, current_user, accion, **detalles)

    return await usuario_service.delete_usuario(id_usuario, audit_logger=_audit_event)
