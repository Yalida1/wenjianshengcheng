# 内置模板文档生成专项验收报告

## 一、验收结论

**通过**。

本结论基于隔离环境内的真实 API、PostgreSQL、Redis/Celery、S3、模板引擎和 LibreOffice 导出链路。AI 内容生成使用 Demo/Test Provider；交付负责人已在当前会话人工复核 14 张关键页截图，未见截断、重叠、乱码、不可读表格或原始 JSON 泄漏。

专项验收命令和仓库总门禁 `make verify` 最终退出码均为 0。总门禁结果为：前端单测 10 项、后端测试 40 项（覆盖率 83.06%）、浏览器 E2E 5 项、Golden Case 156 项全部通过；密钥扫描和 Python/前端依赖漏洞审计未发现已知问题。

## 二、测试环境

- 操作系统：Linux-6.6.87.2-microsoft-standard-WSL2-x86_64-with-glibc2.39
- Docker：29.4.2（宿主机；verify 容器未挂载 Docker CLI）
- Node：v22.19.0
- Python：Python 3.12.3
- PostgreSQL：PostgreSQL 16.4
- Redis：redis-server 7.4.11
- LibreOffice：LibreOffice 24.2.7.2 420(Build:2)
- AI Provider：demo
- 是否使用 Test/Demo Provider：是
- 执行时间：2026-09-07T10:17:18.856686+00:00
- 隔离数据库：postgres:5432/builtin_template_acceptance
- Redis 命名空间：11
- S3 桶：project-documents-builtin-template-acceptance

## 三、内置模板清单

|名称|类型|版本|状态|Format Profile|渲染结果|格式结果|最终结论|
|---|---|---:|---|---|---|---|---|
|一般投资项目可行性研究报告参考模板|平台参考模板|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|通过|通过|通过|
|企业投资项目可研报告适配模板（2023年大纲）|依据正式大纲适配|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|通过|通过|通过|
|企业投资项目可行性研究报告编写参考大纲（2023年版）|国家正式文本|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|仅来源索引|通过|不适用于新生成|
|勘察招标文件适配模板（2017年版）|依据正式大纲适配|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|通过|通过|通过|
|建设工程施工合同填报模板（GF-2017-0201适配）|依据正式大纲适配|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|通过|通过|通过|
|建设工程施工合同（示范文本）GF-2017-0201|国家正式文本|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|仅来源索引|通过|不适用于新生成|
|政府投资项目可研报告适配模板（2023年大纲）|依据正式大纲适配|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|通过|通过|通过|
|政府投资项目可行性研究报告编写通用大纲（2023年版）|国家正式文本|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|仅来源索引|通过|不适用于新生成|
|政府投资项目建议书通用参考模板|平台参考模板|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|通过|通过|通过|
|政府采购货物买卖合同填报模板（2024年试行文本适配）|依据正式大纲适配|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|通过|通过|通过|
|政府采购货物买卖合同（试行）|国家正式文本|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|仅来源索引|通过|不适用于新生成|
|材料采购招标文件适配模板（2017年版）|依据正式大纲适配|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|通过|通过|通过|
|标准勘察招标文件（2017年版）|国家正式文本|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|仅来源索引|通过|不适用于新生成|
|标准材料采购招标文件（2017年版）|国家正式文本|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|仅来源索引|通过|不适用于新生成|
|标准监理招标文件（2017年版）|国家正式文本|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|仅来源索引|通过|不适用于新生成|
|标准设备采购招标文件（2017年版）|国家正式文本|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|仅来源索引|通过|不适用于新生成|
|标准设计招标文件（2017年版）|国家正式文本|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|仅来源索引|通过|不适用于新生成|
|监理招标文件适配模板（2017年版）|依据正式大纲适配|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|通过|通过|通过|
|设备采购招标文件适配模板（2017年版）|依据正式大纲适配|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|通过|通过|通过|
|设计招标文件适配模板（2017年版）|依据正式大纲适配|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|通过|通过|通过|
|通用采购合同参考模板|平台参考模板|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|通过|通过|通过|
|通用采购招标文件参考模板|平台参考模板|V1|published|{"standard": "demo_enterprise_report_cn", "page_size": "A4", "cjk_font": "Noto Sans CJK SC or customer-authorized font", "strict_compliance": false}|通过|通过|通过|

