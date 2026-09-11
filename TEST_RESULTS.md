# 测试结果

## 记录规则

本文件只记录实际执行结果。失败后修复并重跑时，同时保留失败原因与最终重跑结论；未执行的项目不计为通过。

## 2026-09-10 待编制文件误识别与按文件动态字段采集

分支：`fix/pending-doc-misidentify-and-scoped-fields`。对照：`artifacts/pending-doc-misidentify-before-after.md`。

| 检查 | 本次实际结果 |
|---|---|
| 规则通道 / 融合 / ensure-default / 作用域抽取单测 | **52 passed**（含 `test_rule_channel_package_id`、`test_ensure_default_grouping_unit`、`test_field_extraction_scoped`、`test_dual_channel_parse`、`test_applicable_gates_and_heal`） |
| 前端 Vitest（`tenderWorkflow` + `StagePage`） | **40 passed** |
| TypeScript `tsc --noEmit` | 通过 |
| OpenAPI 导出 + `pnpm run generate:api` | 已更新 `docs/openapi.json` / `src/api/schema.d.ts`（含 `setup_incomplete`、`EnsureDefaultGroupingRequest`） |
| 完整 `make verify` / 全量 E2E / Golden Case | **本次未作为本专项收口重跑**；不以未执行为通过 |
| 原审查实体「北京地铁…标准可研…」DOCX | **仓库未找到该文件**；用等价合成样本与负例断言复现 |

## 2026-09-09 进度反馈与小章节交互增量验收

最终在隔离验收容器执行字面量 `make verify`，退出码 **0**，末尾输出 `Delivery gate passed`。完整日志：`artifacts/chapter-selection-delivery-verify.log`。

| 检查 | 本次实际结果 |
|---|---|
| 前端格式、TypeScript、生产构建 | 全部通过 |
| 前端 Vitest 4.1.11 | 9 个测试文件、38/38 通过 |
| 后端 Ruff、mypy | 全部通过；mypy 检查 32 个源文件 |
| 后端 pytest | 88/88 通过，覆盖率 85.18%，门槛 70% |
| 空库迁移、OpenAPI、备份恢复 | 12 个迁移生成 61 张表；接口契约与备份恢复检查通过 |
| 浏览器 E2E | 6/6 通过，耗时 1.9 分钟 |
| Golden Case | 313/313 检查通过 |
| 源码与文档密钥扫描 | 186 个文件通过 |
| Python / Node 依赖审计 | 已知漏洞 0；本地项目自身不在 PyPI，由源码扫描与测试覆盖 |

本次专项证据：

- 目录每个层级均可选择；父章批选后可排除子章。前端发送最终勾选集合及 `include_descendants=false`，后端测试确认选叶子章不会扩成整章，重新生成也保留未选正文。
- 浏览器实际只生成一个叶子章，并检查服务端版本中只有该章有正文；点击相邻章节只切换预览，不改变生成范围。
- 生成前、切换至尚未生成的另一份招标文件以及进入未生成合同的确认页均不显示正文编辑器。截图：`artifacts/qa/ui/chapter-selection.png`、`artifacts/qa/ui/ungenerated-confirmation.png`。
- 实际用户页面已检查浅灰行选中、无蓝色边框卡片、每小节复选框与右侧固定正文预览；没有为界面验收重新生成或改写该项目正文。
- 进度组件测试覆盖真实完成数量、没有可量化进度时的当前步骤、新分析不沿用旧完成状态，以及批量部分失败时保留成功计数和重试说明。

失败与恢复记录：

- 首轮完整门禁在依赖审计发现 `js-yaml 4.3.1` 高危漏洞及 Vitest 3.2.7 相关中危漏洞；已锁定 `js-yaml 4.3.2` 并升级到 Vitest 4.1.11。失败日志保留于 `artifacts/chapter-selection-verify.log`，最终依赖审计通过。
- 中间一轮浏览器检查仍要求显示可研模板与空分类，和当前仅展示招标/合同、隐藏空分类的页面规则不一致。已按实际模板数据断言分类可见性并校验隐藏阶段，未回退现有页面规则。该轮日志为 `artifacts/chapter-selection-verify-final.log`。
- 定向复测发现运行页面仍使用旧删除弹窗，和工作区已有新版确认弹窗不一致；保留错误快照 `artifacts/route-responsive-stale-build.md`。同步最终构建后，定向复测 1/1 通过（`artifacts/chapter-selection-route-recheck.log`），完整 E2E 6/6 通过。
- 同步构建时 Docker 镜像代理两次返回 EOF。采用当前验收容器已成功构建的静态产物，在本机已有 Web 镜像上离线封装并部署，未改网络配置；产物与封装说明位于 `artifacts/ui-build-chapters-20260909/`。最终浏览器验收使用这一构建，服务健康。
- 生产构建保留已有的单包大于 500 kB 提示，不影响上述检查。以下逐页 Office 视觉证据保留为 2026-09-08 的历史记录，不冒充本次重新逐页验收。

