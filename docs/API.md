# API 使用说明

统一前缀为 `/api/v1`，OpenAPI 文件是 `docs/openapi.json`。主要资源覆盖 auth、users、roles、permissions、organizations、projects/members/stages、files/versions/parse-jobs、field-definitions/values/evidence/confirmations/snapshots/conflicts、templates/versions/sections/variables、format-profiles、generation-jobs/steps/events、documents/versions/blocks/comments、validation-runs/issues、comparisons、exports/artifacts 和 audit-logs。

登录成功后使用 HttpOnly 会话 Cookie；修改请求同时校验权限、组织/项目对象访问权和 revision。错误统一返回错误码、中文消息、详情和 request id。列表支持分页。上传使用 multipart/form-data；下载端点返回对象内容。生成、解析和导出先返回作业，再查询状态/事件。

前端类型由 `pnpm generate:api` 从契约生成。`python -m backend.scripts.export_openapi --check` 会在契约漂移时失败，避免前后端静默失配。
