"""Unified Document Intermediate Representation (DocumentIR).

Both the rule channel and the LLM channel consume the same versioned snapshot.
Shared reading/OCR is preprocessing — never counted as dual-channel analysis.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from decimal import Decimal
from typing import Any, Literal

READER_VERSION = "document-ir-reader-v1"
NORMALIZER_VERSION = "document-ir-normalizer-v1"

BlockKind = Literal[
    "heading",
    "paragraph",
    "table",
    "table_caption",
    "footnote",
    "textbox",
    "image_region",
    "toc",
    "header_footer",
]
SourceType = Literal[
    "native_text",
    "ocr",
    "converted_doc",
    "spreadsheet",
    "image_page",
    "excluded_duplicate",
]


@dataclass
class TableCell:
    row: int
    col: int
    text: str
    rowspan: int = 1
    colspan: int = 1
    is_header: bool = False


@dataclass
class TableStructure:
    table_id: str
    rows: list[list[str]]
    cells: list[TableCell] = field(default_factory=list)
    header_row_count: int = 1
    semantic_role: str | None = None  # procurement_package | investment | equipment | unknown


@dataclass
class IRBlock:
    block_id: str
    sequence: int
    kind: BlockKind
    raw_text: str
    normalized_text: str
    section_path: str | None = None
    page_number: int | None = None
    locator: dict[str, Any] = field(default_factory=dict)
    source_type: SourceType = "native_text"
    quality_flags: list[str] = field(default_factory=list)
    confidence: float | None = 1.0
    table: TableStructure | None = None
    excluded: bool = False
    exclude_reason: str | None = None


@dataclass
class ReadCoverage:
    pages_total: int | None = None
    pages_read: list[int] = field(default_factory=list)
    pages_failed: list[int] = field(default_factory=list)
    pages_ocr: list[int] = field(default_factory=list)
    pages_low_quality: list[int] = field(default_factory=list)
    blocks_total: int = 0
    blocks_excluded: int = 0
    table_count: int = 0
    conversion_notes: list[str] = field(default_factory=list)
    unsupported_reason: str | None = None
    needs_ocr: bool = False
    incomplete: bool = False


@dataclass
class DocumentIR:
    document_id: str
    document_version: str
    file_hash: str
    original_filename: str
    format: str
    language: str = "zh"
    page_count: int | None = None
    page_count_available: bool = True
    reader_version: str = READER_VERSION
    normalizer_version: str = NORMALIZER_VERSION
    converter_version: str | None = None
    blocks: list[IRBlock] = field(default_factory=list)
    coverage: ReadCoverage = field(default_factory=ReadCoverage)

    def content_hash(self) -> str:
        payload = {
            "document_version": self.document_version,
            "file_hash": self.file_hash,
            "reader_version": self.reader_version,
            "blocks": [
                {
                    "block_id": block.block_id,
                    "sequence": block.sequence,
                    "kind": block.kind,
                    "normalized_text": block.normalized_text,
                    "section_path": block.section_path,
                    "page_number": block.page_number,
                }
                for block in self.blocks
                if not block.excluded
            ],
        }
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DocumentIR:
        coverage_raw = data.get("coverage") or {}
        coverage = ReadCoverage(
            **{k: v for k, v in coverage_raw.items() if k in ReadCoverage.__dataclass_fields__}
        )
        blocks: list[IRBlock] = []
        for raw in data.get("blocks") or []:
            table_raw = raw.get("table")
            table = None
            if isinstance(table_raw, dict):
                cells = [TableCell(**cell) for cell in table_raw.get("cells") or []]
                table = TableStructure(
                    table_id=str(table_raw.get("table_id") or ""),
                    rows=list(table_raw.get("rows") or []),
                    cells=cells,
                    header_row_count=int(table_raw.get("header_row_count") or 1),
                    semantic_role=table_raw.get("semantic_role"),
                )
            blocks.append(
                IRBlock(
                    block_id=str(raw["block_id"]),
                    sequence=int(raw["sequence"]),
                    kind=raw.get("kind") or "paragraph",
                    raw_text=str(raw.get("raw_text") or ""),
                    normalized_text=str(raw.get("normalized_text") or ""),
                    section_path=raw.get("section_path"),
                    page_number=raw.get("page_number"),
                    locator=dict(raw.get("locator") or {}),
                    source_type=raw.get("source_type") or "native_text",
                    quality_flags=list(raw.get("quality_flags") or []),
                    confidence=raw.get("confidence"),
                    table=table,
                    excluded=bool(raw.get("excluded")),
                    exclude_reason=raw.get("exclude_reason"),
                )
            )
        return cls(
            document_id=str(data.get("document_id") or ""),
            document_version=str(data.get("document_version") or ""),
            file_hash=str(data.get("file_hash") or ""),
            original_filename=str(data.get("original_filename") or ""),
            format=str(data.get("format") or ""),
            language=str(data.get("language") or "zh"),
            page_count=data.get("page_count"),
            page_count_available=bool(data.get("page_count_available", True)),
            reader_version=str(data.get("reader_version") or READER_VERSION),
            normalizer_version=str(data.get("normalizer_version") or NORMALIZER_VERSION),
            converter_version=data.get("converter_version"),
            blocks=blocks,
            coverage=coverage,
        )


def normalize_text(text: str) -> str:
    """Normalize whitespace and full/half-width forms without dropping negations."""
    if not text:
        return ""
    # full-width digits/letters → half-width
    translated = []
    for char in text:
        code = ord(char)
        if 0xFF01 <= code <= 0xFF5E:
            translated.append(chr(code - 0xFEE0))
        elif char in {"\u3000", "\xa0"}:
            translated.append(" ")
        else:
            translated.append(char)
    collapsed = "".join(translated)
    collapsed = collapsed.replace("\r\n", "\n").replace("\r", "\n")
    collapsed = "\n".join(" ".join(line.split()) for line in collapsed.split("\n"))
    return collapsed.strip()


def parse_amount_expression(
    text: str,
) -> dict[str, Any] | None:
    """Parse amount expressions; keep approximate markers and tax scope.

    Returns None when no amount is found. Never silently drops 约/暂/不含税.
    """
    import re

    matched = re.search(
        r"(?P<approx>约|大约|近|不超过|不少于|不高于|不低于)?\s*"
        r"(?:人民币)?\s*"
        r"(?P<number>[0-9][0-9,]*(?:\.[0-9]+)?)\s*"
        r"(?P<unit>亿元|万元|万|元)?"
        r"(?P<tax>（?含税）?|（?不含税）?|含税|不含税)?",
        text,
    )
    if not matched:
        return None
    number = Decimal(matched.group("number").replace(",", ""))
    unit = matched.group("unit") or "元"
    multiplier = {
        "亿元": Decimal("100000000"),
        "万元": Decimal("10000"),
        "万": Decimal("10000"),
        "元": Decimal("1"),
    }[unit]
    amount_yuan = number * multiplier
    tax_raw = (matched.group("tax") or "").strip("（）()")
    tax_included: bool | None
    if "不含税" in tax_raw:
        tax_included = False
    elif "含税" in tax_raw:
        tax_included = True
    else:
        tax_included = None
    return {
        "raw": matched.group(0),
        "number": str(number),
        "unit": unit,
        "amount_yuan": str(amount_yuan),
        "approximate": bool(matched.group("approx")),
        "approx_marker": matched.group("approx"),
        "tax_included": tax_included,
        "exact": matched.group("approx") is None,
    }
