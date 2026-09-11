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

## 采购方案分析与确认

- `POST/GET /projects/{project_id}/procurement-analyses`：按当前锁定可研版本创建分析任务、查询历史运行；分析状态含 `queued`、`running`、`retrying`、`succeeded`、`succeeded_demo`、`failed` 和 `stale`。
- `GET /procurement-analyses/{run_id}`：查询来源版本、模型、提示词版本、全文覆盖和失败信息。
- `GET /projects/{project_id}/procurement-plans`、`GET /procurement-plans/{plan_id}`：读取候选方案、程序计算的主文件数量、采购包映射、证据、预算核对和待确认项。
- `PUT /procurement-plans/{plan_id}/structure`：在 revision 并发控制和单事务内修改名称、范围、预算、模板、采购包归属，并重新执行覆盖、重复、金额和模板校验。
- `POST /procurement-plans/{plan_id}/confirm`：确认方案并锁定来源版本、方案修订和采购包快照；存在影响范围或份数的 P0 问题时返回 `procurement_plan_blocked`。
- `POST /procurement-issues/{issue_id}/resolve`：记录人工补充或适用性确认；程序规则问题必须通过修改结构数据自动复核。
- `POST /procurement-plans/{plan_id}/generate-batch`：按所选主文件组创建独立生成任务；同一幂等键不会重复建任务或成品。
- `GET /procurement-generation-batches/{batch_id}`、`POST /procurement-generation-batches/{batch_id}/retry-failed`：读取逐份状态并只重试失败项，已成功文件保留。
- `GET/POST /procurement-rule-sets`、`POST /procurement-rule-sets/{rule_set_id}/publish`：配置和发布带适用主体、地区、资金性质、来源、版本和生效期的规则集。已发布旧版本标记为 `superseded`，不硬编码全国统一金额门槛。

普通 `POST /generation-jobs` 新增可选的 `procurement_plan_id`、`procurement_document_group_id` 和 `procurement_package_ids`。招标生成必须使用组内确认模板；合同生成可以只选择该主文件组中的部分采购包。三者均不传时继续使用原有单文件/外部上传链路。
