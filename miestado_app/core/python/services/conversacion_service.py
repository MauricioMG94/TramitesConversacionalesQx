"""Servicios del modulo conversacional (chat + bot).

Combina deteccion de intenciones, invocacion al cliente RUNT y
persistencia de mensajes en MongoDB. La capa de router expone este
servicio como un delegado delgado.
"""

import logging
import re
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status

from config import get_chat_config, get_runt_config
from core.python.db.mongo_connection import get_db
from core.python.schemas.conversacion_schemas import (
    MensajePersistido,
    MensajeUsuario,
    RespuestaBot,
)
from core.python.schemas.vehiculo_schemas import (
    VehiculoConsultaRequest,
    VehiculoData,
)
from core.python.services import vehiculo_service
from metadata import (
    AuditoriaAcciones,
    MensajesChat,
    NombreColecciones,
    RegexConversacion,
    RuntIntents,
)

logger = logging.getLogger(__name__)


def _detectar_intencion(texto: str) -> tuple:
    """Detecta si un mensaje incluye placa + documento del propietario.

    Args:
        texto: Mensaje enviado por el usuario.

    Returns:
        Tupla ``(intencion, datos)`` donde ``datos`` es ``None`` si la
        intencion es ``desconocido`` o un dict ``{placa, documento}`` cuando
        el bot encontro ambos datos en el texto.
    """
    match_placa = re.search(RegexConversacion.placa, texto.upper())
    match_doc = re.search(RegexConversacion.cedula, texto)
    if match_placa and match_doc:
        datos = {'placa': match_placa.group(0), 'documento': match_doc.group(0)}
        return RuntIntents.consulta_vehiculo, datos
    return RuntIntents.desconocido, None


def _formatear_respuesta_runt(plantilla: str, contexto: dict) -> str:
    """Sustituye placeholders ``{clave}`` en una plantilla de respuesta.

    Args:
        plantilla: Cadena con placeholders en formato ``{clave}``.
        contexto: Diccionario con los valores a sustituir.

    Returns:
        Cadena con los placeholders reemplazados.
    """
    try:
        mensaje = plantilla.format(**contexto)
    except KeyError:
        mensaje = plantilla
    return mensaje


async def _obtener_o_crear_conversacion(correo_usuario: str, id_conversacion: str | None) -> dict:
    """Recupera la conversacion del usuario o crea una nueva.

    Args:
        correo_usuario: Correo del usuario autenticado.
        id_conversacion: ObjectId en string, o ``None`` para crear nueva.

    Returns:
        Documento Mongo de la conversacion.

    Raises:
        HTTPException 404 si el ``id_conversacion`` no existe.
        HTTPException 400 si el id tiene formato invalido.
    """
    db = get_db()
    coll = db[NombreColecciones.resolver('conversaciones')]

    if id_conversacion is None:
        ahora = datetime.now(timezone.utc)
        nuevo = {
            'correo_usuario': correo_usuario,
            'correo_usuario_lc': correo_usuario.lower(),
            'fecha_creacion': ahora,
            'fecha_ultimo_mensaje': ahora,
            'mensajes': [],
        }
        resultado = await coll.insert_one(nuevo)
        conversacion = await coll.find_one({'_id': resultado.inserted_id})
        return conversacion

    try:
        oid = ObjectId(id_conversacion)
    except (InvalidId, TypeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='id_conversacion no tiene un formato valido.',
        )

    conversacion = await coll.find_one(
        {'_id': oid, 'correo_usuario_lc': correo_usuario.lower()}
    )
    if conversacion is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail='Conversacion no encontrada para este usuario.',
        )
    return conversacion


def _serializar_mensajes(mensajes: list) -> list:
    """Convierte la lista de mensajes de Mongo en ``MensajePersistido``.

    Args:
        mensajes: Lista de subdocumentos ``mensajes`` almacenados en Mongo.

    Returns:
        Lista de ``MensajePersistido`` ordenada cronologicamente.
    """
    serializados = [MensajePersistido(**m) for m in mensajes]
    return serializados


async def _persistir_mensajes(conversacion_oid: ObjectId, mensajes: list) -> None:
    """Actualiza la conversacion con los nuevos mensajes y el timestamp.

    Args:
        conversacion_oid: ObjectId de la conversacion a actualizar.
        mensajes: Lista de subdocumentos a agregar al final del array ``mensajes``.
    """
    db = get_db()
    coll = db[NombreColecciones.resolver('conversaciones')]
    ahora = datetime.now(timezone.utc)
    await coll.update_one(
        {'_id': conversacion_oid},
        {
            '$push': {'mensajes': {'$each': mensajes}},
            '$set': {'fecha_ultimo_mensaje': ahora},
        },
    )


async def _auditar(accion: str, detalles: dict) -> None:
    """Inserta un evento en ``audit_events`` (best-effort, no bloqueante)."""
    db = get_db()
    coll = db[NombreColecciones.resolver('audit')]
    try:
        await coll.insert_one(
            {
                'accion': accion,
                'detalles': detalles,
                'ts': datetime.now(timezone.utc),
            }
        )
    except Exception as exc:
        logger.warning('No se pudo escribir audit_events: %s', exc)


