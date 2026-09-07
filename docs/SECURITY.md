# 安全说明

密码使用 Argon2 哈希；会话使用随机令牌的摘要存储并通过 HttpOnly、SameSite Cookie 传递，可配置 Secure。登录有失败限流，账号可停用。后端执行 RBAC、组织隔离、项目成员对象级访问控制，不能依赖前端隐藏按钮。本机 Demo 凭据 `admin/admin123` 仅用于开发验收；生产模式拒绝少于 12 位的 `DEMO_ADMIN_PASSWORD`。

上传同时校验后缀、MIME、文件头、大小和安全文件名；对象不可由用户路径直接寻址。SQL 使用 SQLAlchemy 参数化查询。Nginx 设置基础安全响应头；生产环境要求强密钥、HTTPS、安全 Cookie、受限 CORS、独立数据库/对象存储凭证和私网服务端口。

上传、确认/修改字段、模板发布、生成、编辑、问题处理、定稿、修订、导出和权限变更写入审计日志。`make security` 执行仓库密钥模式扫描、Python 依赖审计和 pnpm 高危依赖审计。病毒扫描、企业 SSO、WAF/SIEM 和外部渗透测试属于生产集成边界。
