# 测试与验收

单项命令包括 `make lint`、`make typecheck`、`make test-backend`、`make test-frontend`、`make test-e2e`、`make migration-check`、`make contract-check`、`make golden-case` 和 `make security`。

`make verify` 按环境预检、前端类型生成/lint/typecheck/unit/build、后端 lint/typecheck/pytest、空库迁移、OpenAPI、备份恢复、Playwright、Golden Case、格式检查、密钥/依赖安全扫描和最终交付件门禁执行；任一步骤失败即非零退出。完整依赖和 LibreOffice 在 `Dockerfile.verify` 中固定，可执行 `docker compose --profile verify run --rm verify`。

Playwright 覆盖登录、项目创建、文件上传与解析、两种阶段来源、字段确认、四阶段生成/审核/校验/定稿、导出、坏文件、revision 冲突和退出重定向。三种桌面宽度为 1440、1280、1024；截图作为测试附件。真实运行数量、退出码和重跑结果只记录在 `TEST_RESULTS.md`，不得手工推定。

采购方案专项位于 `backend/tests/test_procurement_planning.py` 和 `e2e/procurement-planning.spec.ts`。它使用运行时生成的脱敏 DOCX，不读取或污染用户材料，覆盖三份独立文件、一文件三包、软硬件整体交付、混合分组、总投资不得复制、复用/已采购/远期排除、冲突与解析缺口、非招标方式、合并拆分、来源变更、幂等、部分失败重试、模板阻断、按包生成合同、规则版本追溯和跨项目越权。验收断言包含实际文件数量、名称、采购包归属、证据定位和采购快照，不只检查 HTTP 200。