## 四、生成文件清单

|路径|类型|大小（字节）|页数|SHA256|模板版本|来源版本|结论|
|---|---|---:|---:|---|---|---|---|
|artifacts/builtin_template_acceptance/requirement/项目建议书_V1.0.docx|docx|39887|-|`f8f20eaec24ec0f05ef3c58056a4da4998f897f19b99de42d2e40e8f7c93c281`|V1|2de3e28a-26f8-4ee4-86c6-2a86f8ee2a5b|通过|
|artifacts/builtin_template_acceptance/requirement/项目建议书_V1.0.pdf|pdf|134046|5|`9db21a483742d0a6031e50458944b4b324d2aae83272d9d187d79fe997dc3ab6`|V1|2de3e28a-26f8-4ee4-86c6-2a86f8ee2a5b|通过|
|artifacts/builtin_template_acceptance/feasibility/可行性研究报告_V1.0.docx|docx|40911|-|`f45162f91332008e1586e89554034f5de6803b97e3f04d4ece980afe4493b803`|V1|b8aff356-9fab-4971-a089-4ca1d8c68deb|通过|
|artifacts/builtin_template_acceptance/feasibility/可行性研究报告_V1.0.pdf|pdf|269394|17|`2c4a87bbe3f63b100aa8ea2d8985a16b9bb22ffa1a2b17175ec9b4ccb498031b`|V1|b8aff356-9fab-4971-a089-4ca1d8c68deb|通过|
|artifacts/builtin_template_acceptance/tender/招标文件_V1.0.docx|docx|41369|-|`d4941efac4acc0b6c05aa257e0bc87fb7b560def5e3da2ca88231dd7feb9bef0`|V1|0fa207e1-4ba3-4d00-94ef-74db62e9a3d8|通过|
|artifacts/builtin_template_acceptance/tender/招标文件_V1.0.pdf|pdf|199786|5|`d9dbd952f0644282d54af05ee0dc202041cf3ff928dbf159b769ef46369caa71`|V1|0fa207e1-4ba3-4d00-94ef-74db62e9a3d8|通过|
|artifacts/builtin_template_acceptance/contract/合同签署前预草案_V0.9.docx|docx|40354|-|`2605bb8ba7880c83043a5b8f1c0f2efc90e8cd2cb3607c8d0fe18dbc1b3f0124`|V1|241d89f0-4570-4e11-8a12-2ea4b99270dc|通过|
|artifacts/builtin_template_acceptance/contract/合同签约准备版_V1.0.docx|docx|40771|-|`8bb38445271e715b76a761d6a219d34f9961437017865e6cbe2b8e88298e17be`|V1|241d89f0-4570-4e11-8a12-2ea4b99270dc|通过|
|artifacts/builtin_template_acceptance/contract/合同签约准备版_V1.0.pdf|pdf|182105|6|`d0a003df036223bb6d4a2ae7a410b16c05d4359879f4f36e37277fdf859971e2`|V1|241d89f0-4570-4e11-8a12-2ea4b99270dc|通过|

## 五、字段准确性

- 项目总投资：12,800,000 元；招标预算：9,800,000 元；最高限价：9,500,000 元；最终合同金额：9,180,000 元，四者分别锁定。
- 项目总周期：12 个月；招标交付周期：120 日历天；合同履行期限：110 日历天，三者分别锁定。
- 项目全量范围 8 项；采购及合同范围 6 项；明确排除基础设施加固、综合布线优化和三年运维服务。
- 付款比例 20%/50%/25%/5%，合计 100%；金额 1,836,000/4,590,000/2,295,000/459,000 元，合计 9,180,000 元。
- P0 字段：26/26 已人工确认；可追溯 26/26；未确认 AI P0 值 0 个。

## 六、格式检查

