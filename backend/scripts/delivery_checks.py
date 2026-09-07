from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "artifacts"
REQUIRED_DELIVERY_FILES = (
    "README.md",
    "docs/PRODUCT.md",
    "docs/ARCHITECTURE.md",
    "docs/DATA_MODEL.md",
    "docs/API.md",
    "docs/AI_PROVIDER.md",
    "docs/FILE_PARSING.md",
    "docs/DOCUMENT_GENERATION.md",
    "docs/FORMAT_STANDARDS.md",
    "docs/TEMPLATE_AUTHORING.md",
    "docs/SECURITY.md",
    "docs/DEPLOYMENT.md",
    "docs/OPERATIONS.md",
    "docs/BACKUP_AND_RESTORE.md",
    "docs/TESTING.md",
    "docs/USER_GUIDE.md",
    "docs/ADMIN_GUIDE.md",
    "KNOWN_LIMITATIONS.md",
    "DELIVERY_REPORT.md",
    "TEST_RESULTS.md",
)
REQUIRED_GOLDEN = (
    "项目建议书_V1.0.docx",
    "项目建议书_V1.0.pdf",
    "可行性研究报告_V1.0.docx",
    "可行性研究报告_V1.0.pdf",
    "招标文件_V1.0.docx",
    "招标文件_V1.0.pdf",
    "合同预草案_V0.1.docx",
    "合同签约准备版_V1.0.docx",
    "合同签约准备版_V1.0.pdf",
    "field-traceability.xlsx",
    "validation-report.json",
    "format-compliance-report.json",
)


def check_environment() -> None:
    missing = [name for name in ("soffice", "pdftotext") if shutil.which(name) is None]
    if missing:
        raise SystemExit(f"Missing document runtime commands: {', '.join(missing)}")
    required = ["package.json", "pyproject.toml", "alembic.ini", "docker-compose.yml"]
    absent = [name for name in required if not (ROOT / name).is_file()]
    if absent:
        raise SystemExit(f"Missing build configuration: {', '.join(absent)}")
    print(f"Environment check passed: Python {sys.version.split()[0]}, soffice, pdftotext")


def check_migrations() -> None:
    with tempfile.TemporaryDirectory(prefix="docchain-migration-") as temp_value:
        database = Path(temp_value) / "fresh.db"
        old_url = os.environ.get("DATABASE_URL")
        os.environ["DATABASE_URL"] = f"sqlite:///{database.as_posix()}"
        try:
            from backend.app.config import get_settings

            get_settings.cache_clear()
            config = Config(str(ROOT / "alembic.ini"))
            command.upgrade(config, "head")
            engine = create_engine(os.environ["DATABASE_URL"])
            try:
                tables = set(inspect(engine).get_table_names())
            finally:
                engine.dispose()
            required = {"alembic_version", "projects", "document_versions", "field_evidence"}
            missing = required - tables
            if missing:
                raise RuntimeError(f"Fresh migration is missing tables: {sorted(missing)}")
        finally:
            if old_url is None:
                os.environ.pop("DATABASE_URL", None)
            else:
                os.environ["DATABASE_URL"] = old_url
            get_settings.cache_clear()
    print(f"Fresh database migration passed with {len(tables)} tables")


def _text_files() -> list[Path]:
    ignored = {".git", ".codex-git-checkpoint", ".venv", "node_modules", "artifacts", "data"}
    suffixes = {".py", ".ts", ".tsx", ".js", ".json", ".yml", ".yaml", ".toml", ".md", ".sh"}
    return [
        path
        for path in ROOT.rglob("*")
        if path.is_file()
        and path.suffix.lower() in suffixes
        and not any(part in ignored for part in path.relative_to(ROOT).parts)
    ]


def check_secrets() -> None:
    patterns = {
        "OpenAI key": re.compile(r"sk-[A-Za-z0-9_-]{20,}"),
        "AWS access key": re.compile(r"AKIA[0-9A-Z]{16}"),
        "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    }
    findings: list[str] = []
    for path in _text_files():
        content = path.read_text(encoding="utf-8", errors="ignore")
        for label, pattern in patterns.items():
            if pattern.search(content):
                findings.append(f"{path.relative_to(ROOT)}: {label}")
    if findings:
        raise SystemExit("Potential secrets found:\n" + "\n".join(findings))
    print(f"Secret scan passed across {len(_text_files())} source and documentation files")


def check_final() -> None:
    missing_docs = [name for name in REQUIRED_DELIVERY_FILES if not (ROOT / name).is_file()]
    golden = ARTIFACTS / "golden_case"
    missing_outputs = [name for name in REQUIRED_GOLDEN if not (golden / name).is_file()]
    if missing_docs or missing_outputs:
        raise SystemExit(
            json.dumps(
                {"missing_delivery_files": missing_docs, "missing_golden_outputs": missing_outputs},
                ensure_ascii=False,
                indent=2,
            )
        )
    hashes = {
        name: hashlib.sha256((golden / name).read_bytes()).hexdigest() for name in REQUIRED_GOLDEN
    }
    report = ARTIFACTS / "delivery-gate.json"
    report.write_text(
        json.dumps(
            {"status": "passed", "delivery_file_count": len(REQUIRED_DELIVERY_FILES), "sha256": hashes},
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    print(f"Delivery gate passed: {report}")


def clean() -> None:
    targets = (ROOT / ".pytest_cache", ROOT / ".mypy_cache", ROOT / ".ruff_cache", ROOT / "dist")
    for target in targets:
        if target.exists() and target.resolve().parent == ROOT.resolve():
            shutil.rmtree(target)
            print(f"Removed cache/build directory: {target.name}")
    for cache in ROOT.glob("backend/**/__pycache__"):
        resolved = cache.resolve()
        if ROOT.resolve() in resolved.parents:
            shutil.rmtree(cache)
    print("Clean completed; artifacts and source inputs were preserved")


def main() -> None:
    actions = {
        "environment": check_environment,
        "migrations": check_migrations,
        "secrets": check_secrets,
        "final": check_final,
        "clean": clean,
    }
    if len(sys.argv) != 2 or sys.argv[1] not in actions:
        raise SystemExit(f"Usage: {sys.argv[0]} {'|'.join(actions)}")
    actions[sys.argv[1]]()


if __name__ == "__main__":
    main()
