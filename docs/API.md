# API 使用说明

统一前缀为 `/api/v1`，OpenAPI 文件是 `docs/openapi.json`。主要资源覆盖 auth、users、roles、permissions、organizations、projects/members/stages、files/versions/parse-jobs、field-definitions/values/evidence/confirmations/snapshots/conflicts、templates/versions/sections/variables、format-profiles、generation-jobs/steps/events、documents/versions/blocks/comments、validation-runs/issues、comparisons、exports/artifacts 和 audit-logs。

`DELETE /api/v1/projects/{project_id}` 仅允许系统管理员调用，请求体必须包含当前 `revision` 和与项目记录完全一致的 `confirmation_code`。接口以单事务删除项目数据链，保留 `project.delete` 审计记录，并清理对应对象存储文件；存在运行中后台任务或修订冲突时返回 `409`。

登录成功后使用 HttpOnly 会话 Cookie；修改请求同时校验权限、组织/项目对象访问权和 revision。错误统一返回错误码、中文消息、详情和 request id。列表支持分页。上传使用 multipart/form-data；下载端点返回对象内容。生成、解析和导出先返回作业，再查询状态/事件。

模板反向提取接口位于 `/template-extractions`：

- `POST /template-extractions`：上传 DOCX，传入阶段和 `authorized_external_processing=true` 后创建异步提取任务。
- `GET /template-extractions`、`GET /template-extractions/{id}`：查询列表、进度、模型信息、候选项和失败原因。
- `POST /template-extractions/{id}/retry`：仅对可重试失败任务重新排队。
- `POST /template-extractions/{id}/confirm`：提交 revision、来源元数据及勾选的候选 ID，幂等建立模板草稿。
- `GET /templates/{template_id}/versions/{version}/source`：下载确认后生成的候选 DOCX 源文件。

任务状态包括 `queued`、`running`、`retrying`、`review_required`、`failed` 和 `confirmed`。确认接口不会发布模板；发布仍使用现有模板发布端点及预检门禁。

前端类型由 `pnpm generate:api` 从契约生成。`python -m backend.scripts.export_openapi --check` 会在契约漂移时失败，避免前后端静默失配。
