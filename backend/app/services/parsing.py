"""Document readers producing DocumentIR + legacy ParsedBlock compatibility.

DOCX: document-order body (paragraphs interleaved with tables), structured
tables with merge metadata. PDF: per-page text quality / OCR flags.
DOC conversion is best-effort via LibreOffice when available.
"""

from __future__ import annotations

import hashlib
import io
import re
import shutil
import subprocess
import tempfile
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from uuid import uuid4

import pymupdf
from docx import Document
from docx.document import Document as DocumentObject
from docx.oxml.ns import qn
from docx.table import Table as DocxTable
from docx.text.paragraph import Paragraph
from openpyxl import load_workbook

from .document_ir import (
    DocumentIR,
    IRBlock,
    ReadCoverage,
    TableCell,
    TableStructure,
    normalize_text,
)

# Soft threshold: pages with fewer chars likely need OCR.
_PDF_PAGE_MIN_CHARS = 40
_PDF_LOW_QUALITY_RATIO = 0.35  # CJK / alnum ratio below this → low quality


@dataclass(frozen=True)
class ParsedBlock:
    sequence: int
    kind: str
    text: str
    page_number: int | None = None
    section_path: str | None = None
    confidence: float | None = 1.0
    locator: dict[str, object] | None = None
    table_rows: tuple[tuple[str, ...], ...] | None = None
    quality_flags: tuple[str, ...] = ()


@dataclass(frozen=True)
class ParseResult:
    blocks: list[ParsedBlock]
    needs_ocr: bool = False
    coverage: dict[str, Any] = field(default_factory=dict)
    document_ir: DocumentIR | None = None


def _heading_level(style_name: str) -> int | None:
    normalized = style_name.strip().lower()
    match = re.match(r"heading\s*(\d+)", normalized)
    if match:
        return max(1, min(3, int(match.group(1))))
    match = re.match(r"标题\s*(\d+)", style_name.strip())
    if match:
        return max(1, min(3, int(match.group(1))))
    if normalized.startswith("heading") or style_name.strip().startswith("标题"):
        return 1
    return None


def _is_toc_paragraph(text: str, style_name: str) -> bool:
    style = style_name.lower()
    if "toc" in style or "目录" in style_name:
        return True
    if re.match(r".+\t+\d+\s*$", text) and ("…" in text or "..." in text or "．" in text):
        return True
    return False


def _iter_block_items(document: DocumentObject) -> Iterator[Paragraph | DocxTable]:
    body = document.element.body
    for child in body.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, document)
        elif child.tag == qn("w:tbl"):
            yield DocxTable(child, document)


def _table_matrix(table: DocxTable) -> tuple[list[list[str]], list[TableCell]]:
    """Build a logical matrix preserving merge spans (first cell keeps text)."""
    grid: dict[tuple[int, int], TableCell] = {}
    max_row = 0
    max_col = 0
    for row_idx, row in enumerate(table.rows):
        col_idx = 0
        for cell in row.cells:
            # Skip positions already occupied by prior rowspan/colspan.
            while (row_idx, col_idx) in grid:
                col_idx += 1
            tc = cell._tc  # noqa: SLF001 — needed for merge metadata
            grid_span = tc.grid_span or 1
            v_merge = tc.vMerge
            # python-docx duplicates merged cell objects; detect unique tc
            text = cell.text.strip()
            rowspan = 1
            if v_merge is not None and str(v_merge).lower() == "restart":
                rowspan = 1  # exact span unknown without scanning; keep 1 + flag
            cell_obj = TableCell(
                row=row_idx,
                col=col_idx,
                text=text,
                rowspan=rowspan,
                colspan=int(grid_span),
                is_header=row_idx == 0,
            )
            for r in range(rowspan):
                for c in range(int(grid_span)):
                    pos = (row_idx + r, col_idx + c)
                    if pos not in grid:
                        grid[pos] = cell_obj if (r, c) == (0, 0) else TableCell(
                            row=pos[0],
                            col=pos[1],
                            text="",
                            rowspan=1,
                            colspan=1,
                            is_header=row_idx == 0,
                        )
            max_row = max(max_row, row_idx)
            max_col = max(max_col, col_idx + int(grid_span) - 1)
            col_idx += int(grid_span)
    rows: list[list[str]] = []
    cells: list[TableCell] = []
    for r in range(max_row + 1):
        row_values: list[str] = []
        for c in range(max_col + 1):
            cell = grid.get((r, c))
            value = cell.text if cell else ""
            row_values.append(value)
            if cell and cell.row == r and cell.col == c:
                cells.append(cell)
        # Deduplicate horizontally repeated merge echoes from python-docx
        cleaned: list[str] = []
        prev = None
        for value in row_values:
            if value and value == prev:
                cleaned.append("")
            else:
                cleaned.append(value)
                prev = value if value else prev
        rows.append(cleaned)
    return rows, cells


