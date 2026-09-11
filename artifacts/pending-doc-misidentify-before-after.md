# 待编制文件误识别修复 — 示范可研前后对照

样本特征（合成复现，等价于「标准可研含招标包字段映射」审查场景，**未写死北京地铁或固定数量 3**）：

- 正文：`三个采购包：设备采购、安装工程、监理服务。本项目采购包profile为公开招标方式实施。`
- 文件清单表：`包号 | 待编制文件 | 采购属性 | 数量` → P01 / P02 / P03
- 字段映射附录中的负例：`tender_number=招标阶段生成`、`package_number=采购包名称|…`、`acceptance_criteria=可提取|验收指标`
- 包级估算：`可研采购估算` 列（如 218 万元）

## 修复前（原行为）

| 环节 | 结果 |
|------|------|
| 规则通道正文 | `采购包：` 吞汇总段 → 1 个假包；`包p`←profile 假阳性 |
| 规则通道组 | 0 个明确文件组（文件清单当普通采购对象或未识别） |
| 融合默认 | 一包一套 → 按错误包数膨胀（审查复现为 5 套招标文件） |
| StagePage | 解析完成/加载自动 ensure + confirm，冒充用户确认 |
| 金额 seed | `estimated_amount` 灌入 `procurement_budget`（218 万当正式预算） |
| 字段落库 | stage 级扁平键；`resolveGroupFieldValue` 无条件回退 → 串包 |
| 负例字段 | 「招标阶段生成」「可提取」可进入候选值 |

## 修复后（当前分支）

| 环节 | 结果 |
|------|------|
| 规则通道 | 汇总只记 `declared_package_count`；profile 边界不造包；文件清单 → 3 组 P01/P02/P03 |
| 融合 | 无组织证据时 **不造确认组**，保留 `grouping_needs_confirmation` |
| ensure-default | 无显式 `strategy` 为 no-op；需用户点「一包一套 / 合并一套」 |
| StagePage | 去掉自动 confirm；轻量人工确认按钮 |
| 金额 | 估算仅 `estimated_amount`；不填预算/限价 |
| 字段 | `doc::{groupId}::{fieldKey}`；非共享字段禁止 stage 回退 |
| 负例 | 正式来源/处理原则表 → DECISION_REQUIRED，不当正式值 |
| 映射附录 | 按表角色处理，不整附录一刀切 |

## 回归入口

```bash
# 纯函数 / 规则通道 / 融合边界
python -m pytest backend/tests/test_rule_channel_package_id.py \
  backend/tests/test_ensure_default_grouping_unit.py \
  backend/tests/test_field_extraction_scoped.py \
  backend/tests/test_dual_channel_parse.py -q --noconftest

# J/K/L 门禁与历史 heal
python -m pytest backend/tests/test_applicable_gates_and_heal.py -q

# 前端
pnpm exec vitest run src/lib/tenderWorkflow.test.ts src/app/StagePage.test.tsx
```

历史清理：`python -m backend.scripts.heal_pending_doc_misidentify --dry-run`  
说明与回滚：`docs/FIX_PENDING_DOC_MISIDENTIFY.md`

## 未独立验证项

- 原 zip 中实体 DOCX「北京地铁…标准可研…」未在本仓库定位到文件；以上以等价合成样本与既有单元断言为准。
- 完整 `make verify` / Golden Case / 全量 E2E 依赖本地 Docker 与外部资源，本次未声称已整体绿灯。
- 不承诺未经多份独立样本测得的整体识别精确率。
