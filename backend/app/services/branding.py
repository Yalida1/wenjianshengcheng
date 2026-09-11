"""Organization product branding defaults and logo validation."""

from __future__ import annotations

from pathlib import Path

from ..errors import APIError
from ..models import Organization

DEFAULT_BRAND_NAME = "智能招标管理"
DEFAULT_BRAND_SUBTITLE = "受控生成与定稿平台"
DEFAULT_BRAND_MARK = "智"
MAX_BRAND_LOGO_BYTES = 2 * 1024 * 1024
BRAND_LOGO_EXTENSIONS = {".png", ".jpg", ".jpeg", ".svg"}
BRAND_LOGO_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
}


def branding_payload(organization: Organization | None) -> dict[str, object]:
    name = (organization.brand_name if organization else None) or DEFAULT_BRAND_NAME
    subtitle = (organization.brand_subtitle if organization else None) or DEFAULT_BRAND_SUBTITLE
    mark = (organization.brand_mark if organization else None) or (
        name[:1] if name else DEFAULT_BRAND_MARK
    )
    revision = organization.revision if organization else 1
    has_custom_logo = bool(organization and organization.brand_logo_key)
    return {
        "name": name,
        "subtitle": subtitle,
        "mark": mark,
        "document_title": name,
        "has_custom_logo": has_custom_logo,
        "logo_url": f"/api/v1/branding/logo?v={revision}" if has_custom_logo else None,
        "revision": revision,
    }


def detect_brand_logo_extension(content: bytes) -> str | None:
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if content.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    head = content.lstrip()[:200].lower()
    if head.startswith(b"<?xml") or head.startswith(b"<svg"):
        return ".svg"
    return None


def validate_brand_logo(filename: str, content_type: str | None, content: bytes) -> tuple[str, str]:
    if not content:
        raise APIError(422, "empty_file", "上传文件为空")
    if len(content) > MAX_BRAND_LOGO_BYTES:
        raise APIError(413, "file_too_large", "Logo 文件不能超过 2MB")
    extension = Path(filename).suffix.lower()
    if extension == ".jpeg":
        extension = ".jpg"
    if extension not in BRAND_LOGO_EXTENSIONS:
        raise APIError(415, "unsupported_file_type", "Logo 仅支持 PNG、JPG、SVG")
    detected = detect_brand_logo_extension(content)
    expected = ".jpg" if extension == ".jpeg" else extension
    if detected != expected:
        raise APIError(415, "file_signature_mismatch", "文件内容与扩展名不一致")
    if extension == ".svg":
        lowered = content.lower()
        if b"<script" in lowered or b"javascript:" in lowered or b"onload=" in lowered:
            raise APIError(415, "unsafe_svg", "SVG 包含不安全内容")
    mime = BRAND_LOGO_MIME[extension]
    if content_type and content_type not in {mime, "application/octet-stream", "image/jpg"}:
        raise APIError(415, "mime_mismatch", "文件 MIME 类型与扩展名不一致")
    return extension, mime


def brand_logo_object_key(organization_id: str, extension: str) -> str:
    return f"{organization_id}/branding/logo{extension}"
