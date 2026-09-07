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
    session_cookie_secure: bool = False
    session_ttl_seconds: int = 28_800
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:8080", "http://localhost:8443"]
    max_upload_bytes: int = 52_428_800
    demo_admin_password: str = "ChangeMe123!"  # noqa: S105
    celery_task_always_eager: bool = False
    conversion_timeout_seconds: int = 120

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    def validate_runtime(self) -> None:
        if self.app_env == "production" and len(self.app_secret_key) < 32:
            raise RuntimeError("APP_SECRET_KEY must contain at least 32 characters in production")
        if self.llm_provider == "openai_compatible":
            if not self.openai_base_url or not self.openai_api_key or not self.openai_model:
                raise RuntimeError("OpenAI-compatible provider configuration is incomplete")


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.validate_runtime()
    return settings
