"""Cliente asincrono para RUNT (Registro Unico Nacional de Transito).

Responsabilidades:
* Obtener tokens OAuth2 client_credentials (RFC 6749) con cache en memoria
  con TTL configurable (default 1h).
* Soportar autenticacion mutua TLS (mTLS) cuando RUNT lo exija.
* Proveer ``consultar_vehiculo(placa, documento)`` que retorna un dict
  con los campos exigidos por el endpoint /api/vehiculo/consultar.
* Exponer un modo ``mock`` deterministico por placa para piloto sin
  credenciales.

Los secretos (client_id, client_secret y rutas PEM) se leen una sola vez
al inicializar el singleton; cambiar valores requiere reiniciar el
proceso.
"""

import asyncio
import hashlib
import logging
import ssl
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import HTTPException, status

from config import get_runt_config
from metadata import MensajesRunt, RuntEstados

logger = logging.getLogger(__name__)


class _TokenCacheEntry:
    """Cache en memoria del access token de RUNT.

    Attributes:
        access_token: Bearer token emitido por RUNT.
        expires_at: Timestamp (epoch seconds) en que vence, descontando skew.
    """

    __slots__ = ('access_token', 'expires_at')

    def __init__(self, access_token: str, expires_at: float) -> None:
        """Inicializa la entrada de cache.

        Args:
            access_token: Token bearer emitido por RUNT.
            expires_at: Epoch seconds en que el token deja de ser valido.
        """
        self.access_token = access_token
        self.expires_at = expires_at

    def esta_vigente(self) -> bool:
        """Indica si el token sigue siendo valido (con margen de skew)."""
        vigente = self.expires_at > time.monotonic()
        return vigente


