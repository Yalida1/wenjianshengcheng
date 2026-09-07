# 文档生成与版本

生成输入由定稿上游或上传文件、已确认字段快照、已发布模板版本、Format Profile 和生成配置组成。作业创建时锁定所有版本与 SHA-256，Worker 执行前再次核验，来源改变则失败而不是静默换源。

章节按模板计划分步生成并记录事件。文档块类型覆盖 fixed_template、confirmed_field、ai_generated、user_edited、table 和 attachment；固定块默认锁定。编辑使用 revision 处理并发冲突，字段更新同步引用并触发重新校验。定稿要求 P0 为零、章节完整、变量已替换、金额/范围/期限一致且 AI 内容已人工审阅。

DOCX 从锁定的 DOCX 模板原生渲染，PDF 和 XLSX 为真实文件。导出记录模板/版本、Format Profile、标准、字体与格式检查结果及文件 SHA-256。定稿版本不可变；修订通过 parent_version_id 形成链。
