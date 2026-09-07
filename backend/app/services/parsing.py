from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pymupdf
from docx import Document
from openpyxl import load_workbook


@dataclass(frozen=True)
class ParsedBlock:
    sequence: int
    kind: str
    text: str
    page_number: int | None = None
    section_path: str | None = None
    confidence: float | None = 1.0
    locator: dict[str, object] | None = None


@dataclass(frozen=True)
class ParseResult:
    blocks: list[ParsedBlock]
    needs_ocr: bool = False


def parse_docx(content: bytes) -> ParseResult:
    document = Document(io.BytesIO(content))
    blocks: list[ParsedBlock] = []
    section = None
    sequence = 0
    for index, paragraph in enumerate(document.paragraphs):
        text = paragraph.text.strip()
        if not text:
            continue
        style_name = paragraph.style.name if paragraph.style else ""
        normalized_style = style_name.strip().lower()
        kind = (
            "heading"
            if normalized_style.startswith("heading") or style_name.strip().startswith("标题")
            else "paragraph"
        )
        if kind == "heading":
            section = text
        blocks.append(
            ParsedBlock(
                sequence=sequence,
                kind=kind,
                text=text,
                section_path=section,
                locator={"paragraph_index": index, "style": style_name},
            )
        )
        sequence += 1
    for table_index, table in enumerate(document.tables):
        rows = [" | ".join(cell.text.strip() for cell in row.cells) for row in table.rows]
        text = "\n".join(row for row in rows if row.strip(" |"))
        if text:
            blocks.append(
                ParsedBlock(
                    sequence=sequence,
                    kind="table",
                    text=text,
                    section_path=section,
                    locator={"table_index": table_index},
                )
            )
            sequence += 1
    return ParseResult(blocks=blocks)


def parse_pdf(content: bytes) -> ParseResult:
    pdf: Any = pymupdf.open(stream=content, filetype="pdf")  # type: ignore[no-untyped-call]
    blocks: list[ParsedBlock] = []
    sequence = 0
    for page_index, page in enumerate(pdf):
        text_blocks = page.get_text("blocks")
        for block_index, raw in enumerate(text_blocks):
            text = str(raw[4]).strip()
            if not text:
                continue
            blocks.append(
                ParsedBlock(
                    sequence=sequence,
                    kind="paragraph",
                    text=text,
                    page_number=page_index + 1,
                    locator={"block_index": block_index, "bbox": list(raw[:4])},
                )
            )
            sequence += 1
    return ParseResult(blocks=blocks, needs_ocr=not blocks)


def parse_xlsx(content: bytes) -> ParseResult:
    workbook = load_workbook(io.BytesIO(content), data_only=False, read_only=True)
    blocks: list[ParsedBlock] = []
    sequence = 0
    for sheet in workbook.worksheets:
        rows: list[str] = []
        for row in sheet.iter_rows(values_only=True):
            values = ["" if value is None else str(value) for value in row]
            if any(values):
                rows.append(" | ".join(values))
        if rows:
            blocks.append(
                ParsedBlock(
                    sequence=sequence,
                    kind="table",
                    text="\n".join(rows),
                    section_path=sheet.title,
                    locator={"sheet": sheet.title},
                )
            )
            sequence += 1
    return ParseResult(blocks=blocks)


def parse_file(filename: str, content: bytes) -> ParseResult:
    extension = Path(filename).suffix.lower()
    if extension == ".docx":
        return parse_docx(content)
    if extension == ".pdf":
        return parse_pdf(content)
    if extension == ".xlsx":
        return parse_xlsx(content)
    if extension in {".png", ".jpg", ".jpeg"}:
        return ParseResult(blocks=[], needs_ocr=True)
    raise ValueError(f"Unsupported parser extension: {extension}")
