# AI Provider

`backend/app/services/providers.py` 定义统一 Provider、版本化提示词和 Pydantic 输出 Schema。`demo/deterministic-v1` 只根据已确认字段稳定生成章节，供离线测试与 Demo 使用。`openai_compatible` 通过环境变量配置 base URL、API key 和 model，并要求结构化 JSON Schema 响应。

Provider 不得确认字段，不得填造关键数据，不得把参考值升级为正式值，也不得修改固定模板块。抽取结果按 extracted、missing、conflict、invalid、ai_suggested 等状态进入人工确认；生成结果记录 provider、model 和 prompt version。真实生产模型没有密钥时不属于已验证范围。
