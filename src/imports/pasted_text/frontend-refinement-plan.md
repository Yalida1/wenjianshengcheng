请完整检查当前项目中的现有 React 前端代码，并基于当前代码进行一次
“完整前端收口”。

本轮只做前端界面、模拟数据和本地交互。

不要实现：

- 数据库；
- 后端 API；
- 真实文件解析；
- 真实 AI 调用；
- 真实 DOCX/PDF 生成；
- 真实权限服务；
- 真实网络请求；
- 生产部署。

不要重新创建应用。
不要推翻当前视觉设计。
不要删除已经完成的字段确认、模板选择、生成进度、
文档工作台、校验和版本对比页面。

请直接修改当前代码，在一次任务中完成下列内容。
不要中途询问是否继续，不要只输出计划。

一、首先审查当前代码

当前已有路由包括：

- project-list
- project-detail
- template-center
- template-detail
- field-dictionary
- system-management
- field-confirmation
- template-selection
- generation-setup
- generation-progress
- document-preview
- validation-center
- document-compare
- contract-source

请保留并完善这些页面。

二、删除所有正式界面中的占位内容

删除以下用户可见内容：

- 功能待开发
- 后续版本中实现
- 本轮仅为占位页
- 详细业务工作台将在下一阶段接入
- 功能开发中

任何主按钮都不能通过占位提示代替真实前端跳转。

三、移除开发测试控件

从正式业务界面移除：

1. 模板选择页中的
   “预览无匹配模板状态”开发切换器；

2. 校验中心中的
   “默认 / 阻断 / 通过”开发切换器；

3. 字段确认页进入 4 秒后自动出现
   “上游文件发生变化”的模拟逻辑。

如需集中展示页面状态，创建一个不出现在主导航中的：

/ui-states

用来演示：

- 空状态；
- 加载；
- 失败；
- 无权限；
- 上游变化；
- 版本冲突；
- 保存失败；
- 模板过期。

四、补齐招标阶段前置页面

新增并连接：

1. tender-source-selection
2. tender-file-upload
3. tender-parse-progress
4. tender-parse-summary

正确流程：

项目详情
→ 招标文件“选择输入”
→ 选择“使用平台已定稿可研”或“上传已有可研”
→ 上传或选择文件
→ 解析中
→ 解析结果摘要
→ 字段确认
→ 模板选择
→ 生成配置
→ 生成进度
→ 文档审校
→ 校验
→ 定稿
→ 导出。

不能再从项目详情直接跳过来源选择和文件解析，
直接进入字段确认。

五、补齐需求/项目建议书阶段前端

新增完整但使用模拟数据的阶段流程：

1. requirement-source-selection
2. requirement-input
3. requirement-file-upload
4. requirement-field-confirmation
5. proposal-template-selection
6. proposal-generation-setup
7. proposal-generation-progress
8. proposal-document-workspace
9. proposal-validation
10. proposal-finalized

需求阶段支持：

- 结构化问答录入；
- 上传已有需求材料；
- 上传已有项目建议书；
- 选择项目建议书模板；
- 生成项目建议书；
- 审校；
- 定稿；
- 导出。

项目详情中的“需求说明 / 项目建议书”按钮必须进入该阶段，
不能再显示占位对话框。

六、补齐可研阶段前端

新增完整但使用模拟数据的可研流程：

1. feasibility-source-selection
2. feasibility-file-upload
3. feasibility-parse-summary
4. feasibility-field-confirmation
5. feasibility-profession-selection
6. feasibility-template-selection
7. feasibility-generation-setup
8. feasibility-generation-progress
9. feasibility-document-workspace
10. feasibility-validation
11. feasibility-finalized

可研阶段支持：

- 使用平台已定稿项目建议书；
- 上传已有需求或建议书；
- 上传已有可研；
- 选择项目专业；
- 选择专业可研模板；
- 字段确认；
- 生成；
- 审校；
- 定稿；
- 导出。

不要让“可研报告—继续确认”进入招标字段确认页面。

七、完成合同阶段前端

将当前 ContractSourceSelectionPage 中的占位内容替换为完整流程。

新增：

1. contract-source-selection
2. contract-file-upload
3. contract-parse-summary
4. contract-field-confirmation
5. contract-element-confirmation
6. contract-template-selection
7. contract-generation-setup
8. contract-generation-progress
9. contract-document-workspace
10. contract-validation
11. contract-finalized
12. contract-export

合同要素确认页面必须包含：

- 甲方信息；
- 乙方信息；
- 合同标的；
- 本合同范围；
- 最终合同金额；
- 税率；
- 是否含税；
- 履行期限；
- 交付地点；
- 付款计划；
- 验收标准；
- 质保期；
- 违约条款；
- 生效条件。

