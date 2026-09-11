# AI Provider

`backend/app/services/providers.py` 定义统一 Provider、版本化提示词和 Pydantic 输出 Schema。当前正文生成提示词版本为 `document-section-v2`：要求按正式文书小标题组织章节、每章至少 4 段且不少于约 400 字，并对缺失的金额/主体/日期等关键项强制输出 `【待确认】` 占位，禁止编造或跨阶段金额换算。`demo/deterministic-v1` 按同一结构确定性生成，供离线测试与 Demo 使用；`openai_compatible` 通过环境变量配置 base URL、API key、model 和请求超时，并附带章节结构提示供模型扩写润色。

DeepSeek 官方接口使用 JSON Object 模式，并由服务端 Pydantic Schema 做第二次严格校验；其他支持 Structured Outputs 的 OpenAI-compatible 服务仍使用严格 JSON Schema。空响应、非法 JSON 或不符合 Schema 的内容不会进入业务数据，任务会按既定次数重试并保留失败状态。当前配置项如下：

- `LLM_PROVIDER=openai_compatible`
- `OPENAI_BASE_URL=https://api.deepseek.com`
- `OPENAI_API_KEY`：只写入本机 `.env`
- `OPENAI_MODEL`：填写账号可用模型名称
- `LLM_TIMEOUT_SECONDS=90`

成品文件模板提取使用独立的 `template-extraction-v1` 提示词。程序先解析 DOCX 的段落、表格、标题样式和页眉页脚，再把带有不可执行声明和块编号的纯文本交给模型。模型只返回章节和变量候选；变量必须能在指定源块中逐字定位，否则由程序丢弃。最终候选必须由模板管理员勾选并确认，确认后仅建立草稿，不会自动发布。

Provider 不得确认字段，不得填造关键数据，不得把参考值升级为正式值，也不得修改固定模板块。抽取结果按 extracted、missing、conflict、invalid、ai_suggested 等状态进入人工确认；生成与模板提取结果均记录 provider、model 和 prompt version。模型连通与结构化响应通过只含无业务数据的探针验证；客户真实材料的准确率、容量和合规性仍须在目标环境单独验收。
