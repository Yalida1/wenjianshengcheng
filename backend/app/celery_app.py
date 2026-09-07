from __future__ import annotations

from celery import Celery

from .config import get_settings

settings = get_settings()
celery_app = Celery("docchain", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_always_eager=settings.celery_task_always_eager,
    task_eager_propagates=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_soft_time_limit=600,
    task_time_limit=660,
    task_track_started=True,
)
celery_app.autodiscover_tasks(["backend.app"])