必须把以下内容显示为只读参考：

- 可研总投资；
- 招标预算；
- 招标最高限价。

最终合同金额必须是独立确认字段，
不得自动等同任何参考金额。

付款计划使用可编辑表格：

- 付款节点；
- 比例；
- 金额；
- 触发条件。

实时显示：

- 付款比例合计；
- 付款金额合计；
- 是否与最终合同金额一致。

数据不一致时禁用“进入合同生成”。

合同等级包含：

- 预草案；
- 签约准备。

缺少乙方、最终金额、税率、付款安排时，
只能为预草案。

八、建立统一前端 Mock Store

不要继续把关键状态分别散落在每个页面。

建立统一的前端模拟状态，例如：

- currentProject
- stageStates
- sourceSelection
- sourceDocuments
- fieldSnapshots
- confirmedFields
- selectedTemplates
- generationJobs
- documents
- validationResults
- finalizedVersions
- exportRecords

用户选择模板后，
生成配置页面必须显示真实选择的模板。

生成完成后，
项目详情必须从“生成中”变为“待审校”。

定稿后，
项目详情必须显示已定稿版本。

页面刷新后可以恢复默认演示状态，
不需要真实数据库。

九、修复所有死按钮

检查项目中所有 button、菜单、文字链接和卡片操作。

所有视觉上可点击的元素必须满足至少一种行为：

- 页面跳转；
- 打开抽屉；
- 打开对话框；
- 切换状态；
- 更新模拟数据；
- 显示保存、成功或失败反馈。

重点修复：

- 保存草稿；
- 查看原文；
- 复制原文；
- 查看版本记录；
- 查看完整变量清单；
- 提交模板需求；
- 查看历史版本；
- 定位校验问题；
- 查看字段证据；
- 标记已复核；
- 恢复段落；
- 创建修订版本；
- 导出 PDF；
- 查看来源关系；
- 查看影响字段；
- 查看模板差异；
- 保存冲突副本。

不允许使用 alert 或 console.log 代替正式前端反馈。

十、完善管理页面交互

模板中心：

- 搜索真实过滤模拟数据；
- 阶段和状态筛选有效；
- 导入模板；
- 模板详情；
- 章节结构；
- 变量；
- 版本记录；
- 发布新版本；
- 停用模板。

字段字典：

- 左侧字段分组可以切换；
- 搜索和筛选有效；
- 新建字段；
- 字段详情；
- 来源策略；
- 禁止映射；
- 修改记录。

系统管理：

- 用户搜索和筛选有效；
- 新增用户；
- 用户详情；
- 角色切换；
- 权限矩阵；
- 审计日志筛选；
- 日志详情。

十一、响应式收口

1440：

- 左侧导航展开；
- 页面留白充分；
- 文档画布保持可读宽度。

1280：

- 隐藏低优先级表格列；
- 长文本允许两行；
- 操作不被裁切。

1024：

- 左侧导航折叠为 72px；
- 项目阶段为 2×2；
- 管理表格转换为分层行或隐藏低优先级列；
- 字段目录和文档目录改为抽屉；
- 证据、AI、校验面板使用覆盖抽屉；
- 不允许文字逐字竖排；
- 不允许页面横向溢出；
- 不允许操作按钮被裁切。

移除根容器依赖固定 min-width 解决布局的方式，
应使用真实响应式布局。

十二、代码结构收口

不要继续扩大单文件。

将 FieldConfirmationPage 和 DocumentWorkspacePage 拆分为：

- 页面容器；
- Header；
- Toolbar；
- Navigation；
- Content/List/Canvas；
- Drawer；
- Dialog；
- Footer。

建立：

- src/types
- src/mock
- src/config
- src/components
- src/pages
- src/features

不要把所有业务状态继续堆进 App.tsx。

十三、最终自检

完成后自动检查：

1. 四个左侧导航全部可点击；
2. 四个文件阶段全部可以进入；
3. 每个阶段都有完整前端闭环；
4. 所有主要按钮有反馈；
5. 不存在“功能待开发”；
6. 不存在空白占位页；
7. 不存在正式页面开发切换器；
8. 不存在点击无反馈的视觉按钮；
9. 不存在需求、可研和招标阶段错跳；
10. 合同金额与参考金额明确区分；
11. P0 阻断状态能禁用生成和定稿；
12. 1024 页面不横向溢出；
13. TypeScript 无错误；
14. 浏览器控制台无运行时错误；
15. 当前已经完成的视觉风格没有被重做。

完成全部修正后再停止，
并输出：

- 页面路由清单；
- 公共组件清单；
- Mock 状态清单；
- 已修复死按钮清单；
- 1440、1280、1024 自检结果。
