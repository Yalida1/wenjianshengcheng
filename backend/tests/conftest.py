from __future__ import annotations

import os
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TEST_DB = Path("data/test-docchain.db").resolve()
TEST_STORAGE = Path("data/test-objects").resolve()

os.environ["APP_ENV"] = "test"
os.environ["APP_SECRET_KEY"] = (  # noqa: S105
    "test-secret-key-with-more-than-thirty-two-characters"
)
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ["STORAGE_BACKEND"] = "local"
os.environ["LOCAL_STORAGE_PATH"] = str(TEST_STORAGE)
os.environ["CELERY_TASK_ALWAYS_EAGER"] = "true"
os.environ["DEMO_ADMIN_ACCOUNT"] = "admin"
os.environ["DEMO_ADMIN_PASSWORD"] = "admin123"  # noqa: S105

from backend.app.api import _login_attempts  # noqa: E402
from backend.app.db import Base, engine  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.scripts.seed import seed  # noqa: E402


@pytest.fixture(autouse=True)
def clean_database() -> Generator[None, None, None]:
    _login_attempts.clear()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    seed()
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def authenticated_client(client: TestClient) -> TestClient:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin", "password": "admin123"},
    )
    assert response.status_code == 200, response.text
    client.headers["X-CSRF-Token"] = response.json()["csrf_token"]
    return client
