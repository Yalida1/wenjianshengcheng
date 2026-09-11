# 专项验收缺陷修复记录

| 编号 | 发现 | 风险 | 修复 | 回归证据 |
|---|---|---|---|---|
| BTA-FIX-001 | 已发布但已过期/尚未生效的模板仍可创建生成任务 | 使用失效正式源形成新文档 | 生成入口同时校验模板版本状态、生效日和失效日 | `test_expired_template_cannot_start_generation` |
| BTA-FIX-002 | 多个字段、文档和任务写接口只检查项目访问，未校验写权限 | 只读人员可能确认字段、触发生成/校验/重试或导出 | 为字段、来源、生成、内容、校验、修订和导出补齐最小权限 | `test_viewer_cannot_confirm_fields_finalize_or_export` |
| BTA-FIX-003 | 项目编制人员可改写标记为 `fixed_template` 的固定内容块 | 模板固定条款被项目级用户篡改 | 固定模板块仅允许模板管理员修改 | `test_fixed_template_block_and_template_structure_are_enforced` |
| BTA-FIX-004 | 校验未按锁定模板核对必需章节、重复章节和顺序 | 导出文件可能缺章、重章或错序 | 基于锁定模板版本执行章节完整性、唯一性、顺序和空章校验 | `test_fixed_template_block_and_template_structure_are_enforced` |
| BTA-FIX-005 | 常见 `TBD`、`XXX`、`待填写` 未被识别为残留占位符 | 半成品内容可能进入定稿 | 扩展占位符模式并维持 P0 阻断 | `test_common_placeholders_block_finalization` |
| BTA-FIX-006 | 文档血缘缺少格式配置快照 | 难以复核生成时采用的版式规则 | 将模板版本 `format_profile` 写入文档版本 provenance | 专项 `document-lineage.json` |
| BTA-FIX-007 | 校验直接读取当前字段，未核对生成时锁定的字段快照 | 生成后改字段可能让旧正文通过校验 | 当前正式字段快照与文档锁定 SHA 不一致时以 P0 阻断并要求重新生成 | 专项合同草稿到待签署版用例 |
| BTA-FIX-008 | 禁止映射清单未覆盖“招标最高限价→最终合同金额” | 可能把控制价误写成成交合同价 | 在字段写入入口新增该跨阶段禁止映射 | `BTA-MAP-003` |
| BTA-FIX-009 | 过期模板虽被生成入口阻断，仍出现在“可生成模板”列表 | 用户可选中后才看到错误，且 UI 自动选择时主链中断 | `generation_only` 列表同步过滤未生效、已失效和未发布版本 | 专项 UI 主链及过期模板回归测试 |
| BTA-FIX-010 | 上传解析新增的字段候选与专项固定值创建发生 `field_exists` 冲突 | 验收链路无法兼容平台真实的自动字段提取结果 | 按字段键识别已有候选，使用带 revision 的修改接口写入固定人工值后再确认 | 专项四阶段正向链路 |
| BTA-FIX-011 | PDF 截图前缀含 `V1.0-page-*` 时，`Path.with_suffix()` 误把 `.0-page-*` 当作扩展名 | PNG 已实际生成但验收脚本按错误路径判为失败 | 直接在完整输出前缀后追加 `.png`，保留版本号和页码 | `BTA-INT-002`、人工视觉复核 |
| BTA-FIX-012 | PDF 人工目检发现正文金额缺少千分位/单位、税率缺 `%`，字段来源表暴露英文内部键和原始结构化数据且跨页碎行 | 正式文件含义不够明确，合同末页可读性不足 | 金额与税率按业务单位格式化；来源表改为中文字段/状态/来源，结构化付款计划逐条排版，并禁止表格行跨页拆分 | Provider 单测、四类 PDF 重新生成及人工目检 |
| BTA-FIX-013 | 新增的可选地点/交付字段没有默认 E2E 值时，测试驱动仍尝试确认空值 | 浏览器回归被后端正确的 `empty_field` 门禁中止 | E2E 只提交明确提供的字段，并为专项固定数据补齐建设地点、120 日历天交付周期和交付地点 | 专项 UI 四阶段主链 |
| BTA-FIX-014 | 最新迁移直接新增外键，SQLite 迁移烟测不支持 `ALTER TABLE ADD CONSTRAINT` | `make verify` 在迁移门禁中断 | 改用 Alembic 批量表变更，同时兼容 SQLite 烟测和 PostgreSQL 正式环境 | `make migration-check`、`make verify` |
| BTA-FIX-015 | 响应式 E2E 仍断言已被正式模板质量门禁文案替换的旧说明 | 当前界面正确但 `make verify` 浏览器门禁失败 | 断言改为当前正式文案“程序解析 + 质量门禁 + 确认发布” | `e2e/routes-responsive.spec.ts`、`make test-e2e` |
| BTA-FIX-016 | Golden Case 继承外部 `DATABASE_URL` 后会清空调用环境数据库，且组织查询仍使用硬编码名称 | 隔离验收数据被重置，并误报 `Demo seed failed` | Golden Case 强制使用独立 SQLite/本地存储（仅允许专用 `GOLDEN_*` 覆盖），组织与账号统一读取配置 | `make golden-case`、`make verify` |

上述修复均增强门禁，没有更改固定验收值、绕过平台服务或降低通过标准。
