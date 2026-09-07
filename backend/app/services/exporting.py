from __future__ import annotations

import hashlib
import io
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from docx import Document as WordDocument
from docx.document import Document as DocxDocument
from docx.enum.section import WD_SECTION
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    Document,
    DocumentContentBlock,
    DocumentSection,
    DocumentVersion,
    FieldValue,
    TemplateVersion,
)
from .storage import get_storage


def _content_text(block: DocumentContentBlock) -> str:
    if isinstance(block.content, dict):
        return str(block.content.get("text", ""))
    return str(block.content)


def load_export_data(
    db: Session, version: DocumentVersion
) -> tuple[Document, list[tuple[DocumentSection, list[DocumentContentBlock]]], list[FieldValue]]:
    document = db.get(Document, version.document_id)
    if document is None:
        raise ValueError("Document not found")
    sections = list(
        db.scalars(
            select(DocumentSection)
            .where(DocumentSection.document_version_id == version.id)
            .order_by(DocumentSection.sequence)
        )
    )
    grouped = []
    for section in sections:
        blocks = list(
            db.scalars(
                select(DocumentContentBlock)
                .where(DocumentContentBlock.document_section_id == section.id)
                .order_by(DocumentContentBlock.sequence)
            )
        )
        grouped.append((section, blocks))
    fields = list(
        db.scalars(
            select(FieldValue)
            .where(
                FieldValue.project_id == document.project_id,
                FieldValue.stage == document.stage,
                FieldValue.is_current.is_(True),
            )
            .order_by(FieldValue.criticality, FieldValue.field_key)
        )
    )
    return document, grouped, fields


