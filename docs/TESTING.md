# 测试与验收

单项命令包括 `make lint`、`make typecheck`、`make test-backend`、`make test-frontend`、`make test-e2e`、`make migration-check`、`make contract-check`、`make golden-case` 和 `make security`。

`make verify` 按环境预检、前端类型生成/lint/typecheck/unit/build、后端 lint/typecheck/pytest、空库迁移、OpenAPI、备份恢复、Playwright、Golden Case、格式检查、密钥/依赖安全扫描和最终交付件门禁执行；任一步骤失败即非零退出。完整依赖和 LibreOffice 在 `Dockerfile.verify` 中固定，可执行 `docker compose --profile verify run --rm verify`。

Playwright 覆盖登录、项目创建、文件上传与解析、两种阶段来源、字段确认、四阶段生成/审核/校验/定稿、导出、坏文件、revision 冲突和退出重定向。三种桌面宽度为 1440、1280、1024；截图作为测试附件。真实运行数量、退出码和重跑结果只记录在 `TEST_RESULTS.md`，不得手工推定。