def _table_text(rows: list[list[str]]) -> str:
    return "\n".join(" | ".join(cell for cell in row) for row in rows if any(cell.strip() for cell in row))


def _guess_table_role(header_text: str, section_path: str | None) -> str | None:
    blob = f"{header_text} {section_path or ''}"
    procurement_markers = (
        "采购包",
        "标段",
        "包件",
        "合同包",
        "采购内容",
        "采购方式",
        "招标方式",
        "控制价",
        "估算价",
        "预算金额",
    )
    investment_markers = ("投资估算", "工程费用", "预备费", "建设投资", "总投资", "资金筹措")
    equipment_markers = ("设备清单", "材料清单", "工程量", "规格型号", "数量")
    if any(marker in blob for marker in procurement_markers):
        return "procurement_package"
    if any(marker in blob for marker in investment_markers):
        return "investment"
    if any(marker in blob for marker in equipment_markers):
        return "equipment"
    return "unknown"


def parse_docx(
    content: bytes,
    *,
    document_id: str = "",
    file_hash: str = "",
    filename: str = "document.docx",
) -> ParseResult:
    document = Document(io.BytesIO(content))
    blocks: list[ParsedBlock] = []
    ir_blocks: list[IRBlock] = []
    heading_stack: list[tuple[int, str]] = []
    sequence = 0
    table_index = 0
    paragraph_index = 0
    excluded_count = 0

    for item in _iter_block_items(document):
        section_path = "/".join(title for _, title in heading_stack) if heading_stack else None
        if isinstance(item, Paragraph):
            text = item.text.strip()
            if not text:
                paragraph_index += 1
                continue
            style_name = item.style.name if item.style else ""
            level = _heading_level(style_name)
            is_toc = _is_toc_paragraph(text, style_name)
            kind = "toc" if is_toc else ("heading" if level is not None else "paragraph")
            locator: dict[str, object] = {"paragraph_index": paragraph_index, "style": style_name}
            if kind == "heading" and level is not None:
                locator["heading_level"] = level
                while heading_stack and heading_stack[-1][0] >= level:
                    heading_stack.pop()
                heading_stack.append((level, text))
                section_path = "/".join(title for _, title in heading_stack)
            block_id = f"b-{sequence:04d}"
            quality: list[str] = []
            if is_toc:
                quality.append("excluded_toc")
                excluded_count += 1
            normalized = normalize_text(text)
            blocks.append(
                ParsedBlock(
                    sequence=sequence,
                    kind=kind if kind != "toc" else "paragraph",
                    text=text,
                    section_path=section_path,
                    locator={**locator, "block_id": block_id, "excluded": is_toc},
                    quality_flags=tuple(quality),
                )
            )
            ir_blocks.append(
                IRBlock(
                    block_id=block_id,
                    sequence=sequence,
                    kind="toc" if is_toc else ("heading" if level is not None else "paragraph"),
                    raw_text=text,
                    normalized_text=normalized,
                    section_path=section_path,
                    locator=locator,
                    source_type="native_text",
                    quality_flags=quality,
                    excluded=is_toc,
                    exclude_reason="table_of_contents" if is_toc else None,
                )
            )
            sequence += 1
            paragraph_index += 1
            continue

        if isinstance(item, DocxTable):
            rows, cells = _table_matrix(item)
            text = _table_text(rows)
            if not text.strip():
                table_index += 1
                continue
            header_text = " ".join(rows[0]) if rows else ""
            role = _guess_table_role(header_text, section_path)
            table_id = f"t-{table_index:03d}"
            block_id = f"b-{sequence:04d}"
            locator = {
                "table_index": table_index,
                "table_id": table_id,
                "block_id": block_id,
                "row_count": len(rows),
                "col_count": max((len(row) for row in rows), default=0),
                "semantic_role": role,
            }
            table_rows = tuple(tuple(row) for row in rows)
            blocks.append(
                ParsedBlock(
                    sequence=sequence,
                    kind="table",
                    text=text,
                    section_path=section_path,
                    locator=locator,
                    table_rows=table_rows,
                )
            )
            ir_blocks.append(
                IRBlock(
                    block_id=block_id,
                    sequence=sequence,
                    kind="table",
                    raw_text=text,
                    normalized_text=normalize_text(text),
                    section_path=section_path,
                    locator=locator,
                    source_type="native_text",
                    table=TableStructure(
                        table_id=table_id,
                        rows=rows,
                        cells=cells,
                        header_row_count=1 if rows else 0,
                        semantic_role=role,
                    ),
                )
            )
            sequence += 1
            table_index += 1

    coverage = ReadCoverage(
        pages_total=None,
        blocks_total=len(ir_blocks),
        blocks_excluded=excluded_count,
        table_count=table_index,
        needs_ocr=False,
        incomplete=False,
    )
    doc_ir = DocumentIR(
        document_id=document_id or "unknown",
        document_version="v1",
        file_hash=file_hash,
        original_filename=filename,
        format="docx",
        page_count=None,
        page_count_available=False,
        blocks=ir_blocks,
        coverage=coverage,
    )
    return ParseResult(
        blocks=blocks,
        needs_ocr=False,
        coverage=coverage.__dict__,
        document_ir=doc_ir,
    )


