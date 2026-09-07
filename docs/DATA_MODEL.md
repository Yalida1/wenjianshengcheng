# 数据模型

模型按组织隔离。身份域包括 organizations、users、user_sessions、roles、permissions、user_roles；项目域包括 projects、project_members、project_stages；文件域包括 files、file_versions、file_parse_jobs、parsed_documents、parsed_tables、document_blocks。

字段域包括 field_definitions、field_values、field_evidence、field_confirmations、field_conflicts、field_snapshots。模板域包括 templates、template_versions、template_sections、template_variables、document_format_profiles。生成与文档域包括 generation_jobs/steps/events、documents、document_versions/sections/content_blocks/comments、comparison_runs/items、validation_rules/runs/issues、finalization_records、export_jobs/artifacts、audit_logs。

关键业务表携带组织、创建/更新人、时间和 revision。版本记录保存 source_file_id/version/SHA-256、field_snapshot_id、template_id/version、prompt_version、generation_provider/model 和 parent_version_id。数据库变更只通过 `backend/migrations`；`make migration-check` 会对全新空库升级到 head 并检查关键表。
