# 备份与恢复

`scripts/backup.sh` 使用 PostgreSQL 自定义格式备份数据库并镜像 MinIO 对象；`scripts/restore.sh` 恢复到明确指定目标。运行前设置数据库和对象存储连接变量，并把备份目录放在受控、加密和有保留策略的位置。

恢复演练步骤：停止写入、验证备份哈希、恢复到隔离环境、运行迁移、比对关键表数量、核对对象键和 SHA-256、运行 API Smoke/Golden Case，再决定切换。不要只恢复数据库或只恢复对象存储。

`python -m backend.scripts.backup_restore_smoke` 对 Golden Case SQLite 快照和对象目录执行真实备份/解包/计数/哈希一致性验证，结果写入 `artifacts/backup-restore-smoke.json`。它验证程序流程，不替代生产 PostgreSQL/MinIO 灾备演练。
