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
os.environ["LLM_PROVIDER"] = "demo"
os.environ["DEMO_ADMIN_ACCOUNT"] = "admin"
os.environ["DEMO_ADMIN_PASSWORD"] = "admin123"  # noqa: S105

from backend.app.api import _login_attempts  # noqa: E402
from backend.app.db import Base, engine  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.scripts.seed import seed  # noqa: E402


_PURE_UNIT_NODE_MARKERS = (
    "test_field_extraction_scoped",
    "test_rule_channel_package_id",
    "test_ensure_default_grouping_unit",
    "test_dual_channel_parse",
)


def _test_needs_database(request: pytest.FixtureRequest) -> bool:
    """Skip SQLite reset for pure unit tests that never request client fixtures."""

    nodeid = request.node.nodeid
    if any(marker in nodeid for marker in _PURE_UNIT_NODE_MARKERS):
        return False
    fixturenames = set(getattr(request.node, "fixturenames", ()))
    if fixturenames & {"client", "authenticated_client"}:
        return True
    # Module-level pure helpers (no fixtures) — avoid drop_all races on shared SQLite.
    return bool(fixturenames & {"clean_database"})


@pytest.fixture(autouse=True)
def clean_database(request: pytest.FixtureRequest) -> Generator[None, None, None]:
    if not _test_needs_database(request):
        yield
        return
    _login_attempts.clear()
    with engine.begin() as connection:
        if connection.dialect.name == "sqlite":
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        Base.metadata.drop_all(bind=connection)
        if connection.dialect.name == "sqlite":
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        Base.metadata.create_all(bind=connection)
    seed()
    yield
    with engine.begin() as connection:
        if connection.dialect.name == "sqlite":
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        Base.metadata.drop_all(bind=connection)
        if connection.dialect.name == "sqlite":
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")


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
