"""Esquemas Pydantic del modulo de vehiculos (RUNT).

Define los modelos de request/response del endpoint
``POST /api/vehiculo/consultar`` que reexpone los datos del registro
RUNT en formato canonico para el frontend.
"""

import re

from pydantic import BaseModel, Field, field_validator

from metadata import RuntEstados

_PLACA_RE = re.compile(r'^[A-Z]{3}\d{3}$|^[A-Z]{3}\d{2}[A-Z]$')
_DOC_RE = re.compile(r'^\d{6,12}$')


class VehiculoConsultaRequest(BaseModel):
    """Cuerpo de la peticion POST /api/vehiculo/consultar.

    Attributes:
        placa: Placa colombiana (3 letras + 3 digitos o 3 letras + 2 digitos + 1 letra).
        documento_propietario: Numero de documento del propietario (6 a 12 digitos).
    """

    placa: str = Field(..., min_length=6, max_length=7)
    documento_propietario: str = Field(..., min_length=6, max_length=12)

    @field_validator('placa')
    @classmethod
    def _normalizar_placa(cls, valor: str) -> str:
        """Pone la placa en mayusculas y valida el formato colombiano."""
        normalizado = valor.strip().upper()
        if not _PLACA_RE.match(normalizado):
            raise ValueError(
                'placa debe tener el formato ABC123 (carros) o ABC12D (motos/runt).'
            )
        return normalizado

    @field_validator('documento_propietario')
    @classmethod
    def _normalizar_documento(cls, valor: str) -> str:
        """Limpia y valida el documento como cadena de 6 a 12 digitos."""
        limpio = re.sub(r'\s+', '', valor)
        if not _DOC_RE.match(limpio):
            raise ValueError('documento_propietario debe tener entre 6 y 12 digitos.')
        return limpio


class VehiculoData(BaseModel):
    """Datos canonicos de un vehiculo segun RUNT.

    Attributes:
        marca: Marca comercial del vehiculo.
        modelo: Anio del modelo (como cadena para soportar valores no numericos).
        clase: Clase del vehiculo (automovil, camioneta, motocicleta, etc).
        color: Color registrado.
        propietario_doc: Documento del propietario registrado en RUNT.
        estado: Estado del registro; en piloto siempre ``"ACTIVO"``.
    """

    marca: str = Field(..., min_length=1, max_length=64)
    modelo: str = Field(..., min_length=1, max_length=32)
    clase: str = Field(..., min_length=1, max_length=32)
    color: str = Field(..., min_length=1, max_length=32)
    propietario_doc: str = Field(..., min_length=6, max_length=12)
    estado: str = Field(default=RuntEstados.activo, min_length=1, max_length=16)


class VehiculoConsultaResponse(BaseModel):
    """Respuesta de /api/vehiculo/consultar.

    Attributes:
        vehiculo: Datos canonicos del vehiculo.
        fuente: Origen de la respuesta (``"RUNT"`` o ``"MOCK"``).
        cacheado: True si el token se reutilizo desde el cache.
    """

    vehiculo: VehiculoData
    fuente: str = Field(default='RUNT')
    cacheado: bool = Field(default=False)