class RuntClient:
    """Cliente asincrono que encapsula la integracion con RUNT.

    Modo de operacion (controlado por ``settings.runt.mode``):
    * ``mock`` -> resuelve deterministico por placa sin red.
    * ``real`` -> llamada HTTP real con OAuth2 + cache + mTLS opcional.
    """

    _INSTANCIA: 'RuntClient | None' = None
    _LOCK = asyncio.Lock()

    def __init__(self) -> None:
        """Carga configuracion y deja el cliente en estado inicial."""
        cfg = get_runt_config()
        self._cfg = cfg
        self._token: _TokenCacheEntry | None = None
        self._lock_token = asyncio.Lock()

    @classmethod
    async def instancia(cls) -> 'RuntClient':
        """Devuelve el singleton asincrono del cliente."""
        async with cls._LOCK:
            if cls._INSTANCIA is None:
                cls._INSTANCIA = cls()
        return cls._INSTANCIA

    def _ssl_context(self) -> ssl.SSLContext | None:
        """Construye el ``SSLContext`` para mTLS si esta habilitado.

        Returns:
            ``SSLContext`` con cliente+CA cuando mTLS esta activo, ``None``
            cuando se usa TLS estandar.
        """
        mtls = self._cfg['mtls']
        if not mtls['enabled']:
            return None
        cert_path = Path(mtls['cert_path'])
        key_path = Path(mtls['key_path'])
        if not cert_path.is_file() or not key_path.is_file():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    'RUNT mTLS habilitado pero los certificados no existen '
                    'en el contenedor. Verifica el volumen de secretos.'
                ),
            )
        ctx = ssl.create_default_context()
        ca_path = mtls.get('ca_path') or ''
        if ca_path:
            ca_file = Path(ca_path)
            if ca_file.is_file():
                ctx.load_verify_locations(cafile=str(ca_file))
        ctx.load_cert_chain(certfile=str(cert_path), keyfile=str(key_path))
        return ctx

    @asynccontextmanager
    async def _http_client(self) -> 'httpx.AsyncClient':
        """Context manager que cede un ``AsyncClient`` con la configuracion correcta."""
        ssl_ctx = self._ssl_context()
        timeout = httpx.Timeout(self._cfg['timeout_seconds'])
        limits = httpx.Limits(max_keepalive_connections=5, max_connections=10)
        if ssl_ctx is not None:
            async with httpx.AsyncClient(
                timeout=timeout,
                limits=limits,
                verify=ssl_ctx,
                cert=(str(self._cfg['mtls']['cert_path']), str(self._cfg['mtls']['key_path'])),
            ) as client:
                yield client
        else:
            async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
                yield client

    async def _obtener_token(self) -> str:
        """Devuelve un access token vigente; refresca si expiro o no existe.

        Returns:
            Bearer token listo para el header ``Authorization``.

        Raises:
            HTTPException 503 si RUNT responde con error.
            HTTPException 502 si la red falla.
        """
        async with self._lock_token:
            if self._token is not None and self._token.esta_vigente():
                restantes = int(self._token.expires_at - time.monotonic())
                logger.info(MensajesRunt.vehiculo_cacheado, restantes)
                return_str = self._token.access_token
                return return_str

            if self._cfg['mode'] == 'mock':
                # Token deterministico solo valido dentro del proceso.
                token_val = 'mock-runt-token'
                self._token = _TokenCacheEntry(
                    access_token=token_val,
                    expires_at=time.monotonic() + self._cfg['token_ttl_seconds'],
                )
                logger.info(MensajesRunt.vehiculo_nuevo)
                return token_val

            url_token = f"{self._cfg['base_url']}{self._cfg['token_path']}"
            payload = {
                'grant_type': 'client_credentials',
                'client_id': self._cfg['client_id'],
                'client_secret': self._cfg['client_secret'],
            }
            try:
                async with self._http_client() as client:
                    respuesta = await client.post(url_token, data=payload)
            except httpx.HTTPError as exc:
                logger.exception('Error de red al pedir token a RUNT: %s', exc)
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=MensajesRunt.error_upstream,
                )

            if respuesta.status_code >= 400:
                logger.error(
                    'RUNT /oauth/token respondio %s: %s',
                    respuesta.status_code,
                    respuesta.text[:500],
                )
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=MensajesRunt.error_upstream,
                )

            try:
                cuerpo = respuesta.json()
            except ValueError as exc:
                logger.exception('Respuesta de RUNT /oauth/token no es JSON: %s', exc)
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=MensajesRunt.error_upstream,
                )

            access_token = cuerpo.get('access_token')
            if not access_token:
                logger.error('RUNT /oauth/token sin access_token: %s', cuerpo)
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=MensajesRunt.error_upstream,
                )

            expires_in = int(cuerpo.get('expires_in', self._cfg['token_ttl_seconds']))
            skew = self._cfg['token_refresh_skew_seconds']
            expires_at = time.monotonic() + max(expires_in - skew, 0)
            self._token = _TokenCacheEntry(access_token=access_token, expires_at=expires_at)
            logger.info(MensajesRunt.vehiculo_nuevo)
            return access_token

    def _mock_vehiculo(self, placa: str, documento_propietario: str) -> dict | None:
        """Genera una respuesta deterministica para modo mock.

        Args:
            placa: Placa en mayusculas (se acepta cualquier capitalizacion).
            documento_propietario: Documento a comparar contra el mock.

        Returns:
            ``None`` si la combinacion (placa, doc) no coincide con los mocks
            definidos; en otro caso un dict equivalente a la respuesta real
            de RUNT.
        """
        placa_norm = placa.strip().upper()
        semilla = int(hashlib.sha256(placa_norm.encode('utf-8')).hexdigest(), 16)
        documento_esperado = f'{(semilla % 90000000) + 10000000}'
        if documento_esperado != str(documento_propietario).strip():
            return None

        return {
            'marca': _MARCAS[semilla % len(_MARCAS)],
            'modelo': str(2008 + (semilla % 17)),
            'clase': _CLASES[semilla % len(_CLASES)],
            'color': _COLORES[semilla % len(_COLORES)],
            'propietario_doc': documento_esperado,
            'estado': RuntEstados.activo,
        }

    async def consultar_vehiculo(self, placa: str, documento_propietario: str) -> dict:
        """Consulta un vehiculo por placa y documento del propietario.

        Args:
            placa: Placa del vehiculo (3 letras + 3 digitos / 3 letras + 2 digitos + 1 letra).
            documento_propietario: Numero de documento del propietario.

        Returns:
            Dict con ``marca``, ``modelo``, ``clase``, ``color``,
            ``propietario_doc`` y ``estado`` igual a ``"ACTIVO"``.

        Raises:
            HTTPException 404 si RUNT no encuentra la combinacion.
            HTTPException 502/503 si la red o el upstream fallan.
        """
        placa_norm = placa.strip().upper()
        doc_norm = str(documento_propietario).strip()

        if self._cfg['mode'] == 'mock':
            resultado = self._mock_vehiculo(placa_norm, doc_norm)
            if resultado is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=MensajesRunt.vehiculo_no_encontrado,
                )
            return resultado

        token = await self._obtener_token()
        url = f"{self._cfg['base_url']}{self._cfg['vehiculo_path']}"
        payload = {'placa': placa_norm, 'documento_propietario': doc_norm}
        headers = {'Authorization': f'Bearer {token}'}
        try:
            async with self._http_client() as client:
                respuesta = await client.post(url, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            logger.exception('Error de red al consultar vehiculo en RUNT: %s', exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=MensajesRunt.error_upstream,
            )

        if respuesta.status_code == 404:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=MensajesRunt.vehiculo_no_encontrado,
            )

        if respuesta.status_code >= 400:
            logger.error(
                'RUNT /vehiculo respondio %s: %s',
                respuesta.status_code,
                respuesta.text[:500],
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=MensajesRunt.error_upstream,
            )

        try:
            cuerpo = respuesta.json()
        except ValueError as exc:
            logger.exception('Respuesta de RUNT /vehiculo no es JSON: %s', exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=MensajesRunt.error_upstream,
            )

        campos = {
            'marca': str(cuerpo.get('marca', '')).strip(),
            'modelo': str(cuerpo.get('modelo', '')).strip(),
            'clase': str(cuerpo.get('clase', '')).strip(),
            'color': str(cuerpo.get('color', '')).strip(),
            'propietario_doc': str(cuerpo.get('propietario_doc', '')).strip(),
            'estado': str(cuerpo.get('estado', RuntEstados.activo)).strip().upper(),
        }
        return campos


_MARCAS = ['Chevrolet', 'Renault', 'Toyota', 'Mazda', 'Kia', 'Nissan', 'Hyundai', 'Ford']
_CLASES = ['Automovil', 'Camioneta', 'Motocicleta', 'Campero', 'Microbus']
_COLORES = ['Blanco', 'Negro', 'Gris', 'Rojo', 'Azul', 'Plata', 'Verde']


async def obtener_runt_client() -> RuntClient:
    """Helper para dependencias FastAPI: devuelve el singleton de RUNT."""
    return await RuntClient.instancia()
