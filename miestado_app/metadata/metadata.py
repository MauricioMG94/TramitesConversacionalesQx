"""Metadatos del sistema MiEstadoApp.

Mensajes de log y constantes de dominio de la aplicacion MiEstadoApp.
"""

from config import get_settings


class MensajesDB:
    """Mensajes estandar para logs del modulo de base de datos."""

    pool_inicializado = 'Pool Mongo inicializado (%s)'
    """Mensaje al abrir el pool motor."""

    pool_cerrado = 'Pool Mongo cerrado.'
    """Mensaje al cerrar el pool."""

    pool_no_inicializado = (
        'El pool de conexiones Mongo no ha sido inicializado. '
        'Llama a init_pool() primero.'
    )
    """Error al solicitar el pool antes de inicializarlo."""

    indice_creado = 'Indice creado en coleccion %s: %s'
    """Mensaje al crear exitosamente un indice."""

    seed_insertado = 'Seed admin insertado: %s'
    """Mensaje al sembrar el administrador inicial."""

    seed_omitido = 'Seed admin omitido: ya existe el correo %s'
    """Mensaje cuando se evita duplicar el admin en el seed."""


class RolesUsuario:
    """Roles disponibles en la plataforma."""

    admin = 'admin'
    """Administrador con acceso completo."""

    operador = 'operador'
    """Operador de entidad (backoffice)."""

    ciudadano = 'ciudadano'
    """Ciudadano autenticado via SSO."""

    CODIGOS_VALIDOS = {admin, operador, ciudadano}

    @classmethod
    def es_codigo_valido(cls, codigo: str) -> bool:
        """Comprueba si un codigo de rol es valido."""
        return codigo in cls.CODIGOS_VALIDOS


class EstadoUsuario:
    """Estados del ciclo de vida de un usuario."""

    activo = 'activo'
    """Usuario habilitado para autenticarse."""

    inactivo = 'inactivo'
    """Usuario deshabilitado (desactivacion logica)."""

    bloqueado = 'bloqueado'
    """Usuario bloqueado por intentos fallidos."""


class NombreColecciones:
    """Nombres logicos de colecciones (mapeo a nombre fisico)."""

    usuarios = 'usuarios'
    conversaciones = 'conversaciones'
    tramites = 'tramites'
    pagos = 'pagos'
    consentimientos = 'consentimientos'
    audit = 'audit_events'

    @classmethod
    def resolver(cls, logica: str) -> str:
        """Resuelve una clave logica a nombre fisico definido en settings.yaml."""
        from config import get_collection_name

        return get_collection_name(logica)


class MensajesAuth:
    """Mensajes y plantillas para el modulo de autenticacion."""

    unauthorized = 'No se pudieron validar las credenciales'
    """Detalle de error cuando el JWT es invalido o expiro."""

    inactive_user = 'Usuario inactivo'
    """Detalle cuando el usuario existe pero no esta habilitado."""

    bad_credentials = 'Usuario o contrasena incorrectos'
    """Detalle del 401 en /api/auth/token."""

    admin_required = 'Operacion reservada para administradores'
    """Detalle del 403 cuando se requiere rol admin."""

    token_expirado = 'Token expirado. Inicia sesion nuevamente.'
    """Aviso en frontend cuando expira el JWT."""


class AuditoriaAcciones:
    """Catalogo de acciones auditables en la coleccion audit_events."""

    login_ok = 'login_ok'
    login_fallido = 'login_fallido'
    usuario_creado = 'usuario_creado'
    usuario_actualizado = 'usuario_actualizado'
    usuario_desactivado = 'usuario_desactivado'
    self_update = 'self_update'
    runt_consulta = 'runt_consulta'
    """Consulta a RUNT resuelta (cacheada o nueva)."""
    runt_consulta_error = 'runt_consulta_error'
    """Consulta a RUNT que fallo por timeout, red o error del upstream."""


class RuntEstados:
    """Estados de vehiculos devueltos por RUNT."""

    activo = 'ACTIVO'
    """Vehiculo con registro vigente en RUNT."""


class RuntIntents:
    """Marcadores de intenciones detectadas por el bot conversacional."""

    consulta_vehiculo = 'consulta_vehiculo'
    """El usuario envio una placa + documento para consultar datos del vehiculo."""

    desconocido = 'desconocido'
    """Intencion no clasificada; el bot responde sin invocar integraciones."""


class MensajesRunt:
    """Mensajes estandar para el modulo de integracion con RUNT."""

    vehiculo_no_encontrado = (
        'No se encontro un vehiculo activo asociado a la placa y documento '
        'proporcionados en RUNT.'
    )
    """Detalle cuando el upstream responde sin coincidencias."""

    error_upstream = (
        'No se pudo conectar con el servicio RUNT en este momento. '
        'Intentalo nuevamente en unos minutos.'
    )
    """Detalle cuando la llamada al cliente RUNT falla por timeout/red."""

    vehiculo_cacheado = 'Consulta a RUNT servida desde cache (%ss restantes).'
    """Log informativo cuando se reutiliza un token cacheado."""

    vehiculo_nuevo = 'Consulta a RUNT ejecutada; token fresco obtenido.'
    """Log informativo cuando se obtiene un token nuevo."""


class RegexConversacion:
    """Patrones regex usados por la deteccion de intenciones del bot."""

    placa = r'\b[A-Z]{3}\d{3}\b|\b[A-Z]{3}\d{2}[A-Z]\b'
    """Placas colombianas tipicas: ABC123 (carros) o ABC12D (motos aunque el RUNT
    tambien acepta el formato antiguo). Se acepta mayusculas; no se permite pegar."""

    cedula = r'\b\d{6,12}\b'
    """Documento de identidad numerico (6 a 12 digitos)."""


class MensajesChat:
    """Mensajes estandar del modulo conversacional."""

    bienvenida = (
        'Hola, soy el asistente de MiEstado. Puedo ayudarte a consultar '
        'tramites, pagos y datos de vehiculos registrados en RUNT. '
        'Para consultar un vehiculo, indicame la placa y tu numero de documento.'
    )
    """Respuesta por defecto cuando la intencion es desconocida."""

    runt_encontrado = (
        'Encontre el vehiculo con placa {placa}: {marca} {modelo} ({clase}, '
        'color {color}). Estado: {estado}. El propietario registrado '
        '(documento {propietario_doc}) coincide con el que indicaste.'
    )
    """Plantilla de respuesta cuando RUNT devuelve datos del vehiculo."""

    runt_no_encontrado = (
        'No encontre informacion para la placa {placa} con ese documento. '
        'Verifica que los datos sean correctos o intenta nuevamente.'
    )
    """Respuesta cuando RUNT no devuelve coincidencias."""

    runt_error = (
        'No pude comunicarme con RUNT en este momento. Intenta nuevamente '
        'en unos minutos.'
    )
    """Respuesta cuando la llamada a RUNT falla."""
