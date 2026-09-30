"""Router del modulo de vehiculos (RUNT).

Endpoints:
* ``POST /api/vehiculo/consultar`` -> delega al ``vehiculo_service``.

La autenticacion corre al router protegido global (token JWT activo).
"""

from fastapi import APIRouter, Depends

from core.python.auth.deps import get_current_active_user
from core.python.schemas.auth_schemas import UserInDB
from core.python.schemas.vehiculo_schemas import (
    VehiculoConsultaRequest,
    VehiculoConsultaResponse,
)
from core.python.services import vehiculo_service

router = APIRouter(prefix='/api/vehiculo', tags=['vehiculo'])


@router.post('/consultar', response_model=VehiculoConsultaResponse)
async def consultar_vehiculo(
    payload: VehiculoConsultaRequest,
    _: UserInDB = Depends(get_current_active_user),
) -> VehiculoConsultaResponse:
    """Consulta datos de un vehiculo por placa y documento del propietario.

    Args:
        payload: Placa y documento del propietario (validado por Pydantic).
        _: Usuario autenticado (inyectado por la dependencia).

    Returns:
        Datos canonicos del vehiculo, fuente y si el token estaba cacheado.
    """
    respuesta = await vehiculo_service.consultar_vehiculo(payload)
    return respuesta
