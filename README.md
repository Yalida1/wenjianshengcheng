# 项目文件链式生成平台

面向项目编制、审核和管理人员的可运行全栈平台。唯一主链路为：需求说明/项目建议书 → 可研报告 → 招标文件 → 合同。下游既可选择平台内上一阶段的已定稿版本，也可上传已有文件。金额、主体、期限、范围、税率和付款等 P0 字段必须具有来源证据并经人工确认，阻断问题清零后才能定稿。

## 快速启动

1. 复制 `.env.example` 为 `.env`，至少修改应用密钥、数据库密码、MinIO 密码和演示管理员密码。
2. 执行 `make up`（或 `docker compose up -d --build`）。
3. 等所有服务为 healthy 后访问 `http://localhost:8080`。
4. 开发默认账号：`admin@example.com`；密码取 `DEMO_ADMIN_PASSWORD`，示例值仅供本机 Demo。

常用命令：`make install`、`make migrate`、`make seed`、`make test`、`make test-e2e`、`make golden-case`、`make verify`、`make down`。`make clean` 仅清理可再生缓存和构建目录，保留源码、Golden Case 输入与 `artifacts` 交付物。

## 架构

- Web：React 19、TypeScript、Vite、Tailwind、React Router、TanStack Query、React Hook Form/Zod。
- API：Python 3.12、FastAPI、Pydantic v2、SQLAlchemy 2、Alembic。
- 后台任务：Celery + Redis；文件：S3 兼容存储，开发使用 MinIO。
- 文档：DOCX 模板原生 OOXML、PDF、XLSX；容器内 LibreOffice 负责 DOCX 可打开性和转换复核。
- AI：确定性 Demo Provider 与 OpenAI-compatible Provider；AI 建议不会自动成为正式字段。

完整说明见 [产品说明](docs/PRODUCT.md)、[架构](docs/ARCHITECTURE.md)、[测试](docs/TESTING.md)、[部署](docs/DEPLOYMENT.md) 和 [已知限制](KNOWN_LIMITATIONS.md)。OpenAPI 契约位于 `docs/openapi.json`，运行态接口文档为 `/docs`。

## 验收边界

仓库内 Demo 模板、Demo Provider 和脱敏数据用于自动验收，不代表客户正式模板、授权字体、真实模型或生产基础设施已经验收。生产上线前必须导入客户批准模板、校准规则并在目标环境重新运行完整验收。
