"""Esquemas Pydantic del modulo conversacional (chat + bot).

Define los modelos para ``POST /api/conversaciones/mensaje``: persistencia
de mensajes, historial y respuesta del bot cuando detecta intencion de
consulta de vehiculo en RUNT.
"""

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from core.python.schemas.vehiculo_schemas import VehiculoData


class MensajeUsuario(BaseModel):
    """Cuerpo de POST /api/conversaciones/mensaje.

    Attributes:
        id_conversacion: Identificador opcional; si se omite se crea una nueva conversacion.
        texto: Mensaje libre que el usuario envia al bot.
        correo_usuario: Correo del usuario que envia el mensaje (para asociar la conversacion).
    """

    id_conversacion: str | None = Field(default=None)
    texto: str = Field(..., min_length=1, max_length=2000)
    correo_usuario: EmailStr


class MensajePersistido(BaseModel):
    """Vista de un mensaje almacenado en MongoDB.

    Attributes:
        rol: ``"usuario"`` o ``"bot"``.
        texto: Contenido del mensaje.
        intencion: Intencion detectada (cuando aplica).
        fecha: Timestamp del mensaje.
    """

    rol: str
    texto: str
    intencion: str | None = Field(default=None)
    fecha: datetime


class ConversacionResumen(BaseModel):
    """Encabezado de una conversacion retornado al cliente.

    Attributes:
        id_conversacion: ObjectId de Mongo serializado.
        correo_usuario: Correo del propietario de la conversacion.
        fecha_creacion: Timestamp de creacion.
        fecha_ultimo_mensaje: Timestamp del ultimo mensaje.
    """

    id_conversacion: str
    correo_usuario: EmailStr
    fecha_creacion: datetime
    fecha_ultimo_mensaje: datetime


class RespuestaBot(BaseModel):
    """Respuesta completa a un mensaje del usuario.

    Attributes:
        id_conversacion: ObjectId de la conversacion afectada.
        intencion: Intencion detectada por el bot.
        vehiculo: Datos del vehiculo cuando la intencion es ``consulta_vehiculo`` y RUNT respondio.
        texto_bot: Respuesta redactada que el bot muestra al usuario.
        historial: Mensajes previos entregados al bot para contexto.
    """

    id_conversacion: str
    intencion: str
    vehiculo: VehiculoData | None = Field(default=None)
    texto_bot: str
    historial: list = Field(default_factory=list)
