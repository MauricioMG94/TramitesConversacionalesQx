"""Servicios del modulo de vehiculos (RUNT).

Punto de entrada para los routers: delega toda la logica de negocio al
cliente de integracion (modo mock o real) y construye la respuesta
canonica que consume el frontend.
"""

import logging

from fastapi import HTTPException, status

from config import get_runt_config
from core.python.schemas.vehiculo_schemas import (
    VehiculoConsultaRequest,
    VehiculoConsultaResponse,
    VehiculoData,
)
from helpers.clients.runt_client import RuntClient, obtener_runt_client
from metadata import MensajesRunt

logger = logging.getLogger(__name__)


async def consultar_vehiculo(payload: VehiculoConsultaRequest) -> VehiculoConsultaResponse:
    """Resuelve una consulta de vehiculo invocando el cliente de RUNT.

    Args:
        payload: Request validado por Pydantic.

    Returns:
        ``VehiculoConsultaResponse`` con datos canonicos, fuente y si
        el token estaba cacheado al momento de la llamada.

    Raises:
        HTTPException 503 si RUNT esta deshabilitado por configuracion.
    """
    cfg = get_runt_config()
    if not cfg['enabled']:
        logger.error('RUNT deshabilitado por configuracion pero se recibio una consulta.')
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='Integracion con RUNT deshabilitada.',
        )

    cliente: RuntClient = await obtener_runt_client()
    token_estaba_cacheado = cliente._token is not None and cliente._token.esta_vigente()
    try:
        datos_crudos = await cliente.consultar_vehiculo(
            placa=payload.placa,
            documento_propietario=payload.documento_propietario,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception('Error inesperado al consultar vehiculo: %s', exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=MensajesRunt.error_upstream,
        )

    vehiculo = VehiculoData(**datos_crudos)
    fuente = 'MOCK' if cfg['mode'] == 'mock' else 'RUNT'
    respuesta = VehiculoConsultaResponse(
        vehiculo=vehiculo,
        fuente=fuente,
        cacheado=token_estaba_cacheado,
    )
    return respuesta
