"""Router del modulo conversacional (chat + bot).

Endpoints:
* ``POST /api/conversaciones/mensaje`` -> delega al ``conversacion_service``.

El bot detecta intencion ``consulta_vehiculo`` (placa + documento en el
mensaje) y dispara la integracion con RUNT para responder al usuario.
La autenticacion corre al router protegido global.
"""

from fastapi import APIRouter, Depends

from core.python.auth.deps import get_current_active_user
from core.python.schemas.auth_schemas import UserInDB
from core.python.schemas.conversacion_schemas import (
    MensajeUsuario,
    RespuestaBot,
)
from core.python.services import conversacion_service

router = APIRouter(prefix='/api/conversaciones', tags=['conversaciones'])


@router.post('/mensaje', response_model=RespuestaBot)
async def enviar_mensaje(
    payload: MensajeUsuario,
    _: UserInDB = Depends(get_current_active_user),
) -> RespuestaBot:
    """Procesa un mensaje del usuario y devuelve la respuesta del bot.

    Args:
        payload: Mensaje del usuario (texto, id de conversacion opcional y correo).
        _: Usuario autenticado (inyectado por la dependencia).

    Returns:
        Respuesta del bot con datos del vehiculo cuando aplica.
    """
    respuesta = await conversacion_service.procesar_mensaje(payload)
    return respuesta
