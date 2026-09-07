from __future__ import annotations

import hashlib
import json
import sqlite3
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GOLDEN_DIR = ROOT / "artifacts" / "golden_case"
DATABASE = GOLDEN_DIR / "golden.db"
OBJECTS = GOLDEN_DIR / "objects"
REPORT = ROOT / "artifacts" / "backup-restore-smoke.json"


def _table_counts(database: Path) -> dict[str, int]:
    with sqlite3.connect(database) as connection:
        tables = [
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        ]
        return {
            table: int(
                connection.execute(
                    f'SELECT COUNT(*) FROM "{table}"'  # noqa: S608 - sqlite_master names.
                ).fetchone()[0]
            )
            for table in tables
        }


def _object_hashes(root: Path) -> dict[str, str]:
    return {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def run_smoke() -> None:
    if not DATABASE.is_file() or not OBJECTS.is_dir():
        raise SystemExit("Golden Case 数据不存在；请先运行 python -m backend.scripts.golden_case")
    source_counts = _table_counts(DATABASE)
    source_hashes = _object_hashes(OBJECTS)
    with tempfile.TemporaryDirectory(prefix="docchain-backup-") as temp_value:
        temp = Path(temp_value)
        backup_db = temp / "database.backup.db"
        with sqlite3.connect(DATABASE) as source, sqlite3.connect(backup_db) as target:
            source.backup(target)
        restored_db = temp / "restored.db"
        restored_db.write_bytes(backup_db.read_bytes())

        archive_path = temp / "objects.zip"
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(OBJECTS.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(OBJECTS).as_posix())
        restored_objects = temp / "restored-objects"
        restored_objects.mkdir()
        with zipfile.ZipFile(archive_path) as archive:
            for member in archive.infolist():
                target = (restored_objects / member.filename).resolve()
                if restored_objects.resolve() not in target.parents:
                    raise RuntimeError("Backup archive contains an unsafe object path")
            archive.extractall(restored_objects)

        restored_counts = _table_counts(restored_db)
        restored_hashes = _object_hashes(restored_objects)
        if restored_counts != source_counts:
            raise RuntimeError("Database restore counts do not match source")
        if restored_hashes != source_hashes:
            raise RuntimeError("Object storage restore hashes do not match source")

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(
        json.dumps(
            {
                "status": "passed",
                "database_tables": source_counts,
                "object_count": len(source_hashes),
                "method": "SQLite online backup plus ZIP object archive smoke test",
                "production_note": "PostgreSQL and MinIO use scripts/backup.sh and scripts/restore.sh.",
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    print(f"Backup and restore smoke passed: {REPORT}")


if __name__ == "__main__":
    run_smoke()
