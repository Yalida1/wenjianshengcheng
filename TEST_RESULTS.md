# 测试结果

## 记录规则

本文件只记录实际执行结果。失败后修复并重跑时，同时保留失败原因与最终重跑结论；未执行的项目不计为通过。

## 已完成检查

| 检查 | 实际结果 |
|---|---|
| 后端 pytest | 15/15 通过，语句覆盖率 79.33%，覆盖率门槛 70% |
| 前端 Vitest | 6/6 通过 |
| 后端 Ruff | 通过 |
| 后端 mypy | 通过 |
| 前端格式与静态检查 | 通过 |
| 前端 TypeScript | 通过 |
| 前端生产构建 | 通过 |
| Alembic 空库迁移 | 3 个迁移完成，检查到 45 张表 |
| OpenAPI 契约 | 生成文件与当前应用 schema 一致 |
| Python 依赖审计 | `pip-audit` 未发现已知漏洞 |
| Node 依赖审计 | `pnpm audit --audit-level high` 未发现已知漏洞 |
| 源码密钥扫描 | 136 个源码/配置/文档文件扫描通过 |
| 浏览器 E2E | 4/4 通过；含四阶段主链、错误态、revision 冲突、退出保护、路由刷新、三种桌面宽度和基础可访问性 |
| Golden Case 自动验证 | 149/149 检查通过 |
| DOCX 视觉检查 | 5 份、26 页全部渲染查看；未见裁切、乱码、重叠或空白异常 |
| PDF 结构与视觉检查 | 4 份、18 页；均为 A4、未加密、PDF 1.7，文本可提取，逐页查看无异常 |
| XLSX 结构与视觉检查 | 2 个工作表、2 个表格、27 条字段追溯记录，公式错误 0；付款合计 100% / 9,260,000 元，无截断 |
| Docker 运行状态 | PostgreSQL、Redis、MinIO、API、worker、web 全部 healthy |
| 容器身份 | API 与 worker 均为 `uid=999(docchain)` |
| HTTP 鉴权 smoke | 登录 200、当前用户 200、项目列表 200、登出 204 |

## 统一验收

- 首次执行 `docker compose --profile verify build verify` 失败：Docker 构建上下文读取本机 `.audit-cache/pip` 时遇到 Windows `Access is denied`；已将纯缓存目录加入 `.dockerignore`，随后重建。
- 第二次构建继续发现 `.pytest_cache` 的同类本机权限问题；已一次性排除 pytest、mypy、Ruff、coverage、临时目录和 TypeScript 构建缓存。
- 第三次构建在 Playwright 基础镜像下载至末段后收到 BuildKit `rpc error: Unavailable ... EOF`，随后 Docker Desktop 报告引擎无法启动；此项按基础设施中断处理，重启引擎后续建。
- Docker 日志确认 C 盘为 0 字节且容器运行时曾发生 SIGBUS；经用户授权仅清理 Docker 日志/WSL 崩溃转储 79,967,075 字节，以及可重建的 npm/pip 下载缓存 1,754,718,070 字节。Docker VHDX、卷、数据库、Codex 会话和项目交付物均未删除。
- WSL 全局关闭并重新挂载后 Docker Engine 29.4.2 恢复，六个项目服务仍全部 healthy；经用户授权又回收 8.506 GB BuildKit 缓存。随后验收镜像基础层下载成功，但 Ubuntu HTTP 软件源返回 502 且 90 秒无进展，构建被中止并将系统源切换为 HTTPS。
- 首轮完整门禁暴露验证容器数据目录缺失和 ReportLab 中文字体问题；已创建数据目录，并改为使用 LibreOffice 将生成的 DOCX 转换为 PDF。
- 四阶段 E2E 暴露模板重复初始化后的摘要漂移，以及页面过早判断待审阅块的问题；已改为以对象存储真实内容计算摘要，并等待文档加载后逐块确认。
- Golden Case 曾引用已移除的旧字体函数；已统一复用正式 DOCX→PDF 转换服务，定向复测 149 项通过。
- 安全扫描发现基础 Playwright 镜像自带 `pip 24.0` 的已知漏洞；验证镜像已固定升级为官方 `pip 26.2.1`，重跑后 Python 与 Node 依赖均未发现已知漏洞。
- 最终执行 `docker compose --profile verify run --rm verify`，容器内完整运行字面量 `make verify`，退出码为 0；最后一项输出为 `Delivery gate passed`。
