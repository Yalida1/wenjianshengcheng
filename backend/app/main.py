from __future__ import annotations

import secrets
import time
from collections.abc import Awaitable, Callable
from typing import Any

import redis
import structlog
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from sqlalchemy import text
from starlette.responses import JSONResponse

from .api import router
from .config import get_settings
from .db import SessionLocal
from .errors import error_body, register_exception_handlers
from .models import AuditLog, User
from .schemas import ErrorEnvelope
from .security import CSRF_COOKIE, CSRF_HEADER

logger = structlog.get_logger()
REQUEST_COUNT = Counter("docchain_http_requests_total", "HTTP requests", ["method", "path", "status"])
REQUEST_DURATION = Histogram("docchain_http_request_seconds", "HTTP request duration", ["path"])
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
CSRF_EXEMPT_PATHS = {"/api/v1/auth/login"}


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="项目文件链式生成平台 API",
        version="0.1.0",
        description="项目建议书、可研报告、招标文件和合同的受控生成与定稿 API",
        responses={
            status: {"model": ErrorEnvelope, "description": description}
            for status, description in {
                400: "请求不符合业务规则",
                401: "身份认证失败",
                403: "没有操作权限",
                404: "资源不存在",
                409: "数据版本冲突",
                413: "上传内容过大",
                415: "不支持的媒体类型",
                422: "请求参数校验失败",
                429: "请求过于频繁",
                500: "服务端处理失败",
            }.items()
        },
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-CSRF-Token", "X-Request-ID", "If-Match"],
    )

    @app.middleware("http")
    async def request_context(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = request.headers.get("X-Request-ID") or secrets.token_hex(12)
        request.state.request_id = request_id
        started = time.monotonic()
        if request.method not in SAFE_METHODS and request.url.path not in CSRF_EXEMPT_PATHS:
            cookie = request.cookies.get(CSRF_COOKIE)
            header = request.headers.get(CSRF_HEADER)
            if not cookie or not header or not secrets.compare_digest(cookie, header):
                return JSONResponse(
                    status_code=403,
                    content=error_body(request, "csrf_invalid", "CSRF 校验失败"),
                    headers={"X-Request-ID": request_id},
                )
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("unhandled_request_error", request_id=request_id, path=request.url.path)
            raise
        if request.method not in SAFE_METHODS and 400 <= response.status_code < 500:
            actor = getattr(request.state, "user", None)
            if isinstance(actor, User):
                try:
                    with SessionLocal() as audit_db:
                        audit_db.add(
                            AuditLog(
                                organization_id=actor.organization_id,
                                actor_user_id=actor.id,
                                action="request.rejected",
                                object_type="http_request",
                                request_id=request_id,
                                ip_address=request.client.host if request.client else None,
                                metadata_json={
                                    "method": request.method,
                                    "path": request.url.path,
                                    "status": response.status_code,
                                },
                                created_by=actor.id,
                                updated_by=actor.id,
                            )
                        )
                        audit_db.commit()
                except Exception:  # noqa: BLE001 - rejection response must still be returned
                    logger.exception(
                        "rejected_request_audit_failed",
                        request_id=request_id,
                        path=request.url.path,
                    )
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'none'"
        duration = time.monotonic() - started
        REQUEST_COUNT.labels(request.method, request.url.path, response.status_code).inc()
        REQUEST_DURATION.labels(request.url.path).observe(duration)
        logger.info(
            "request_complete",
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=round(duration * 1000, 2),
        )
        return response

    @app.get("/health", tags=["system"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/ready", tags=["system"], response_model=None)
    def ready() -> Any:
        try:
            with SessionLocal() as db:
                db.execute(text("SELECT 1"))
            redis.Redis.from_url(settings.redis_url, socket_connect_timeout=1).ping()
        except Exception as exc:
            return JSONResponse(status_code=503, content={"status": "not_ready", "reason": str(exc)})
        return {"status": "ready"}

    @app.get("/metrics", include_in_schema=False)
    def metrics() -> Response:
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    app.include_router(router)
    register_exception_handlers(app)
    return app


app = create_app()
