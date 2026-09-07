# 运维手册

日常检查包括 `docker compose ps`、API `/ready`、Worker ping、队列积压、PostgreSQL/Redis/MinIO 容量、失败作业、审计日志和备份时间。应用日志包含 request id；解析/生成/导出通过作业状态、步骤和事件定位。

服务可单独 `docker compose restart api|worker|web`，持久数据保存在命名卷。Worker 重启后可重试失败步骤，幂等键和成功步骤状态避免重复结果。业务对象和对象文件需要成对备份，恢复后核对表计数和对象 SHA-256。

告警建议覆盖 ready 失败、任务持续失败、队列延迟、磁盘低水位、数据库连接耗尽、对象丢失、登录异常和 P0 校验异常。升级顺序为备份、构建、迁移、滚动 API/Worker/Web、Smoke、E2E/Golden Case；不可逆迁移须另做回退方案。