- 纸张：A4；字体：正文宋体、标题黑体；容器安装 Noto CJK 作为转换字体；字号：正文 11pt、一级标题 16pt、二级标题 14pt、标题 22pt；行距：1.5 倍。
- 标题/编号：Heading 1–3 与模板章节树（DFS）一致；正文段落与章节顺序由模板计划和生成步骤锁定。
- 目录：当前四类内置模板未配置自动目录域；不冒充已验证。
- 页眉页脚/页码：保留模板页眉，统一页脚和 PAGE 域。
- 表格/中文：字段来源清单表格已生成；python-docx 与 PDF 文本提取均验证中文文本非空。
- PDF 共 33 页，A4=True，关键页 PNG 14 张。
- 未替换变量：0。

## 七、业务门禁测试

|用例|HTTP 状态|业务错误码|审计记录|结论|
|---|---|---|---|---|
|BTA-MAP-001|422|forbidden_field_mapping|是|通过|
|BTA-MAP-002|422|forbidden_field_mapping|是|通过|
|BTA-MAP-003|422|forbidden_field_mapping|是|通过|
|BTA-MAP-004|422|forbidden_field_mapping|是|通过|
|BTA-MAP-005|422|forbidden_field_mapping|是|通过|
|BTA-TPL-001|422|template_not_applicable|是|通过|
|BTA-NEG-001|422|finalization_blocked|是|通过|
|BTA-NEG-004|422|finalization_blocked|是|通过|
|BTA-NEG-002|422|finalization_blocked|是|通过|
|BTA-NEG-003|422|finalization_blocked|是|通过|
|BTA-NEG-005|422|finalization_blocked|是|通过|
|BTA-NEG-006|422|finalization_blocked|是|通过|
|BTA-NEG-007|422|finalization_blocked|是|通过|
|BTA-NEG-008|422|template_not_applicable|是|通过|
|BTA-NEG-009|403|fixed_template_block_forbidden|是|通过|
|BTA-NEG-010|200|-|是|通过|
|BTA-NEG-011|409|immutable_version|是|通过|
|BTA-NEG-012|[403, 403, 403]|['forbidden', 'forbidden', 'forbidden']|是|通过|

## 八、API 和路由

- API Smoke：累计 922 个真实 HTTP 请求。
- 未处理 500：0 个。
- 路由 404：由 `routes-responsive.spec.ts` 实际巡检，结果 passed。
- 任务失败和重试：生成、解析和导出状态均记录；本轮未人为制造外部服务中断，重试接口由现有集成测试覆盖，列入未验证边界。
- 导出状态：22 个 DOCX/PDF 导出任务成功。
- 审计日志：成功写操作和拒绝的 4xx 写请求均带 `X-Request-ID` 留痕。

## 九、修复记录

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
| BTA-FIX-015 | 响应式 E2E 仍断言已被正式模板质量门禁文案替换的旧说明 | 当前界面正确但 `make verify` 浏览器门禁失败 | 断言改为当前正式文案“程序解析 + 质量门禁 + 确认发布” | `make test-e2e`、`make verify` |
| BTA-FIX-016 | Golden Case 继承外部数据库配置并硬编码查找组织 | 可能清空调用环境数据库，并误报种子失败 | 强制使用独立 SQLite/本地存储，组织与账号读取配置 | Golden Case 156 项、`make verify` |

上述修复均增强门禁，没有更改固定验收值、绕过平台服务或降低通过标准。


## 十、未验证项

- 已人工复核四类 PDF 的封面、正文/中间页和末页共 14 张关键页截图；全部页面的尺寸、文本和 PNG 渲染另由程序自动检查。未逐页人工审阅全部 33 页正文语义。
- 未注入真实异步服务故障；因此本轮不声称已通过真实故障恢复，只保留已有重试接口与测试证据。
- verify 容器未挂载 Docker CLI；宿主机已补充记录 Docker 29.4.2。
- Demo/Test Provider 证明了 provider 契约和任务链，不证明 DeepSeek 的线上可用性、输出质量或费用。

## 十一、客户验收边界

本轮结论只代表平台内置模板在当前测试数据和当前环境下的技术验收结果。

本轮结果不能自动等同于：客户专有模板验收；行业专家对可研专业结论的确认；采购人员对招标条款的正式审核；法务对合同条款的最终审核；未配置 Format Profile 的国标合规；缺少授权字体情况下的严格字体合规。