## 2026-09-08 交付基线（历史记录）

| 检查 | 实际结果 |
|---|---|
| 后端 pytest | 77/77 通过，语句覆盖率 85.00%，覆盖率门槛 70% |
| 采购方案专项 pytest | 16/16 通过；覆盖 15 类业务场景，并实际生成、打开和提取 DOCX/PDF |
| 前端 Vitest | 24/24 通过；其中招标流程与采购方案页面均有专项覆盖 |
| 后端 Ruff | 通过 |
| 后端 mypy | 通过 |
| 前端格式与静态检查 | 通过 |
| 前端 TypeScript | 通过 |
| 前端生产构建 | 通过 |
| Alembic 空库迁移 | 12 个迁移顺序完成，检查到 61 张表 |
| OpenAPI 契约 | 生成文件与当前应用 schema 一致 |
| Python 依赖审计 | `pip-audit` 未发现已知漏洞 |
| Node 依赖审计 | `pnpm audit --audit-level high` 未发现已知漏洞 |
| 源码密钥扫描 | 源码、配置和文档扫描通过，无密钥命中 |
| 浏览器 E2E | 6/6 通过；设备采购用例断言六章、多段正文、评分表、同源 PDF 预览、定稿和 DOCX/PDF 下载，并覆盖错误态、revision 冲突、路由刷新与三种桌面宽度 |
| 模板反向提取专项 | 3/3 通过；含 DOCX 结构解析、候选审核确认、成品值清除、外部处理授权阻断和 DeepSeek JSON Object 兼容 |
| Golden Case 自动验证 | 313/313 检查通过 |
| 招标 DOCX/PDF 逐页一致性 | 同一 LibreOffice 24.2 运行时各渲染 27 页 PNG；27/27 页面哈希一致，差异 0 |
| 内置模板 DOCX 视觉检查 | 13 份、26 页全部渲染查看；分类、来源声明、占位字段、页眉页脚清晰，无裁切、乱码或重叠 |
| DOCX 视觉检查 | 5 份、26 页全部渲染查看；未见裁切、乱码、重叠或空白异常 |
| PDF 结构与视觉检查 | 4 份、18 页；均为 A4、未加密、PDF 1.7，文本可提取，逐页查看无异常 |
| XLSX 结构与视觉检查 | 2 个工作表、2 个表格、27 条字段追溯记录，公式错误 0；付款合计 100% / 9,260,000 元，无截断 |
| Docker 运行状态 | PostgreSQL、Redis、MinIO、API、worker、web 全部 healthy |
| 容器身份 | API 与 worker 均为 `uid=999(docchain)` |
| HTTP 鉴权 smoke | 登录 200、当前用户 200、项目列表 200、登出 204 |

## 统一验收

