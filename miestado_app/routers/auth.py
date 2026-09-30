"""Endpoints de autenticacion OAuth2 (Password flow + JWT)."""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm

from core.python.auth.deps import (
    get_current_active_user,
    get_user_by_correo,
)
from core.python.auth.security import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    create_access_token,
    verify_password,
)
from core.python.db.mongo_connection import get_db
from core.python.schemas.auth_schemas import Token, UserInDB
from core.python.schemas.usuarios_schemas import UsuarioSelfUpdate
from core.python.services import usuario_service
from metadata import MensajesAuth, NombreColecciones

router = APIRouter(prefix='/api/auth', tags=['auth'])


async def _audit(
    request: Request,
    accion: str,
    detalles: dict | None = None,
    actor_correo: str | None = None,
) -> None:
    """Inserta un evento en la coleccion audit_events (best-effort)."""
    db = get_db()
    coll = db[NombreColecciones.resolver('audit')]
    from datetime import datetime, timezone
    await coll.insert_one(
        {
            'accion': accion,
            'actor_correo': actor_correo,
            'ip': request.client.host if request.client else None,
            'user_agent': request.headers.get('user-agent'),
            'detalles': detalles or {},
            'ts': datetime.now(timezone.utc),
        }
    )


@router.post('/token', response_model=Token)
async def login_for_access_token(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
) -> Token:
    """Autentica al usuario y devuelve un JWT Bearer.

    Args:
        form_data: Form OAuth2 con campos ``username`` (correo) y ``password``.

    Returns:
        Token JWT firmado.

    Raises:
        HTTPException 401 si las credenciales son invalidas.
    """
    user = await get_user_by_correo(form_data.username)
    if not user or user.get('estado') != 'activo' or not verify_password(
        form_data.password, user['hash_contrasena']
    ):
        await _audit(
            request,
            'login_fallido',
            {'username': form_data.username},
            actor_correo=form_data.username,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=MensajesAuth.bad_credentials,
            headers={'WWW-Authenticate': 'Bearer'},
        )

    expires_delta = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={'sub': user['correo'], 'rol': user['rol']},
        expires_delta=expires_delta,
    )
    await _audit(
        request,
        'login_ok',
        {'rol': user['rol']},
        actor_correo=user['correo'],
    )
    return Token(access_token=access_token)


@router.get('/me', response_model=UserInDB)
async def read_users_me(
    current_user: UserInDB = Depends(get_current_active_user),
) -> UserInDB:
    """Devuelve los datos del usuario autenticado."""
    return current_user


@router.patch('/me')
async def update_users_me(
    data: UsuarioSelfUpdate,
    request: Request,
    current_user: UserInDB = Depends(get_current_active_user),
) -> dict:
    """Actualiza los datos del propio usuario (correo, nombre y/o contrasena)."""

    async def _audit_event(accion: str, **detalles) -> None:
        await _audit(request, accion, detalles, actor_correo=current_user.correo)

    return await usuario_service.update_self_usuario(
        current_user.id_usuario, data, audit_logger=_audit_event
    )
