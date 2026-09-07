# 项目文件链式生成平台

面向项目编制、审核和管理人员的可运行全栈平台。唯一主链路为：需求说明/项目建议书 → 可研报告 → 招标文件 → 合同。下游既可选择平台内上一阶段的已定稿版本，也可上传已有文件。金额、主体、期限、范围、税率和付款等 P0 字段必须具有来源证据并经人工确认，阻断问题清零后才能定稿。

## 快速启动

1. 复制 `.env.example` 为 `.env`，至少修改应用密钥、数据库密码、MinIO 密码和演示管理员密码。
2. 执行 `make up`（或 `docker compose up -d --build`）。
3. 等所有服务为 healthy 后访问 `http://localhost:8080`。
4. 开发默认账号：`admin`；默认密码：`admin123`。它们分别由 `DEMO_ADMIN_ACCOUNT` 和 `DEMO_ADMIN_PASSWORD` 控制，仅供本机 Demo，生产部署必须更换为至少 12 位的强密码。

如需启用 DeepSeek，将 `.env` 中的 `LLM_PROVIDER` 设为 `openai_compatible`，并填写 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL` 和 `LLM_TIMEOUT_SECONDS`。密钥只放在被 Git 忽略的本机 `.env`，不得写入源码、文档或提交记录。

常用命令：`make install`、`make migrate`、`make seed`、`make test`、`make test-e2e`、`make golden-case`、`make verify`、`make down`。`make clean` 仅清理可再生缓存和构建目录，保留源码、Golden Case 输入与 `artifacts` 交付物。

## 架构

- Web：React 19、TypeScript、Vite、Tailwind、React Router、TanStack Query、React Hook Form/Zod。
- API：Python 3.12、FastAPI、Pydantic v2、SQLAlchemy 2、Alembic。
- 后台任务：Celery + Redis；文件：S3 兼容存储，开发使用 MinIO。
- 文档：DOCX 模板原生 OOXML、PDF、XLSX；容器内 LibreOffice 负责 DOCX 可打开性和转换复核。
- AI：确定性 Demo Provider 与 OpenAI-compatible Provider；模板中心支持“程序解析 + 小模型理解 + 人工确认”从成品 DOCX 提取候选模板，AI 建议不会自动成为正式字段或自动发布模板。

完整说明见 [产品说明](docs/PRODUCT.md)、[架构](docs/ARCHITECTURE.md)、[测试](docs/TESTING.md)、[部署](docs/DEPLOYMENT.md) 和 [已知限制](KNOWN_LIMITATIONS.md)。OpenAPI 契约位于 `docs/openapi.json`，运行态接口文档为 `/docs`。

## 验收边界

模板中心内置 9 份“国家正式文本”权威来源索引、9 份“依据正式大纲适配”的可生成模板和 4 份“平台参考模板”；客户、行业或地区确认使用的文件归入“其他正式模板”。国家正式文本只用于查阅核对，不会进入生成列表；适配版和平台参考版均在页面及 DOCX 中明确声明其性质。Demo Provider 和脱敏数据仍只用于自动验收，不代表客户模板、授权字体、真实模型或生产基础设施已经验收。生产上线前必须导入客户批准模板、校准规则并在目标环境重新运行完整验收。
