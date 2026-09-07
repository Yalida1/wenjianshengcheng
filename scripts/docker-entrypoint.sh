#!/bin/sh
set -eu

if [ "${SERVICE_ROLE:-api}" = "api" ]; then
  alembic upgrade head
  python -m backend.scripts.seed
  exec uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --proxy-headers
fi

if [ "${SERVICE_ROLE:-api}" = "worker" ]; then
  exec celery -A backend.app.worker.celery_app worker --loglevel=INFO --concurrency="${CELERY_CONCURRENCY:-2}"
fi

exec "$@"