def _page_text_quality(text: str) -> tuple[str, list[str]]:
    stripped = text.strip()
    if len(stripped) < _PDF_PAGE_MIN_CHARS:
        return "needs_ocr", ["sparse_text"]
    cjk = sum(1 for ch in stripped if "\u4e00" <= ch <= "\u9fff")
    alnum = sum(1 for ch in stripped if ch.isalnum())
    useful = cjk + alnum
    if useful == 0:
        return "needs_ocr", ["no_useful_chars"]
    ratio = useful / max(len(stripped), 1)
    if ratio < _PDF_LOW_QUALITY_RATIO:
        return "low_quality", ["low_char_ratio"]
    return "ok", []


def parse_pdf(
    content: bytes,
    *,
    document_id: str = "",
    file_hash: str = "",
    filename: str = "document.pdf",
) -> ParseResult:
    pdf: Any = pymupdf.open(stream=content, filetype="pdf")  # type: ignore[no-untyped-call]
    blocks: list[ParsedBlock] = []
    ir_blocks: list[IRBlock] = []
    sequence = 0
    pages_read: list[int] = []
    pages_ocr: list[int] = []
    pages_failed: list[int] = []
    pages_low_quality: list[int] = []
    any_text = False

    for page_index, page in enumerate(pdf):
        page_no = page_index + 1
        text_blocks = page.get_text("blocks")
        page_texts: list[str] = []
        page_block_start = sequence
        for block_index, raw in enumerate(text_blocks):
            text = str(raw[4]).strip()
            if not text:
                continue
            page_texts.append(text)
            any_text = True
            block_id = f"b-{sequence:04d}"
            locator = {"block_index": block_index, "bbox": list(raw[:4]), "block_id": block_id}
            blocks.append(
                ParsedBlock(
                    sequence=sequence,
                    kind="paragraph",
                    text=text,
                    page_number=page_no,
                    locator=locator,
                )
            )
            ir_blocks.append(
                IRBlock(
                    block_id=block_id,
                    sequence=sequence,
                    kind="paragraph",
                    raw_text=text,
                    normalized_text=normalize_text(text),
                    page_number=page_no,
                    locator=locator,
                    source_type="native_text",
                )
            )
            sequence += 1

        page_blob = "\n".join(page_texts)
        status, flags = _page_text_quality(page_blob)
        if status == "needs_ocr":
            pages_ocr.append(page_no)
            if page_block_start == sequence:
                # Placeholder so coverage can point at unread page.
                block_id = f"b-{sequence:04d}"
                placeholder = f"[第{page_no}页无可提取文字，需OCR]"
                blocks.append(
                    ParsedBlock(
                        sequence=sequence,
                        kind="paragraph",
                        text=placeholder,
                        page_number=page_no,
                        locator={"block_id": block_id, "ocr_required": True},
                        quality_flags=("needs_ocr",),
                        confidence=0.0,
                    )
                )
                ir_blocks.append(
                    IRBlock(
                        block_id=block_id,
                        sequence=sequence,
                        kind="paragraph",
                        raw_text="",
                        normalized_text="",
                        page_number=page_no,
                        locator={"ocr_required": True},
                        source_type="ocr",
                        quality_flags=["needs_ocr"],
                        confidence=0.0,
                        excluded=False,
                    )
                )
                sequence += 1
            else:
                for ir in ir_blocks[page_block_start:]:
                    ir.quality_flags = list(set(ir.quality_flags + flags + ["needs_ocr"]))
        elif status == "low_quality":
            pages_low_quality.append(page_no)
            for ir in ir_blocks[page_block_start:]:
                ir.quality_flags = list(set(ir.quality_flags + flags))
        else:
            pages_read.append(page_no)

    page_count = len(pdf)
    needs_ocr = (not any_text) or bool(pages_ocr)
    incomplete = bool(pages_ocr) or bool(pages_failed)
    coverage = ReadCoverage(
        pages_total=page_count,
        pages_read=pages_read,
        pages_failed=pages_failed,
        pages_ocr=pages_ocr,
        pages_low_quality=pages_low_quality,
        blocks_total=len(ir_blocks),
        table_count=0,
        needs_ocr=needs_ocr,
        incomplete=incomplete,
    )
    # Pure scan: no native text at all → needs_ocr and empty meaningful blocks
    meaningful = [b for b in blocks if "ocr_required" not in (b.locator or {})]
    doc_ir = DocumentIR(
        document_id=document_id or "unknown",
        document_version="v1",
        file_hash=file_hash,
        original_filename=filename,
        format="pdf",
        page_count=page_count,
        page_count_available=True,
        blocks=ir_blocks,
        coverage=coverage,
    )
    return ParseResult(
        blocks=blocks if meaningful or not needs_ocr else blocks,
        needs_ocr=needs_ocr and not meaningful,
        coverage=coverage.__dict__,
        document_ir=doc_ir,
    )