def _set_cell_shading(cell: Any, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shade = OxmlElement("w:shd")
    shade.set(qn("w:fill"), fill)
    tc_pr.append(shade)


def _set_cell_margins(cell: Any, value: int = 100) -> None:
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for margin in ("top", "start", "bottom", "end"):
        node = tc_mar.find(qn(f"w:{margin}"))
        if node is None:
            node = OxmlElement(f"w:{margin}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def _add_page_field(paragraph: Any) -> None:
    paragraph.add_run("第 ")
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instruction = OxmlElement("w:instrText")
    instruction.set(qn("xml:space"), "preserve")
    instruction.text = " PAGE "
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.extend([begin, instruction, separate, end])
    paragraph.add_run(" 页")


def _load_template_document(db: Session, version: DocumentVersion) -> DocxDocument:
    template_id = version.provenance.get("template_id")
    template_version_number = version.provenance.get("template_version")
    if not isinstance(template_id, str) or not isinstance(template_version_number, int):
        raise RuntimeError("文档版本未锁定模板版本，不能导出 DOCX")
    template_version = db.scalar(
        select(TemplateVersion).where(
            TemplateVersion.template_id == template_id,
            TemplateVersion.version == template_version_number,
        )
    )
    if template_version is None or not template_version.storage_key:
        raise RuntimeError("锁定的 DOCX 模板源不存在，不能导出")
    content = get_storage().get(template_version.storage_key)
    return WordDocument(io.BytesIO(content))


def _replace_template_tokens(doc: DocxDocument, *, title: str, version: int) -> None:
    replacements = {
        "{{DOCUMENT_TITLE}}": title,
        "{{DOCUMENT_VERSION}}": str(version),
        "{{DOCUMENT_BODY}}": "",
    }
    for paragraph in doc.paragraphs:
        for token, value in replacements.items():
            if token in paragraph.text:
                for run in paragraph.runs:
                    if token in run.text:
                        run.text = run.text.replace(token, value)
                if token in paragraph.text:
                    paragraph.text = paragraph.text.replace(token, value)


def export_docx(db: Session, version: DocumentVersion) -> bytes:
    document, sections, fields = load_export_data(db, version)
    output = io.BytesIO()
    doc = _load_template_document(db, version)
    _replace_template_tokens(doc, title=document.title, version=version.version)

    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "SimSun"
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")
    normal.font.size = Pt(11)
    normal.paragraph_format.line_spacing = 1.5
    normal.paragraph_format.space_after = Pt(6)
    for style_name, size in (("Title", 22), ("Heading 1", 16), ("Heading 2", 14)):
        style = styles[style_name]
        style.font.name = "SimHei"
        style._element.rPr.rFonts.set(qn("w:eastAsia"), "黑体")
        style.font.size = Pt(size)
        style.font.color.rgb = RGBColor(0, 0, 0)

    for item, blocks in sections:
        doc.add_heading(item.title, level=1)
        for block in blocks:
            paragraph = doc.add_paragraph(_content_text(block))
            paragraph.paragraph_format.first_line_indent = Cm(0.74)

    doc.add_section(WD_SECTION.NEW_PAGE)
    doc.add_heading("字段来源清单", level=1)
    table = doc.add_table(rows=1, cols=5)
    table.autofit = False
    widths = (Cm(3.1), Cm(5.2), Cm(2.2), Cm(2.7), Cm(3.4))
    headers = ("字段键", "字段名称", "级别", "状态", "值")
    for index, (cell, header) in enumerate(zip(table.rows[0].cells, headers, strict=True)):
        cell.width = widths[index]
        cell.text = header
        _set_cell_shading(cell, "1F4E78")
        _set_cell_margins(cell)
        for run in cell.paragraphs[0].runs:
            run.font.color.rgb = RGBColor(255, 255, 255)
            run.font.bold = True
    for field in fields:
        row = table.add_row().cells
        values = (
            field.field_key,
            field.field_label,
            field.criticality,
            field.status,
            str(field.normalized_value if field.normalized_value is not None else field.value),
        )
        for index, (cell, value) in enumerate(zip(row, values, strict=True)):
            cell.width = widths[index]
            cell.text = value
            _set_cell_margins(cell)
            cell.vertical_alignment = 1
            if index in (2, 3):
                cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

    for output_section in doc.sections:
        footer = output_section.footer.paragraphs[0]
        footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
        footer.clear()
        footer.add_run("项目文件链式生成平台 · ")
        _add_page_field(footer)
    doc.core_properties.title = document.title
    doc.core_properties.subject = "项目文件链式生成平台正式输出"
    doc.core_properties.keywords = f"document-version:{version.id}"
    doc.save(output)
    return output.getvalue()


def convert_docx_to_pdf(docx_content: bytes) -> bytes:
    office_executable = shutil.which("soffice") or shutil.which("libreoffice")
    if office_executable is None:
        raise RuntimeError("未安装 LibreOffice，无法将 DOCX 转换为 PDF")

    with tempfile.TemporaryDirectory(prefix="docchain-pdf-") as temporary_directory:
        output_directory = Path(temporary_directory)
        docx_path = output_directory / "document.docx"
        pdf_path = output_directory / "document.pdf"
        profile_path = output_directory / "libreoffice-profile"
        docx_path.write_bytes(docx_content)
        completed = subprocess.run(  # noqa: S603 - executable is resolved from the deployment PATH
            [
                office_executable,
                "--headless",
                f"-env:UserInstallation={profile_path.resolve().as_uri()}",
                "--convert-to",
                "pdf:writer_pdf_Export",
                "--outdir",
                str(output_directory),
                str(docx_path),
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if completed.returncode != 0 or not pdf_path.is_file() or pdf_path.stat().st_size == 0:
            detail = (completed.stderr or completed.stdout or "未生成 PDF 文件").strip()
            raise RuntimeError(f"LibreOffice PDF 转换失败：{detail[:500]}")
        return pdf_path.read_bytes()


def export_pdf(db: Session, version: DocumentVersion) -> bytes:
    return convert_docx_to_pdf(export_docx(db, version))


def export_xlsx(db: Session, version: DocumentVersion) -> bytes:
    _document, sections, fields = load_export_data(db, version)
    workbook = Workbook()
    summary = workbook.active
    summary.title = "文档结构"
    summary.sheet_view.showGridLines = False
    summary.append(["章节序号", "章节名称", "内容块序号", "内容", "来源类型", "已审阅"])
    for section, blocks in sections:
        for block in blocks:
            summary.append(
                [
                    section.sequence,
                    section.title,
                    block.sequence,
                    _content_text(block),
                    block.source_kind,
                    "是" if block.reviewed else "否",
                ]
            )
    fields_sheet = workbook.create_sheet("字段来源")
    fields_sheet.sheet_view.showGridLines = False
    fields_sheet.append(["字段键", "字段名称", "数据类型", "值", "单位", "级别", "状态", "来源类型"])
    for field in fields:
        fields_sheet.append(
            [
                field.field_key,
                field.field_label,
                field.data_type,
                str(field.normalized_value if field.normalized_value is not None else field.value),
                field.unit or "",
                field.criticality,
                field.status,
                field.source_type,
            ]
        )
    for sheet in workbook.worksheets:
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        for cell in sheet[1]:
            cell.fill = PatternFill("solid", fgColor="1F4E78")
            cell.font = Font(name="Microsoft YaHei", color="FFFFFF", bold=True)
            cell.alignment = Alignment(horizontal="center", vertical="center")
        border = Border(bottom=Side(style="thin", color="D9D9D9"))
        for row in sheet.iter_rows():
            for cell in row:
                cell.font = Font(name="Microsoft YaHei", size=10, bold=cell.row == 1, color=cell.font.color)
                cell.alignment = Alignment(
                    vertical="top",
                    wrap_text=True,
                    horizontal="center" if cell.column <= 3 else "left",
                )
                cell.border = border
        widths = [14, 24, 14, 56, 16, 12, 18, 20]
        for index, width in enumerate(widths[: sheet.max_column], 1):
            sheet.column_dimensions[chr(64 + index)].width = width
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


def export_version(db: Session, version: DocumentVersion, output_format: str) -> bytes:
    if output_format == "docx":
        return export_docx(db, version)
    if output_format == "pdf":
        return export_pdf(db, version)
    if output_format == "xlsx":
        return export_xlsx(db, version)
    raise ValueError(f"Unsupported export format: {output_format}")


def export_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()
