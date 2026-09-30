"""Esquemas Pydantic para gestion de usuarios."""

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from metadata import RolesUsuario


class UsuarioBase(BaseModel):
    """Campos base compartidos."""

    correo: EmailStr
    nombre_completo: str = Field(min_length=1, max_length=200)
    rol: str = Field(default=RolesUsuario.ciudadano)


class UsuarioCreate(UsuarioBase):
    """Payload para crear un usuario (el backend genera la contrasena).

    Si el caller no envia contrasena, el servicio genera una aleatoria.
    """

    contrasena: str | None = Field(default=None, min_length=8, max_length=128)


class UsuarioUpdate(BaseModel):
    """Payload para actualizacion parcial por admin."""

    correo: EmailStr | None = None
    nombre_completo: str | None = Field(default=None, min_length=1, max_length=200)
    rol: str | None = None
    activo: bool | None = None


class UsuarioSelfUpdate(BaseModel):
    """Payload para que un usuario actualice sus propios datos."""

    correo: EmailStr | None = None
    nombre_completo: str | None = Field(default=None, min_length=1, max_length=200)
    contrasena: str | None = Field(default=None, min_length=8, max_length=128)


class UsuarioResponse(BaseModel):
    """Representacion publica de un usuario."""

    id_usuario: str
    correo: EmailStr
    nombre_completo: str
    rol: str
    activo: bool
    fecha_creacion: datetime


class UsuarioCreateResponse(UsuarioResponse):
    """Respuesta al crear un usuario (incluye la contrasena generada)."""

    contrasena_generada: str | None = None
