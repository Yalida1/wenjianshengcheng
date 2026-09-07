from __future__ import annotations

from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .errors import APIError
from .models import Permission, Project, ProjectMember, Role, RolePermission, User, UserRole
from .security import SESSION_COOKIE, parse_session_token

DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(request: Request, db: DbSession) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    claims = parse_session_token(token or "")
    if claims is None:
        raise APIError(401, "unauthenticated", "请先登录")
    user = db.get(User, claims.user_id)
    if (
        user is None
        or not user.is_active
        or user.organization_id != claims.organization_id
        or user.session_version != claims.session_version
    ):
        raise APIError(401, "session_invalid", "会话已失效，请重新登录")
    request.state.user = user
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def user_permission_codes(db: Session, user: User) -> set[str]:
    stmt = (
        select(Permission.code)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .join(Role, Role.id == RolePermission.role_id)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == user.id, Role.organization_id == user.organization_id)
    )
    return set(db.scalars(stmt))


def require_permission(code: str) -> Callable[..., User]:
    def dependency(db: DbSession, user: CurrentUser) -> User:
        if code not in user_permission_codes(db, user):
            raise APIError(403, "forbidden", f"缺少权限：{code}")
        return user

    return dependency


def require_project_access(db: Session, user: User, project_id: str) -> Project:
    project = db.scalar(
        select(Project).where(
            Project.id == project_id,
            Project.organization_id == user.organization_id,
        )
    )
    if project is None:
        raise APIError(404, "project_not_found", "项目不存在")
    codes = user_permission_codes(db, user)
    if "system.admin" in codes:
        return project
    membership = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user.id,
        )
    )
    if membership is None:
        raise APIError(403, "project_forbidden", "无权访问该项目")
    return project
