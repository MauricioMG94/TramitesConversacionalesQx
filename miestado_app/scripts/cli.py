"""Comandos para tareas frecuentes durante el desarrollo."""

import asyncio
import sys


async def _seed_admin() -> None:
    """Inserta (si no existe) el administrador inicial directamente."""
    from core.python.db.mongo_connection import close_pool, init_pool
    from core.python.services.usuario_service import ensure_seed_admin

    await init_pool()
    await ensure_seed_admin()
    await close_pool()


def main() -> None:
    if len(sys.argv) < 2:
        print('Uso: python -m scripts.cli seed-admin')
        sys.exit(2)
    cmd = sys.argv[1]
    if cmd == 'seed-admin':
        asyncio.run(_seed_admin())
    else:
        print(f'Comando desconocido: {cmd}')
        sys.exit(2)


if __name__ == '__main__':
    main()
