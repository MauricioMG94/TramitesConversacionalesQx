"""Dependencias inyectables de FastAPI para autenticacion basada en JWT.

* ``oauth2_scheme``: marker de OAuth2PasswordBearer con ``/api/auth/token``.
* ``get_user_by_correo``: lookup Mongo (case-insensitive) por correo.
* ``get_current_user``: valida el JWT y devuelve ``UserInDB``.
* ``get_current_active_user``: rechaza usuarios inactivos.
* ``get_current_admin_user``: requiere rol admin (RBAC basico).
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import ValidationError

from core.python.auth.security import decode_token
from core.python.db.mongo_connection import get_db
from core.python.schemas.auth_schemas import TokenData, UserInDB
from metadata import MensajesAuth, NombreColecciones

oauth2_scheme = OAuth2PasswordBearer(tokenUrl='api/auth/token')


async def get_user_by_correo(correo: str) -> dict | None:
    """Busca un usuario activo por correo electronico (case-insensitive).

    Args:
        correo: Correo electronico a buscar.

    Returns:
        Documento del usuario o ``None`` si no existe.
    """
    db = get_db()
    coll = db[NombreColecciones.resolver('usuarios')]
    return await coll.find_one({'correo_lc': correo.strip().lower()})


async def get_current_user(token: str = Depends(oauth2_scheme)) -> UserInDB:
    """Decodifica el JWT del header Authorization y devuelve el usuario asociado.

    Args:
        token: JWT extraido via OAuth2PasswordBearer.

    Returns:
        Instancia de ``UserInDB`` con los datos del usuario.

    Raises:
        HTTPException 401 si el token es invalido o el usuario no existe.
    """
    creds_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=MensajesAuth.unauthorized,
        headers={'WWW-Authenticate': 'Bearer'},
    )
    payload = decode_token(token)
    if payload is None:
        raise creds_exc
    correo = payload.get('sub')
    if not correo:
        raise creds_exc
    try:
        token_data = TokenData(username=correo)
    except ValidationError:
        raise creds_exc

    user = await get_user_by_correo(token_data.username)
    if user is None:
        raise creds_exc
    return UserInDB(
        id_usuario=str(user['_id']),
        correo=user['correo'],
        nombre_completo=user['nombre_completo'],
        rol=user['rol'],
        estado=user.get('estado', 'activo'),
    )


async def get_current_active_user(
    current_user: UserInDB = Depends(get_current_user),
) -> UserInDB:
    """Asegura que el usuario autenticado esta en estado activo.

    Raises:
        HTTPException 400 si el usuario esta inactivo o bloqueado.
    """
    if current_user.estado != 'activo':
        raise HTTPException(status_code=400, detail=MensajesAuth.inactive_user)
    return current_user


async def get_current_admin_user(
    current_user: UserInDB = Depends(get_current_active_user),
) -> UserInDB:
    """Restringe el endpoint a usuarios con rol ``admin``.

    Raises:
        HTTPException 403 si el rol no es admin.
    """
    if current_user.rol != 'admin':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=MensajesAuth.admin_required,
        )
    return current_user