def parse_xlsx(
    content: bytes,
    *,
    document_id: str = "",
    file_hash: str = "",
    filename: str = "document.xlsx",
) -> ParseResult:
    workbook = load_workbook(io.BytesIO(content), data_only=False, read_only=True)
    blocks: list[ParsedBlock] = []
    ir_blocks: list[IRBlock] = []
    sequence = 0
    table_count = 0
    for sheet in workbook.worksheets:
        rows: list[list[str]] = []
        for row in sheet.iter_rows(values_only=True):
            values = ["" if value is None else str(value) for value in row]
            if any(values):
                rows.append(values)
        if not rows:
            continue
        text = _table_text(rows)
        table_id = f"sheet-{sheet.title}"
        block_id = f"b-{sequence:04d}"
        role = _guess_table_role(" ".join(rows[0]), sheet.title)
        locator = {"sheet": sheet.title, "table_id": table_id, "block_id": block_id, "semantic_role": role}
        blocks.append(
            ParsedBlock(
                sequence=sequence,
                kind="table",
                text=text,
                section_path=sheet.title,
                locator=locator,
                table_rows=tuple(tuple(row) for row in rows),
            )
        )
        ir_blocks.append(
            IRBlock(
                block_id=block_id,
                sequence=sequence,
                kind="table",
                raw_text=text,
                normalized_text=normalize_text(text),
                section_path=sheet.title,
                locator=locator,
                source_type="spreadsheet",
                table=TableStructure(
                    table_id=table_id,
                    rows=rows,
                    header_row_count=1,
                    semantic_role=role,
                ),
            )
        )
        sequence += 1
        table_count += 1
    coverage = ReadCoverage(
        blocks_total=len(ir_blocks),
        table_count=table_count,
        needs_ocr=False,
    )
    doc_ir = DocumentIR(
        document_id=document_id or "unknown",
        document_version="v1",
        file_hash=file_hash,
        original_filename=filename,
        format="xlsx",
        page_count_available=False,
        blocks=ir_blocks,
        coverage=coverage,
    )
    return ParseResult(blocks=blocks, coverage=coverage.__dict__, document_ir=doc_ir)


