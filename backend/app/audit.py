from __future__ import annotations

from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from .models import AuditLog, User


def record_audit(
    db: Session,
    request: Request,
    user: User | None,
    action: str,
    object_type: str,
    object_id: str | None,
    *,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> AuditLog:
    organization_id = user.organization_id if user else str((metadata or {}).get("organization_id", "system"))
    log = AuditLog(
        organization_id=organization_id,
        actor_user_id=user.id if user else None,
        action=action,
        object_type=object_type,
        object_id=object_id,
        request_id=getattr(request.state, "request_id", None),
        ip_address=request.client.host if request.client else None,
        before=before,
        after=after,
        metadata_json=metadata or {},
        created_by=user.id if user else None,
        updated_by=user.id if user else None,
    )
    db.add(log)
    return log
