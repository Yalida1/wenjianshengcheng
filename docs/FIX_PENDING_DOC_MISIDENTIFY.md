# 待编制文件误识别与按文件动态字段采集 — 修复说明与回滚

本文档对应分支 `fix/pending-doc-misidentify-and-scoped-fields` 第八、九节改动。

## 问题摘要

1. 历史规则通道 / 平台默认策略可能把汇总行、字段映射表、一包一套默认值误识别成待编制文件组。
2. 适用字段曾按全量招标目录统计完成度；无模板 / 未知类别时可能显示 100% 并误允许定稿。
3. `parse_file_task` 首次抽取时文档组可能尚不存在；后续方案/模板变更只刷新列表时，新适用字段未回填。
4. `list_project_tender_groups` 曾跨项目全部 plan 取 active 组，导致备选方案污染当前有效方案。

## 行为变化（第八节）

- 适用字段区分 `source_stage` / `input_role` / `required_for_phase` / `blocking`。
- 无模板或未知类别：返回**最小材料采集集** + `setup_incomplete=true`，前端不得显示「已完成」定稿完成度。
- 模板变量未知 / 版本缺失 / 解析失败：进入 `template_config_errors`，按模板配置问题阻断，不静默记为材料缺失。
- 内置模板「全量 catalog 变量注册」回退到 profile；客户 DOCX 真实引用全量变量时仍按模板。
- 增量回填：`incremental_extraction.refresh_field_candidates_from_parsed_blocks`，基于已解析 blocks，不重读文件、不调 LLM；确认/方案结构变更/显式 ensure-default 后触发。
- 抽取与适用字段并集仅针对**当前有效采购方案**的 active 组。

## 历史数据清理（第九节）

脚本：`backend/scripts/heal_pending_doc_misidentify.py`

```bash
# 只读扫描
python -m backend.scripts.heal_pending_doc_misidentify --dry-run \
  --output artifacts/heal-pending-doc-dry-run.json

# 受控写入（软归档 / 撤销错误候选 / 别名增量升级）
python -m backend.scripts.heal_pending_doc_misidentify --apply \
  --organization-id <org-uuid> \
  --output artifacts/heal-pending-doc-apply.json
```

写入原则：

- 默认 dry-run；`--apply` 才写库。
- 误识别组：`status=archived`（软归档），保留稳定 ID 与包链接，便于审计与回滚。
- 有人工确认 / 下游定稿引用：进入 review queue（AuditLog `heal.pending_doc.review_queue`），不自动归档。
- 错误候选（如 `tender_number=招标阶段生成`）：未保护则新 revision `status=revoked`，不硬删。
- 别名：`merge_missing_aliases` 增量合并；`aliases_override` 客户自定义不覆盖。
- 与 `ensure_default_document_groups` 修复配套：无显式 strategy 时为 no-op，不会把已归档误识别再生成回来。

## 回滚

1. **代码回滚**：还原本分支提交即可；适用字段 API 新增字段为向后兼容可选字段。
2. **数据回滚（推荐）**：`--apply` 前对数据库做快照 / 备份；出问题后按 `docs/BACKUP_AND_RESTORE.md` 恢复。
3. **定点回滚软归档组**：

```sql
UPDATE tender_document_groups
SET status = 'active', updated_at = NOW()
WHERE id = '<group_id>' AND status = 'archived';
```

并写入审计说明。包链接与 scoped 字段键 `doc::<group_id>::*` 因 ID 未变，不会孤儿化。

4. **撤销错误候选回滚**：将 `status=revoked` 的当前行 `is_current=false`，并把上一 revision 的 extracted 行重新 `is_current=true`（需按 revision 对齐）。

## 验证

- 测试 J：模板/profile 切换增量抽取不重读文件。
- 测试 K：完成度 / 生成门禁一致；N/A 不阻断；真实必填不隐藏；setup_incomplete 阻断定稿。
- 测试 L：别名升级、误识别归档、合法组 ID 稳定、heal 不重建错误。

```bash
cd backend
pytest tests/test_applicable_gates_and_heal.py tests/test_applicable_fields.py -q
```