def _try_convert_doc_to_docx(content: bytes, filename: str) -> tuple[bytes | None, str | None]:
    """Convert legacy .doc via LibreOffice when available. Returns (docx_bytes, error)."""
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return None, "missing_libreoffice"
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / (Path(filename).stem + ".doc")
        src.write_bytes(content)
        try:
            completed = subprocess.run(  # noqa: S603
                [soffice, "--headless", "--convert-to", "docx", "--outdir", tmp, str(src)],
                check=False,
                capture_output=True,
                timeout=120,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            return None, f"doc_conversion_failed:{exc}"
        out = Path(tmp) / (Path(filename).stem + ".docx")
        if not out.exists():
            detail = (completed.stderr or completed.stdout or b"").decode("utf-8", errors="ignore")[:500]
            return None, f"doc_conversion_failed:{detail or completed.returncode}"
        return out.read_bytes(), None


def parse_image(
    content: bytes,
    *,
    document_id: str = "",
    file_hash: str = "",
    filename: str = "page.png",
) -> ParseResult:
    block_id = "b-0000"
    placeholder = f"[图像页 {filename} 需OCR，当前环境未配置本地OCR引擎]"
    coverage = ReadCoverage(
        pages_total=1,
        pages_ocr=[1],
        blocks_total=1,
        needs_ocr=True,
        incomplete=True,
        unsupported_reason="ocr_engine_not_configured",
    )
    ir = DocumentIR(
        document_id=document_id or "unknown",
        document_version="v1",
        file_hash=file_hash,
        original_filename=filename,
        format=Path(filename).suffix.lower().lstrip(".") or "image",
        page_count=1,
        blocks=[
            IRBlock(
                block_id=block_id,
                sequence=0,
                kind="image_region",
                raw_text="",
                normalized_text="",
                page_number=1,
                locator={"block_id": block_id},
                source_type="image_page",
                quality_flags=["needs_ocr"],
                confidence=0.0,
            )
        ],
        coverage=coverage,
    )
    return ParseResult(
        blocks=[
            ParsedBlock(
                sequence=0,
                kind="paragraph",
                text=placeholder,
                page_number=1,
                locator={"block_id": block_id, "ocr_required": True},
                quality_flags=("needs_ocr",),
                confidence=0.0,
            )
        ],
        needs_ocr=True,
        coverage=coverage.__dict__,
        document_ir=ir,
    )


def parse_file(
    filename: str,
    content: bytes,
    *,
    document_id: str | None = None,
    file_hash: str | None = None,
) -> ParseResult:
    extension = Path(filename).suffix.lower()
    doc_id = document_id or str(uuid4())
    digest = file_hash or hashlib.sha256(content).hexdigest()
    kwargs = {"document_id": doc_id, "file_hash": digest, "filename": filename}

    if extension == ".docx":
        return parse_docx(content, **kwargs)
    if extension == ".doc":
        converted, error = _try_convert_doc_to_docx(content, filename)
        if converted is None:
            coverage = ReadCoverage(
                needs_ocr=False,
                incomplete=True,
                unsupported_reason=error or "doc_unsupported",
                conversion_notes=[error or "doc_unsupported"],
            )
            return ParseResult(
                blocks=[],
                needs_ocr=False,
                coverage=coverage.__dict__,
                document_ir=DocumentIR(
                    document_id=doc_id,
                    document_version="v1",
                    file_hash=digest,
                    original_filename=filename,
                    format="doc",
                    converter_version=None,
                    coverage=coverage,
                ),
            )
        result = parse_docx(converted, document_id=doc_id, file_hash=digest, filename=filename)
        if result.document_ir:
            result.document_ir.format = "doc"
            result.document_ir.converter_version = "libreoffice-docx"
            result.document_ir.coverage.conversion_notes.append("converted_from_doc")
        return result
    if extension == ".pdf":
        return parse_pdf(content, **kwargs)
    if extension == ".xlsx":
        return parse_xlsx(content, **kwargs)
    if extension in {".png", ".jpg", ".jpeg"}:
        return parse_image(content, **kwargs)
    raise ValueError(f"Unsupported parser extension: {extension}")
