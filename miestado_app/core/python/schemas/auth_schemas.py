"""Esquemas Pydantic para el modulo de autenticacion."""

from pydantic import BaseModel, EmailStr, Field


class Token(BaseModel):
    """Respuesta estandar del endpoint /api/auth/token."""

    access_token: str
    """Token JWT firmado (Bearer)."""

    token_type: str = 'bearer'
    """Tipo de token (siempre 'bearer' para OAuth2)."""


class TokenData(BaseModel):
    """Datos extraidos de un JWT valido."""

    username: str | None = None
    """Subject del JWT, mapeado al correo del usuario."""


class UserBase(BaseModel):
    """Campos comunes de usuario."""

    correo: EmailStr
    nombre_completo: str = Field(min_length=1, max_length=200)
    rol: str


class UserInDB(UserBase):
    """Representacion interna de un usuario autenticado."""

    id_usuario: str
    """ObjectId serializado como string."""

    estado: str = 'activo'
    """Estado actual: activo | inactivo | bloqueado."""
