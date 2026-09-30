"""Utilidades de seguridad para autenticacion OAuth2 + JWT.

* Hash de contrasenas con bcrypt.
* Verificacion de contrasenas contra el hash guardado.
* Emision de tokens JWT firmados con HS256.
"""

import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from metadata import MensajesAuth

SECRET_KEY = os.environ.get(
    'SECRET_KEY',
    '09d25e094faa6ca2556c818166b7a9563b93f7099f6f0f4caa6cf63b88e8d3e7',
)
ALGORITHM = 'HS256'
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get('ACCESS_TOKEN_EXPIRE_MINUTES', '1440'))


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifica si una contrasena plana coincide con el hash almacenado.

    Args:
        plain_password: Contrasena en texto plano.
        hashed_password: Hash bcrypt guardado en MongoDB.

    Returns:
        True si la contrasena es valida.
    """
    try:
        return bcrypt.checkpw(
            plain_password.encode('utf-8'),
            hashed_password.encode('utf-8'),
        )
    except (ValueError, TypeError):
        return False


def get_password_hash(password: str) -> str:
    """Genera el hash bcrypt de una contrasena.

    Args:
        password: Contrasena en texto plano.

    Returns:
        Hash bcrypt serializado como cadena.
    """
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """Crea un JWT firmado con los datos proporcionados.

    Args:
        data: Claims a incluir (tipicamente ``{"sub": correo}``).
        expires_delta: Duracion de validez del token.

    Returns:
        JWT codificado en string.
    """
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({'exp': expire, 'iat': datetime.now(timezone.utc)})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict | None:
    """Decodifica y valida un JWT, o retorna None si es invalido.

    Args:
        token: JWT firmado.

    Returns:
        Claims del token o None si la firma/expiracion no son validas.
    """
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
