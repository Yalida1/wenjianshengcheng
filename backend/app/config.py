from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    app_env: str = "development"
    app_secret_key: str = "development-only-secret-change-before-production"  # noqa: S105
    database_url: str = "sqlite:///./data/docchain.db"
    redis_url: str = "redis://localhost:6379/0"
    s3_endpoint_url: str = "http://localhost:9000"
    s3_access_key: str = "docchain"
    s3_secret_key: str = "change-this-minio-password"  # noqa: S105
    s3_bucket: str = "project-documents"
    s3_region: str = "us-east-1"
    storage_backend: str = "local"
    local_storage_path: Path = Path("data/objects")
    llm_provider: str = "demo"
    openai_base_url: str | None = None
    openai_api_key: str | None = None
    openai_model: str | None = None
    llm_timeout_seconds: int = 180
    session_cookie_secure: bool = False
    session_ttl_seconds: int = 28_800
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:8080", "http://localhost:8443"]
    max_upload_bytes: int = 52_428_800
    demo_admin_account: str = "admin"
    demo_admin_password: str = "admin123"  # noqa: S105
    demo_organization_name: str = "Demo 组织"
    celery_task_always_eager: bool = False
    conversion_timeout_seconds: int = 120
    procurement_planning_enabled: bool = True
    procurement_analysis_chunk_chars: int = 24_000
    procurement_analysis_max_parallel_chunks: int = 3
    procurement_analysis_soft_time_limit_seconds: int = 1_800
    procurement_analysis_time_limit_seconds: int = 1_860
    procurement_analysis_stale_after_seconds: int = 300
    procurement_analysis_recovery_interval_seconds: int = 60
    generation_soft_time_limit_seconds: int = 7_200
    generation_time_limit_seconds: int = 7_260

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("demo_admin_account")
    @classmethod
    def validate_demo_admin_account(cls, value: str) -> str:
        normalized = value.strip().lower()
        if len(normalized) < 3 or any(character.isspace() for character in normalized):
            raise ValueError("DEMO_ADMIN_ACCOUNT must contain at least 3 non-space characters")
        return normalized

    @field_validator("demo_admin_password")
    @classmethod
    def validate_demo_admin_password(cls, value: str) -> str:
        if len(value) < 8:
            raise ValueError("DEMO_ADMIN_PASSWORD must contain at least 8 characters")
        return value

    @field_validator("demo_organization_name")
    @classmethod
    def validate_demo_organization_name(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) < 2:
            raise ValueError("DEMO_ORGANIZATION_NAME must contain at least 2 characters")
        return normalized

    def validate_runtime(self) -> None:
        if self.app_env == "production" and len(self.app_secret_key) < 32:
            raise RuntimeError("APP_SECRET_KEY must contain at least 32 characters in production")
        if self.app_env == "production" and len(self.demo_admin_password) < 12:
            raise RuntimeError("DEMO_ADMIN_PASSWORD must contain at least 12 characters in production")
        if self.llm_provider == "openai_compatible":
            if not self.openai_base_url or not self.openai_api_key or not self.openai_model:
                raise RuntimeError("OpenAI-compatible provider configuration is incomplete")


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.validate_runtime()
    return settings
