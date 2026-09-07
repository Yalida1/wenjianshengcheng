# 部署说明

## 开发/Demo

复制 `.env.example` 为 `.env`，修改所有示例凭证，然后执行 `make up`。Compose 启动 PostgreSQL、Redis、MinIO、API、Worker 和 Web；Web 默认发布在 8080。首次 API 启动自动执行 Alembic upgrade 和 Demo 种子。检查 `docker compose ps`、`/health`、`/ready` 和 Web `/healthz`。

## 生产

使用 `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` 作为参考编排。生产必须设置 `APP_ENV=production`、至少 32 字符随机密钥、独立强密码、HTTPS、`SESSION_COOKIE_SECURE=true`、准确 CORS、持久卷、备份计划和外部监控。数据库、Redis、MinIO 不应暴露公网。

部署前导入客户批准模板/字体，配置真实 Provider（如使用），执行空库迁移、`make verify`、备份恢复演练及目标环境容量/安全测试。镜像和基础镜像版本已固定，但上线应接入组织的漏洞管理与镜像签名流程。