- 2026-09-08 最终在隔离验收容器中执行字面量 `make verify`，依次完成环境检查、OpenAPI 类型生成、前后端静态检查、77 个后端测试、24 个前端测试、生产构建、12 个迁移、OpenAPI 契约、备份恢复、6 个浏览器 E2E、313 项 Golden Case、安全审计和最终交付件门禁，退出码为 0，最后输出 `Delivery gate passed`。
- 首轮增量门禁在 mypy 发现采购字段快照和并行分析变量的 4 个类型错误；修复后通过。第二轮在断点续跑用例发现模型 Provider 测试隔离不足，补齐构造器隔离后定向复测通过；第三轮完整 `make verify` 无失败完成。
- 实际浏览器检查项目 `BTA-UI-1788868144555`：模板为“设备采购招标文件平台参考模板”，类别为“设备采购”，正文六章、50 余个小节，生成状态显示 V1/R140 和最后生成时间；页面正文未发现“。。”或错误截止时间拼接。
- Golden 招标 DOCX/PDF 最新生成时间为 2026-09-08 20:28，DOCX 60,532 字节、PDF 468,786 字节；同运行时均渲染为 27 页，逐页 PNG 哈希完全一致。
- 新增采购方案 E2E 使用合成可研全文，实际完成来源上传与解析、来源锁定、采购分析、2 个采购包映射到 2 份独立主招标文件、方案确认和批量生成；检查的是数据库返回的数量、名称和归属，不以按钮存在或 HTTP 200 作为唯一通过依据。
- 采购方案专项测试覆盖：三个独立任务、单文件三包、软硬件整体交付、混合分组、只有总投资、既有资产/复用/远期规划、来源冲突、重要页面不可解析、非招标方式、合并拆分与保存、版本变化与幂等/失败重试、模板与预算阻断、多标包合同选择、权限隔离和旧入口兼容。
- 最终 E2E 前发现表格 JSON 的二维数组字符串被 `[[变量]]` 规则误判，以及合同缺失说明错误检查上游阶段字段；已改为只扫描实际文本单元格并限定合同字段集合，分别补充回归测试。重建容器后两条旧定稿链路和完整 6 条 E2E 均通过。
- Python 与 Node 依赖审计均为已知漏洞 0；源码和文档密钥扫描覆盖 175 个文件并通过。生产构建仅保留 Vite 的单包体积提示，不影响本次功能正确性。

- 首次执行 `docker compose --profile verify build verify` 失败：Docker 构建上下文读取本机 `.audit-cache/pip` 时遇到 Windows `Access is denied`；已将纯缓存目录加入 `.dockerignore`，随后重建。
- 第二次构建继续发现 `.pytest_cache` 的同类本机权限问题；已一次性排除 pytest、mypy、Ruff、coverage、临时目录和 TypeScript 构建缓存。
- 第三次构建在 Playwright 基础镜像下载至末段后收到 BuildKit `rpc error: Unavailable ... EOF`，随后 Docker Desktop 报告引擎无法启动；此项按基础设施中断处理，重启引擎后续建。
- Docker 日志确认 C 盘为 0 字节且容器运行时曾发生 SIGBUS；经用户授权仅清理 Docker 日志/WSL 崩溃转储 79,967,075 字节，以及可重建的 npm/pip 下载缓存 1,754,718,070 字节。Docker VHDX、卷、数据库、Codex 会话和项目交付物均未删除。
- WSL 全局关闭并重新挂载后 Docker Engine 29.4.2 恢复，六个项目服务仍全部 healthy；经用户授权又回收 8.506 GB BuildKit 缓存。随后验收镜像基础层下载成功，但 Ubuntu HTTP 软件源返回 502 且 90 秒无进展，构建被中止并将系统源切换为 HTTPS。
- 首轮完整门禁暴露验证容器数据目录缺失和 ReportLab 中文字体问题；已创建数据目录，并改为使用 LibreOffice 将生成的 DOCX 转换为 PDF。
- 四阶段 E2E 暴露模板重复初始化后的摘要漂移，以及页面过早判断待审阅块的问题；已改为以对象存储真实内容计算摘要，并等待文档加载后逐块确认。
- Golden Case 曾引用已移除的旧字体函数；已统一复用正式 DOCX→PDF 转换服务，定向复测 149 项通过。
- 模板分类上线后，Golden Case 首轮误选“国家正式文本”并触发无 DOCX 源阻断；随后又因选中“依据正式大纲适配”而与平台基准章节不一致。已将 Golden Case 明确限定为已发布、可生成的“平台参考模板”，完整重跑 149 项通过。
- 安全扫描发现基础 Playwright 镜像自带 `pip 24.0` 的已知漏洞；验证镜像已固定升级为官方 `pip 26.2.1`，重跑后 Python 与 Node 依赖均未发现已知漏洞。
- 模板反向提取专项使用确定性 Provider 验证全流程，并使用不含项目数据的探针验证 DeepSeek 模型列表、JSON Object 响应以及平台 Provider 的 Pydantic 校验；未向模型发送客户文件。
- 项目状态中文化后，首轮 E2E 仍按旧英文 `parsed`、`succeeded`、`finalized` 查找页面文本；删除用例又因历史巡检项目同名而使用了非唯一定位。已改为中文显示值和唯一项目编号，定向复测通过。
- 2026-09-07 的上一版验收也曾在验证容器完整运行字面量 `make verify` 并通过；本表顶部及新增说明以 2026-09-08 本次增量改造后的最新结果为准。
