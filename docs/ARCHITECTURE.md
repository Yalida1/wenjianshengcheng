# 架构说明

## 运行拓扑

浏览器通过 Nginx 单入口访问 React SPA 和 `/api/v1`。FastAPI 处理认证、事务和查询，PostgreSQL 存业务对象，MinIO 存源文件、模板和导出件；耗时解析、生成和导出由 Celery Worker 执行，Redis 作为 broker/result backend。`request_id` 在 API 错误和日志中贯穿。

## 代码结构

- `src/`：唯一前端，正式路由、页面、组件、统一 API client 和 OpenAPI 生成类型。
- `backend/app/`：API、模型、安全、审计、任务与文件/生成/校验服务。
- `backend/migrations/`：Alembic 迁移。
- `backend/scripts/`：种子、OpenAPI、Golden Case、备份恢复和交付门禁。
- `golden_cases/demo_001/`：脱敏输入和期望值；`artifacts/golden_case/`：实生成交付件。

## 一致性与版本

生成作业锁定源文件版本及 SHA-256、字段快照及 SHA-256、模板版本及 SHA-256、提示词版本、Provider 和模型。写接口使用对象级鉴权和 revision 并发检查。后台任务以幂等键避免重复创建，成功步骤不重复执行，失败可重试、作业可取消。

## 设计选择

保留原 Figma 前端的企业深蓝、白、浅灰视觉和业务工作台，但将 Hash/MockStore 改为 BrowserRouter 和服务端状态。没有建立第二套前端。Demo Provider 用于无付费模型的确定性测试；生产 Provider 使用 OpenAI-compatible JSON Schema 响应。
