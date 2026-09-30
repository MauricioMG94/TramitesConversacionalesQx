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
