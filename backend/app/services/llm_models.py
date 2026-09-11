"""Organization LLM model profile management."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import APIError
from ..models import LlmModelProfile
from ..security import mask_secret, seal_secret, unseal_secret

PROVIDER_DEMO = "demo"
PROVIDER_OPENAI = "openai_compatible"
ALLOWED_PROVIDERS = {PROVIDER_DEMO, PROVIDER_OPENAI}


@dataclass(frozen=True)
class ResolvedLlmConfig:
    source: str  # profile | env
    profile_id: str | None
    profile_name: str | None
    provider: str
    base_url: str | None
    model_name: str | None
    api_key: str | None
    timeout_seconds: int


def profile_payload(profile: LlmModelProfile) -> dict[str, Any]:
    has_api_key = bool(profile.api_key_encrypted)
    api_key_hint: str | None = None
    if has_api_key and profile.api_key_encrypted:
        plain = unseal_secret(profile.api_key_encrypted)
        api_key_hint = mask_secret(plain)
    return {
        "id": profile.id,
        "name": profile.name,
        "provider": profile.provider,
        "base_url": profile.base_url,
        "model_name": profile.model_name,
        "timeout_seconds": profile.timeout_seconds,
        "is_active": profile.is_active,
        "notes": profile.notes,
        "has_api_key": has_api_key,
        "api_key_hint": api_key_hint,
        "revision": profile.revision,
        "created_at": profile.created_at.isoformat() if profile.created_at else None,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
    }


def validate_base_url(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().rstrip("/")
    if not normalized:
        return None
    parts = urlsplit(normalized)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        raise APIError(422, "invalid_base_url", "API 地址须为 http(s):// 开头的完整 URL")
    return normalized


def validate_profile_fields(
    *,
    provider: str,
    base_url: str | None,
    model_name: str | None,
    api_key: str | None,
    require_api_key: bool,
) -> tuple[str | None, str | None]:
    if provider not in ALLOWED_PROVIDERS:
        raise APIError(422, "invalid_provider", "不支持的接入方式")
    if provider == PROVIDER_DEMO:
        return None, "deterministic-v1"
    resolved_url = validate_base_url(base_url)
    if not resolved_url:
        raise APIError(422, "base_url_required", "OpenAI 兼容接口需要填写 API 地址")
    resolved_model = (model_name or "").strip()
    if not resolved_model:
        raise APIError(422, "model_name_required", "请填写模型名称")
    if require_api_key and not (api_key or "").strip():
        raise APIError(422, "api_key_required", "请填写 API Key")
    return resolved_url, resolved_model


def list_profiles(db: Session, organization_id: str) -> list[LlmModelProfile]:
    return list(
        db.scalars(
            select(LlmModelProfile)
            .where(LlmModelProfile.organization_id == organization_id)
            .order_by(LlmModelProfile.is_active.desc(), LlmModelProfile.updated_at.desc())
        )
    )


def get_profile(db: Session, organization_id: str, profile_id: str) -> LlmModelProfile:
    profile = db.get(LlmModelProfile, profile_id)
    if profile is None or profile.organization_id != organization_id:
        raise APIError(404, "llm_model_not_found", "模型配置不存在")
    return profile


def create_profile(
    db: Session,
    *,
    organization_id: str,
    user_id: str,
    name: str,
    provider: str,
    base_url: str | None,
    model_name: str | None,
    api_key: str | None,
    timeout_seconds: int,
    notes: str | None,
    activate: bool,
) -> LlmModelProfile:
    cleaned_name = name.strip()
    if not cleaned_name:
        raise APIError(422, "name_required", "请填写模型名称")
    existing = db.scalar(
        select(LlmModelProfile).where(
            LlmModelProfile.organization_id == organization_id,
            LlmModelProfile.name == cleaned_name,
        )
    )
    if existing is not None:
        raise APIError(409, "llm_model_name_conflict", "同名模型配置已存在")
    resolved_url, resolved_model = validate_profile_fields(
        provider=provider,
        base_url=base_url,
        model_name=model_name,
        api_key=api_key,
        require_api_key=provider == PROVIDER_OPENAI,
    )
    profile = LlmModelProfile(
        organization_id=organization_id,
        name=cleaned_name,
        provider=provider,
        base_url=resolved_url,
        model_name=resolved_model,
        api_key_encrypted=seal_secret(api_key.strip()) if api_key and api_key.strip() else None,
        timeout_seconds=timeout_seconds,
        notes=(notes or "").strip() or None,
        is_active=False,
        created_by=user_id,
        updated_by=user_id,
    )
    db.add(profile)
    db.flush()
    if activate or len(list_profiles(db, organization_id)) == 1:
        activate_profile(db, organization_id=organization_id, profile=profile, user_id=user_id)
    return profile


def update_profile(
    db: Session,
    *,
    profile: LlmModelProfile,
    user_id: str,
    name: str | None,
    provider: str | None,
    base_url: str | None,
    model_name: str | None,
    api_key: str | None,
    clear_api_key: bool,
    timeout_seconds: int | None,
    notes: str | None,
    revision: int,
) -> LlmModelProfile:
    if profile.revision != revision:
        raise APIError(409, "revision_conflict", "模型配置已被其他用户修改，请刷新后重试")
    next_provider = provider or profile.provider
    next_name = name.strip() if name is not None else profile.name
    if not next_name:
        raise APIError(422, "name_required", "请填写模型名称")
    if next_name != profile.name:
        conflict = db.scalar(
            select(LlmModelProfile).where(
                LlmModelProfile.organization_id == profile.organization_id,
                LlmModelProfile.name == next_name,
                LlmModelProfile.id != profile.id,
            )
        )
        if conflict is not None:
            raise APIError(409, "llm_model_name_conflict", "同名模型配置已存在")
    next_base = base_url if base_url is not None else profile.base_url
    next_model = model_name if model_name is not None else profile.model_name
    has_key = bool(profile.api_key_encrypted) and not clear_api_key
    provided_key = (api_key or "").strip() or None
    require_key = next_provider == PROVIDER_OPENAI and not has_key and not provided_key
    resolved_url, resolved_model = validate_profile_fields(
        provider=next_provider,
        base_url=next_base,
        model_name=next_model,
        api_key=provided_key,
        require_api_key=require_key,
    )
    profile.name = next_name
    profile.provider = next_provider
    profile.base_url = resolved_url
    profile.model_name = resolved_model
    if clear_api_key:
        profile.api_key_encrypted = None
    elif provided_key:
        profile.api_key_encrypted = seal_secret(provided_key)
    if timeout_seconds is not None:
        profile.timeout_seconds = timeout_seconds
    if notes is not None:
        profile.notes = notes.strip() or None
    profile.revision += 1
    profile.updated_by = user_id
    return profile


def activate_profile(
    db: Session,
    *,
    organization_id: str,
    profile: LlmModelProfile,
    user_id: str,
) -> LlmModelProfile:
    if profile.organization_id != organization_id:
        raise APIError(404, "llm_model_not_found", "模型配置不存在")
    if profile.provider == PROVIDER_OPENAI:
        if not profile.base_url or not profile.model_name or not profile.api_key_encrypted:
            raise APIError(422, "incomplete_model_profile", "启用前请补全 API 地址、模型名称和 API Key")
    others = list_profiles(db, organization_id)
    for item in others:
        if item.id != profile.id and item.is_active:
            item.is_active = False
            item.revision += 1
            item.updated_by = user_id
    profile.is_active = True
    profile.revision += 1
    profile.updated_by = user_id
    return profile


def delete_profile(db: Session, *, profile: LlmModelProfile, user_id: str) -> None:
    was_active = profile.is_active
    organization_id = profile.organization_id
    db.delete(profile)
    db.flush()
    if was_active:
        remaining = list_profiles(db, organization_id)
        if remaining:
            activate_profile(db, organization_id=organization_id, profile=remaining[0], user_id=user_id)


def active_profile(db: Session, organization_id: str) -> LlmModelProfile | None:
    return db.scalar(
        select(LlmModelProfile).where(
            LlmModelProfile.organization_id == organization_id,
            LlmModelProfile.is_active.is_(True),
        )
    )


def resolve_config(
    db: Session | None,
    organization_id: str | None,
    *,
    env_provider: str,
    env_base_url: str | None,
    env_api_key: str | None,
    env_model: str | None,
    env_timeout: int,
) -> ResolvedLlmConfig:
    if db is not None and organization_id:
        profile = active_profile(db, organization_id)
        if profile is not None:
            api_key = unseal_secret(profile.api_key_encrypted) if profile.api_key_encrypted else None
            return ResolvedLlmConfig(
                source="profile",
                profile_id=profile.id,
                profile_name=profile.name,
                provider=profile.provider,
                base_url=profile.base_url,
                model_name=profile.model_name,
                api_key=api_key,
                timeout_seconds=profile.timeout_seconds,
            )
    return ResolvedLlmConfig(
        source="env",
        profile_id=None,
        profile_name=None,
        provider=env_provider,
        base_url=env_base_url,
        model_name=env_model,
        api_key=env_api_key,
        timeout_seconds=env_timeout,
    )
