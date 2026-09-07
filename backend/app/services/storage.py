from __future__ import annotations

import hashlib
import io
import re
import zipfile
from abc import ABC, abstractmethod
from pathlib import Path

import boto3

from ..config import Settings, get_settings
from ..errors import APIError

ALLOWED_EXTENSIONS = {".docx", ".pdf", ".xlsx", ".png", ".jpg", ".jpeg"}
EXPECTED_MIME = {
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pdf": "application/pdf",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}


def safe_filename(filename: str) -> str:
    name = Path(filename).name
    name = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff._-]+", "_", name).strip("._")
    return name[:180] or "upload"


def _zip_kind(content: bytes) -> str | None:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            names = set(archive.namelist())
            if "word/document.xml" in names:
                return ".docx"
            if "xl/workbook.xml" in names:
                return ".xlsx"
    except zipfile.BadZipFile:
        return None
    return None


def detect_extension(content: bytes) -> str | None:
    if content.startswith(b"%PDF-"):
        return ".pdf"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if content.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if content.startswith(b"PK\x03\x04"):
        return _zip_kind(content)
    return None


def validate_upload(filename: str, content_type: str | None, content: bytes) -> tuple[str, str]:
    settings = get_settings()
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise APIError(415, "unsupported_file_type", "仅支持 DOCX、PDF、XLSX、PNG、JPG、JPEG")
    if not content:
        raise APIError(422, "empty_file", "上传文件为空")
    if len(content) > settings.max_upload_bytes:
        raise APIError(413, "file_too_large", "文件超过允许大小")
    detected = detect_extension(content)
    normalized = ".jpg" if extension == ".jpeg" else extension
    if detected != normalized:
        raise APIError(415, "file_signature_mismatch", "文件内容与扩展名不一致")
    expected_mime = EXPECTED_MIME[extension]
    if content_type and content_type not in {expected_mime, "application/octet-stream"}:
        raise APIError(415, "mime_mismatch", "文件 MIME 类型与扩展名不一致")
    return extension, expected_mime


class ObjectStorage(ABC):
    @abstractmethod
    def put(self, key: str, content: bytes, content_type: str) -> None: ...

    @abstractmethod
    def get(self, key: str) -> bytes: ...

    @abstractmethod
    def exists(self, key: str) -> bool: ...


class LocalObjectStorage(ObjectStorage):
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        target = (self.root / key).resolve()
        if self.root not in target.parents:
            raise ValueError("Object key escapes storage root")
        return target

    def put(self, key: str, content: bytes, content_type: str) -> None:
        del content_type
        target = self._path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()


class S3ObjectStorage(ObjectStorage):
    def __init__(self, settings: Settings) -> None:
        self.bucket = settings.s3_bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            region_name=settings.s3_region,
        )

    def ensure_bucket(self) -> None:
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except Exception:
            self.client.create_bucket(Bucket=self.bucket)

    def put(self, key: str, content: bytes, content_type: str) -> None:
        self.ensure_bucket()
        self.client.put_object(Bucket=self.bucket, Key=key, Body=content, ContentType=content_type)

    def get(self, key: str) -> bytes:
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        content = response["Body"].read()
        if not isinstance(content, bytes):
            raise TypeError("S3 object body did not return bytes")
        return content

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:
            return False


def get_storage() -> ObjectStorage:
    settings = get_settings()
    if settings.storage_backend == "s3":
        return S3ObjectStorage(settings)
    return LocalObjectStorage(settings.local_storage_path)


def object_key(organization_id: str, file_id: str, version: int, filename: str) -> str:
    return f"{organization_id}/{file_id}/v{version}/{safe_filename(filename)}"


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()
