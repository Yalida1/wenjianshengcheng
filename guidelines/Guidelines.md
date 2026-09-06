# 项目文件链式生成平台 · UI 使用规范

## 01_Foundations

- 主色：`#2E5495`；页面背景：`#F6F8FB`；内容面：`#FFFFFF`。
- 中文系统字体：`PingFang SC`、`Microsoft YaHei`、`Noto Sans CJK SC`；正文 `14/22`。
- 使用 8pt 栅格：页面留白 32px，卡片内边距 24px，控件高 40px，主按钮高 42px。
- 默认圆角：卡片 10–12px、输入框 8px；仅浮层可使用轻阴影。
- 状态必须使用文字（或图标）+ 色彩共同表达：成功、警告、冲突、信息、失败。

## 02_Components

### Button

`Button/Primary`、`Button/Secondary`、`Button/Ghost`、`Button/Danger` 均提供 Default、Hover、Disabled、Loading。一个页面只保留一个 Primary。

### Input 与 FieldRow

Input / Textarea / Select / Date / Money / Percentage 使用 40px 高度。FieldRow 始终显示字段级别、当前值、确认状态与证据入口；冲突采用浅色提示面，不以红色文本代替内容。

### StageCard、EvidenceCard 与 A4DocumentCanvas

StageCard 显示阶段、状态、版本和阻断信息；EvidenceCard 有 Default、Selected、Missing；A4DocumentCanvas 有 Default、Editing、Validating。正文画布不得被侧栏压缩到不可读宽度。

### Drawer

Drawer 默认关闭，仅在查看证据、AI 建议或辅助信息时开启。工作台保持 72px 全局导航与可折叠业务目录。

## Do / Don't

- Do：先显示用户要完成的工作，再按需展开来源和证据。
- Do：用状态徽标标注“待确认”“存在冲突”“已定稿”。
- Don't：不要并排永久展示目录、字段、证据和正文。
- Don't：不要把 AI 建议伪装为已确认值，或为一个页面提供多个同级主操作。