async def procesar_mensaje(payload: MensajeUsuario) -> RespuestaBot:
    """Procesa un mensaje del usuario y devuelve la respuesta del bot.

    Flujo:
        1. Resuelve (o crea) la conversacion en MongoDB.
        2. Detecta la intencion del mensaje.
        3. Si la intencion es ``consulta_vehiculo`` y RUNT esta
           habilitado, invoca el servicio de vehiculos para obtener
           los datos canonicos.
        4. Compone la respuesta redactada del bot.
        5. Persiste los mensajes (usuario + bot) en la conversacion.

    Args:
        payload: Request validado por Pydantic.

    Returns:
        ``RespuestaBot`` con id de conversacion, intencion, datos del
        vehiculo (si aplica), texto redactado del bot e historial.

    Raises:
        HTTPException 503 si el chat o RUNT estan deshabilitados.
    """
    chat_cfg = get_chat_config()
    if not chat_cfg['enabled']:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='Chat conversacional deshabilitado por configuracion.',
        )

    conversacion = await _obtener_o_crear_conversacion(
        correo_usuario=payload.correo_usuario,
        id_conversacion=payload.id_conversacion,
    )

    fecha_usuario = datetime.now(timezone.utc)
    mensaje_usuario_doc = {
        'rol': 'usuario',
        'texto': payload.texto,
        'intencion': None,
        'fecha': fecha_usuario,
    }

    intencion, datos_intencion = _detectar_intencion(payload.texto)
    vehiculo: VehiculoData | None = None
    texto_bot = MensajesChat.bienvenida
    detalles_audit: dict = {
        'correo_usuario': payload.correo_usuario,
        'id_conversacion': str(conversacion['_id']),
        'intencion': intencion,
    }

    if intencion == RuntIntents.consulta_vehiculo and datos_intencion is not None:
        runt_cfg = get_runt_config()
        detalles_audit['placa'] = datos_intencion['placa']
        detalles_audit['documento'] = datos_intencion['documento']
        try:
            vehiculo_resp = await vehiculo_service.consultar_vehiculo(
                _to_vehiculo_request(datos_intencion)
            )
            vehiculo = vehiculo_resp.vehiculo
            contexto = {
                'placa': vehiculo_resp.vehiculo.marca,  # placeholder; se sobreescribe abajo
                'marca': vehiculo.marca,
                'modelo': vehiculo.modelo,
                'clase': vehiculo.clase,
                'color': vehiculo.color,
                'estado': vehiculo.estado,
                'propietario_doc': vehiculo.propietario_doc,
            }
            contexto['placa'] = datos_intencion['placa']
            texto_bot = _formatear_respuesta_runt(MensajesChat.runt_encontrado, contexto)
            await _auditar(AuditoriaAcciones.runt_consulta, detalles_audit)
        except HTTPException as exc:
            if exc.status_code == status.HTTP_404_NOT_FOUND:
                contexto = {'placa': datos_intencion['placa']}
                texto_bot = _formatear_respuesta_runt(MensajesChat.runt_no_encontrado, contexto)
                await _auditar(AuditoriaAcciones.runt_consulta, detalles_audit)
            else:
                texto_bot = MensajesChat.runt_error
                await _auditar(
                    AuditoriaAcciones.runt_consulta_error,
                    {**detalles_audit, 'http_status': exc.status_code},
                )
        except Exception as exc:
            logger.exception('Error inesperado procesando consulta RUNT: %s', exc)
            texto_bot = MensajesChat.runt_error
            await _auditar(
                AuditoriaAcciones.runt_consulta_error,
                {**detalles_audit, 'error': str(exc)},
            )

    fecha_bot = datetime.now(timezone.utc)
    mensaje_bot_doc = {
        'rol': 'bot',
        'texto': texto_bot,
        'intencion': intencion,
        'fecha': fecha_bot,
    }

    if chat_cfg['persist_conversaciones']:
        await _persistir_mensajes(
            conversacion['_id'],
            [mensaje_usuario_doc, mensaje_bot_doc],
        )

    historial_completo = _serializar_mensajes(conversacion.get('mensajes', []))
    max_historial = chat_cfg['max_historial']
    if max_historial > 0 and len(historial_completo) > max_historial:
        historial = historial_completo[-max_historial:]
    else:
        historial = historial_completo

    respuesta = RespuestaBot(
        id_conversacion=str(conversacion['_id']),
        intencion=intencion,
        vehiculo=vehiculo,
        texto_bot=texto_bot,
        historial=historial,
    )
    return respuesta


def _to_vehiculo_request(datos: dict) -> VehiculoConsultaRequest:
    """Convierte ``{placa, documento}`` en un ``VehiculoConsultaRequest``."""
    return VehiculoConsultaRequest(
        placa=datos['placa'],
        documento_propietario=datos['documento'],
    )
