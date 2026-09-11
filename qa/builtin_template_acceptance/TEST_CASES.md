# 内置模板专项验收用例

| 编号 | 类别 | 用例 | 预期 |
|---|---|---|---|
| BTA-INV-001 | 模板盘点 | API、DB、对象存储三方核对内置模板 | 元数据、版本、SHA、章节、变量和正式源一致 |
| BTA-TPL-001 | 模板用途 | 国家正式文本索引用于新生成 | 422，`template_not_applicable` |
| BTA-TPL-002 | 最小生成 | 所有可生成内置模板逐一生成并导出 DOCX | 任务、步骤、事件、文档版本、导出均成功 |
| BTA-POS-001 | 项目建议书 | 固定项目数据生成、审阅、校验、定稿、DOCX/PDF | 全链路成功，来源与模板锁定可追溯 |
| BTA-POS-002 | 可研报告 | 以上游定稿为来源，使用 2023 大纲适配模板 | 全链路成功，总投资为 12,800,000 元 |
| BTA-POS-003 | 招标文件 | 以上游定稿为来源，使用设备采购适配模板 | 全链路成功，预算/最高限价/120 日分别保持独立 |
| BTA-POS-004 | 合同草稿 | 关键签约字段未补齐时导出签署前草稿 | 可导出草稿，但定稿被 P0 门禁阻断 |
| BTA-POS-005 | 合同待签署版 | 补齐双方、价税、110 日、付款和质保后重新生成 | 校验、定稿、DOCX/PDF 全部成功 |
| BTA-MAP-001 | 禁止映射 | 可研总投资直接映射为招标预算 | 422，`forbidden_field_mapping` |
| BTA-MAP-002 | 禁止映射 | 可研总投资直接映射为合同金额 | 422，`forbidden_field_mapping` |
| BTA-MAP-003 | 禁止映射 | 招标最高限价直接映射为合同金额 | 422，`forbidden_field_mapping` |
| BTA-MAP-004 | 禁止映射 | 项目周期直接映射为合同履行期限 | 422，`forbidden_field_mapping` |
| BTA-MAP-005 | 禁止映射 | 项目全部范围直接映射为采购/合同范围 | 422，`forbidden_field_mapping` |
| BTA-NEG-001 | P0 | 缺少必需 P0 字段定稿 | 422，`finalization_blocked` |
| BTA-NEG-002 | P0 | 招标预算为 `ai_suggested` | 422，`finalization_blocked` |
| BTA-NEG-003 | P0 | P0 字段为 `conflict` | 422，`finalization_blocked` |
| BTA-NEG-004 | 合同 | 最终合同金额为空 | 422，`finalization_blocked` |
| BTA-NEG-005 | 合同 | 付款比例合计 95% | 校验产生 `contract_payment_consistency` |
| BTA-NEG-006 | 合同 | 付款金额不等于合同金额 | 校验产生 `contract_payment_consistency` |
| BTA-NEG-007 | 内容 | 文档存在 `TBD`、`XXX` 或“待填写” | 校验产生 `unresolved_placeholder` |
| BTA-NEG-008 | 模板 | 过期模板用于新任务 | 422，`template_not_applicable` |
| BTA-NEG-009 | 固定条款 | 项目编制人员编辑 `fixed_template` 内容块 | 403，`fixed_template_block_forbidden` |
| BTA-NEG-010 | 血缘 | 上游新定稿后检查下游状态 | 下游标为 `stale` 且保留原版本，不静默覆盖 |
| BTA-NEG-011 | 不可变 | 保存已定稿内容块 | 409，`immutable_version` |
| BTA-NEG-012 | 权限 | 只读用户确认字段、定稿、导出 | 均为 403，且无越权状态写入 |
| BTA-INT-001 | DOCX | OOXML、关系、样式、正文、页眉页脚、LibreOffice | 全部可解析，无损坏包或残留占位符 |
| BTA-INT-002 | PDF | MIME、页数、A4、文本、空白页、裁切、PNG 渲染 | 全部通过；关键页截图可人工查看 |
| BTA-TRC-001 | 追溯 | 字段、证据、确认、快照、模板、文档、任务、导出 | XLSX 与 JSON 血缘可回查数据库 |
| BTA-E2E-001 | 浏览器 | 登录、模板页、固定验收项目、四阶段状态及文件访问 | Playwright 通过并保存截图/日志 |

每个 API 负向用例均记录请求摘要、HTTP 状态、业务错误码、页面可显示中文提示、请求 ID、审计记录和数据库最终状态。关键失败任一出现即专项命令非零退出。
