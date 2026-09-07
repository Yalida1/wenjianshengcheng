# 格式与标准

Format Profile 优先级为：客户批准模板 > 行业/主管部门模板 > 特定文种配置 > 平台通用格式。支持 customer_template、enterprise_report_cn、政府/企业可研 2023、official_document_gbt9704_2012、tender_customer_template 和 contract_customer_template 等配置。

GB/T 9704-2012 仅在明确适用党政机关公文时选择，不作为合同或招标文件通用标准。Demo 使用开源 Noto CJK 字体，不能替代客户授权字体验收。

导出检查 A4、页边距、字体、字号、行距、标题、多级编号、页眉页脚、页码、目录、表格宽度与跨页、标题/附件编号、标点、金额格式、占位变量和空章节。严格 Profile 缺字体时必须失败。Golden Case 还用 LibreOffice 实际打开每个 DOCX，并检查 PDF 结构、文字和页面尺寸。
