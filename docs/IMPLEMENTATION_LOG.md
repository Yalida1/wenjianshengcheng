# 实施记录

## 2026-09-06

- 完整阅读 `MASTER_BUILD_PROMPT.md`、仓库说明和用户交付要求。
- 审计现有 Figma React 原型，确认当前为 Hash 页面状态和 MockStore 驱动，尚无后端、数据库、对象存储、异步任务、正式鉴权或自动化测试。
- 建立 Git 原始原型检查点 `7405f53`，便于审计后续变更。
- 确认本机 Node 22、pnpm、Docker CLI 和 Compose 可用；Docker Desktop 引擎尚未启动；本机无 GNU Make。
- 建立分阶段执行计划，开始实现真实后端纵向链路。
- 建立 45 表规范化模型与 3 个 Alembic 迁移；全新 SQLite 数据库升级至 head 通过。
- 实现 HttpOnly 会话、Argon2、五类角色、组织和项目对象级访问控制、revision 冲突与审计。
- 实现文件版本、SHA-256、安全类型校验、DOCX/PDF/XLSX 解析结果、无文本 PDF 的 OCR 待处理状态。
- 实现字段字典、证据、确认、冲突、快照和禁止映射；P0、合同付款比例/金额/触发条件进入确定性门禁。
- 实现 DOCX 模板源上传、预检、不可覆盖版本、章节/变量/Format Profile 和 Demo 模板。
- 实现 Demo/OpenAI-compatible Provider、生成源锁、Celery 分步任务、事件、重试、取消和恢复。
- 实现文档工作台、块编辑/审阅、批注、对比、校验、不可变定稿、修订、DOCX/PDF/XLSX 导出。
- 将原 Hash/MockStore 主链改为 React Router、TanStack Query、React Hook Form/Zod、OpenAPI 类型与真实 API；保留深蓝/白/浅灰主要视觉。
- 建立 Docker Compose 六服务、生产覆盖、备份恢复脚本、Nginx SPA 刷新回退、Makefile 和一键交付门禁。
- 建立脱敏 Demo Golden Case，实际生成四阶段 DOCX/PDF、合同预草案、字段追溯 XLSX 和校验报告。
- 最终回归：后端 pytest 16/16、覆盖率 79.41%；前端 Vitest 6/6；Ruff、mypy、前端 lint/typecheck/build、OpenAPI 契约、密钥扫描、Python 和 pnpm 依赖审计通过。
- 安全扫描曾发现 pytest、Vite/PostCSS/Nanoid/ansi-regex/Playwright 已知漏洞，升级/覆盖到修复版本后重新审计通过。
- 使用 artifact-tool 导入并渲染追溯工作簿全部 2 个工作表，公式错误匹配 0；人工查看未见截断或布局错误。
- Docker 六个运行服务均为 healthy；API 与 worker 使用非 root 的 `docchain` 用户。
- Playwright E2E 4/4 通过，覆盖四阶段生成定稿导出主链、错误态、并发冲突、退出保护、路由刷新、三种桌面宽度和基础可访问性。
- Golden Case 149/149 自动检查通过；5 份 DOCX 共 26 页、4 份 PDF 共 18 页和 XLSX 的 2 个工作表均完成渲染与人工视觉检查。
- 2026-09-07 最终执行 `docker compose --profile verify run --rm verify`，容器内字面量 `make verify` 返回退出码 0，最终交付件门禁通过。
- 2026-09-07 将本机 Demo 管理员凭据统一为 `admin/admin123`，现有旧管理员原位迁移、旧会话失效，生产模式继续强制至少 12 位管理员密码。
