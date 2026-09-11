from __future__ import annotations

from types import SimpleNamespace

from fastapi.testclient import TestClient

from backend.app.services.field_extraction import extract_field_candidates


def test_field_definition_crud_deactivate_and_restore(authenticated_client: TestClient) -> None:
    created = authenticated_client.post(
        "/api/v1/field-definitions",
        json={
            "stage": "requirement",
            "field_key": "custom_scope_note",
            "field_label": "范围补充说明",
            "data_type": "text",
            "unit": None,
            "criticality": "P1",
            "required": False,
            "rules": {"aliases": ["范围补充说明", "补充说明"]},
        },
    )
    assert created.status_code == 201, created.text
    definition_id = created.json()["id"]
    assert created.json()["is_base"] is False
    assert created.json()["is_active"] is True

    duplicate = authenticated_client.post(
        "/api/v1/field-definitions",
        json={
            "stage": "requirement",
            "field_key": "custom_scope_note",
            "field_label": "重复键",
            "data_type": "text",
            "criticality": "P2",
            "required": False,
        },
    )
    assert duplicate.status_code == 409

    patched = authenticated_client.patch(
        f"/api/v1/field-definitions/{definition_id}",
        json={
            "field_label": "范围补充说明（修订）",
            "criticality": "P0",
            "required": True,
            "rules": {"aliases": ["范围补充说明", "补充说明"]},
            "revision": created.json()["revision"],
        },
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["field_label"] == "范围补充说明（修订）"
    assert patched.json()["criticality"] == "P0"
    assert patched.json()["required"] is True

    active_list = authenticated_client.get("/api/v1/field-definitions?stage=requirement")
    assert active_list.status_code == 200
    assert any(item["id"] == definition_id for item in active_list.json())

    deactivated = authenticated_client.post(
        f"/api/v1/field-definitions/{definition_id}/deactivate",
    )
    assert deactivated.status_code == 200
    assert deactivated.json()["is_active"] is False

    active_after = authenticated_client.get("/api/v1/field-definitions?stage=requirement")
    assert all(item["id"] != definition_id for item in active_after.json())

    with_inactive = authenticated_client.get(
        "/api/v1/field-definitions?stage=requirement&include_inactive=true"
    )
    assert any(
        item["id"] == definition_id and item["is_active"] is False for item in with_inactive.json()
    )

    activated = authenticated_client.post(
        f"/api/v1/field-definitions/{definition_id}/activate",
    )
    assert activated.status_code == 200
    assert activated.json()["is_active"] is True

    base = next(item for item in active_after.json() if item["field_key"] == "project_name")
    assert base["is_base"] is True
    authenticated_client.post(
        f"/api/v1/field-definitions/{base['id']}/deactivate",
    )
    restored = authenticated_client.post(
        "/api/v1/field-definitions/restore-base?stage=requirement",
    )
    assert restored.status_code == 200, restored.text
    restored_keys = {item["field_key"] for item in restored.json()}
    assert "project_name" in restored_keys
    assert all(item["is_active"] for item in restored.json())


def test_extraction_uses_definition_aliases() -> None:
    active = SimpleNamespace(
        field_key="custom_owner_alias",
        field_label="业主单位",
        data_type="string",
        rules={"aliases": ["业主单位", "业主名称"], "extract_mode": "label_value"},
    )
    blocks = [
        SimpleNamespace(
            sequence=1,
            text="业主单位：示例建设集团有限公司",
            page_number=1,
            section_path="一、概况",
            locator={"paragraph": 1},
            id="block-1",
        ),
        SimpleNamespace(
            sequence=2,
            text="遗留业主：不应被抽取",
            page_number=1,
            section_path="一、概况",
            locator={"paragraph": 2},
            id="block-2",
        ),
    ]
    candidates = extract_field_candidates(blocks, [active])  # type: ignore[arg-type]
    assert set(candidates) == {"custom_owner_alias"}
    assert candidates["custom_owner_alias"].value == "示例建设集团有限公司"
