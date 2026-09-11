# 文件上传与解析

支持 DOC、DOCX、PDF、XLSX、PNG、JPG/JPEG。API 同时检查扩展名、声明 MIME、文件头、大小和组织/项目权限，计算 SHA-256 后写入版本化对象存储。病毒扫描保留明确扩展接口；未配置扫描器时不得宣称已完成杀毒。

DOCX 按文档顺序读取标题、段落与表格（含合并单元格矩阵）；PDF 按页评估文字质量并标记需 OCR 页；XLSX 保留工作表和单元格表格。解析结果写入 DocumentIR（见 `parsed_documents.metadata_json.document_ir`），并保留原文片段、章节路径、页码/结构定位。无可提取文本的 PDF/图片标为 `needs_ocr`，不会假装成功。旧版 `.doc` 经 LibreOffice 受控转换为 DOCX；转换失败返回明确错误。

对外部可研，结构解析完成后由采购分析任务启动**规则通道与 AI 通道并行**，再融合落库。详见 [DUAL_CHANNEL_PARSE.md](./DUAL_CHANNEL_PARSE.md)。

解析作业具有状态、错误、重试和结果查询端点。文件新版本保留旧版本和 SHA-256，不覆盖历史对象。
