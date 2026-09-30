"""Endpoint de salud (health-check)."""

from fastapi import APIRouter

from core.python.db.mongo_connection import get_db

router = APIRouter(prefix='', tags=['health'])


@router.get('/healthz')
async def healthz() -> dict:
    """Liveness probe - responde siempre que el proceso este vivo."""
    return {'status': 'ok'}


@router.get('/readyz')
async def readyz() -> dict:
    """Readiness probe - hace ping a MongoDB."""
    try:
        db = get_db()
        await db.command('ping')
        return {'status': 'ok', 'mongo': 'ok'}
    except Exception as e:
        return {'status': 'degraded', 'mongo': str(e)}
