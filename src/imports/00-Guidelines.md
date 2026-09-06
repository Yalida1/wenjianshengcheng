# Figma Make / Design Agent Guidelines

## 1. 产品身份

这是一个严谨的中文企业级“项目文件链式生成平台”，不是营销网站，也不是炫技型 AI Dashboard。

唯一业务主线：

```text
需求说明 / 项目建议书
→ 可研报告
→ 招标文件
→ 合同
```

不出现独立的评标、中标、供应商、履约或台账流程。

## 2. 设计目标

- 严谨、可信、简洁、克制、大气。
- 每个页面有清楚的信息层级和唯一主操作。
- 通过留白、分组、抽屉、折叠和分步流程降低认知负担。
- 不把目录、字段、证据、正文和 AI 对话全部永久并排展示。
- 默认桌面端 1440×900，最低适配宽度 1280。
- 主业务工作台不以移动端为首要目标；提供 1024 宽度降级方案。

## 3. 禁止项

- 禁止渐变、玻璃拟态、霓虹、高饱和大色块。
- 禁止无业务价值的图表、KPI 大屏和装饰插画。
- 禁止一页放多个同等强调的主按钮。
- 禁止卡片层层套卡片。
- 禁止 4 列以上的核心信息卡片网格。
- 禁止为了“AI 感”使用紫色渐变和发光效果。
- 禁止使用 lorem ipsum；使用真实、克制的中文业务示例。
- 禁止出现评标流程、中标流程、评委管理、中标结果、供应商管理和履约台账。

## 4. 视觉变量

### 色彩

- Brand/700: `#24457C`
- Brand/600: `#2E5495`
- Brand/500: `#416AAF`
- Brand/100: `#DCE7F7`
- Brand/50: `#F2F6FC`
- Neutral/950: `#0F172A`
- Neutral/700: `#334155`
- Neutral/500: `#64748B`
- Neutral/300: `#CBD5E1`
- Neutral/200: `#E2E8F0`
- Neutral/100: `#F1F5F9`
- Neutral/50: `#F8FAFC`
- Surface: `#FFFFFF`
- App background: `#F6F8FB`
- Success: `#168A5B`, background `#ECF8F2`
- Warning: `#A86512`, background `#FFF7E6`
- Danger: `#C2414B`, background `#FEF1F2`
- Info: `#2E5495`, background `#F2F6FC`

状态不能只依赖颜色，必须同时有文字或图标。

### 字体

优先：`PingFang SC`, `Microsoft YaHei`, `Noto Sans CJK SC`, system-ui。

- Page title: 28/40, Semibold
- Section title: 20/30, Semibold
- Card title: 16/24, Semibold
- Body: 14/22, Regular
- Supporting text: 13/20
- Caption: 12/18
- Data/number: 可使用 tabular numbers

### 间距与尺寸

使用 8pt 网格，必要时允许 4px 微调。

- 页面横向内边距：32px；窄屏 24px
- 页面纵向间距：24px 或 32px
- 卡片内边距：24px
- 卡片间距：20px 或 24px
- 表单字段纵向间距：20px
- 控件高度：40px；关键主按钮 42px
- 表格行高：52px
- 卡片圆角：10px 或 12px
- 输入框圆角：8px
- 边框：1px `#E2E8F0`
- 阴影只用于浮层和悬浮卡片，页面卡片默认以边框区分

## 5. 应用壳

### 常规模式

- 左侧导航：224px，可折叠为 72px。
- 顶部栏：64px。
- 内容最大宽度：1600px。
- 页面默认不贴边，保持 32px 留白。

左侧导航：

1. 项目空间
2. 模板中心
3. 字段字典
4. 系统管理

### 沉浸式工作台模式

用于字段确认、文档预览和版本对比：

- 全局导航默认收起为 72px。
- 左侧业务目录可折叠。
- 证据或 AI 面板默认关闭，按需作为右侧抽屉打开。
- 正文区域始终保持可读宽度，不被左右面板压缩到过窄。

## 6. 核心组件

创建原生 Figma Components、Variants、Properties，并全部使用 Auto Layout：

- Button：Primary / Secondary / Ghost / Danger；Default / Hover / Disabled / Loading
- Input、Textarea、Select、Date、Money、Percentage
- StatusBadge：未开始 / 处理中 / 待确认 / 存在冲突 / 已定稿 / 上游已变更 / 失败
- StageCard
- DocumentCard
- SourceBadge
- EvidenceCard
- FieldRow
- BlockingNotice
- StepRail
- UploadDropzone
- TemplateListItem
- ValidationIssueRow
- EmptyState
- Skeleton
- Drawer / Dialog / ConfirmDialog
- Toast
- A4DocumentCanvas
- VersionTag

命名清楚，例：`Button/Primary/Default`、`StatusBadge/Conflict`。

## 7. 核心业务交互

### 项目四阶段

1. 需求/建议书
2. 可研报告
3. 招标文件
4. 合同

每个阶段展示：状态、输入来源、当前版本、最后更新时间、阻断项数量和主操作。

### 双入口

可研、招标、合同阶段必须明确提供：

- 使用平台上游已定稿文件
- 上传用户已有文件

二者不可使用含糊的单一上传框代替。

### 字段与证据

目标模板反向决定待提取字段。字段必须展示：

- 字段名和重要级别 P0/P1/P2
- 当前值
- 状态
- 来源类型
- 是否已确认
- 查看证据入口

证据通过右侧抽屉展示：文件、页码、章节、原文片段、置信度和“打开原文”。

### 正式版门禁

- P0 缺失、冲突或无效时，正式定稿按钮不可用。
- `ai_suggested` 只能作为候选，不能伪装成已确认值。
- 合同金额不能从可研总投资或招标最高限价直接自动等同。

## 8. 内容文案

使用真实业务示例：

- 项目：`某省公司中心机房节能改造项目`
- 可研：`中心机房节能改造项目可行性研究报告 V1.3`
- 招标：`中心机房节能改造设备采购招标文件 V0.8`
- 合同：`设备采购及安装合同预草案 V0.3`

状态示例：

- 资料待补充
- 正在解析
- 字段待确认
- 存在 3 个阻断项
- 正在生成第 6/12 章
- 校验未通过
- 已定稿
- 上游文件已更新

## 9. Figma 文件规范

页面：

```text
00_Cover
01_Foundations
02_Components
03_User_Flows
04_Desktop_Screens
05_Responsive_States
06_Prototype
07_Dev_Handoff
```

Frame 命名：

```text
P01_Project_List/Default
P01_Project_List/Empty
P02_Project_Detail/Default
W03_Fact_Review/Conflict_Selected
```

所有主页面使用 Auto Layout；容器正确使用 Fill container / Hug contents；不使用无意义的绝对定位。
