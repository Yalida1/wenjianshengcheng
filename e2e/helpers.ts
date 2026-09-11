import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export type StageKey = "requirement" | "feasibility" | "tender" | "contract";

export const SINGLE_EQUIPMENT_SOURCE_FIXTURE = path.resolve(
  "test-results",
  "procurement-fixtures",
  "单一设备采购需求说明样例.docx",
);

export function ensureSingleEquipmentSourceFixture() {
  mkdirSync(path.dirname(SINGLE_EQUIPMENT_SOURCE_FIXTURE), { recursive: true });
  const python =
    process.env.E2E_PYTHON ??
    (process.platform === "win32" ? path.resolve(".venv", "Scripts", "python.exe") : "python");
  const script = [
    "from docx import Document",
    "import sys",
    "d=Document()",
    "d.add_heading('设备采购需求说明', level=1)",
    "d.add_paragraph('项目名称：区域绿色数据中心网络设备采购项目')",
    "d.add_paragraph('独立主招标文件：设备采购招标文件|网络设备供货范围|设备可独立供货、安装调试与验收')",
    "d.add_paragraph('采购包：P1|网络设备采购包|核心交换设备与接入交换设备供货、安装调试和培训')",
    "d.add_paragraph('本材料不包含金额、日期、主体等未确认信息，相关字段由人工确认后方可定稿。')",
    "d.save(sys.argv[1])",
  ].join(";");
  execFileSync(python, ["-c", script, SINGLE_EQUIPMENT_SOURCE_FIXTURE]);
}

const TENDER_FORMAL_FIELDS = {
  tender_number: "NX-E2E-2026-001",
  package_number: "第一标包",
  tenderer: "宁夏示例政务服务中心",
  tender_agency: "不委托招标代理机构",
  tender_method: "公开招标",
  issue_date: "2026-09-08",
  qualification_requirements: "依法设立，具有独立承担民事责任和履行合同所必需的专业能力。",
  joint_venture_policy: "不接受联合体投标。",
  document_acquisition: "2026年9月9日至9月15日登录项目采购平台下载。",
  bid_deadline: "2026-09-29 09:30，电子投标文件应在截止时间前上传。",
  bid_opening: "2026-09-29 09:30，在招标人第一开标室组织线上开标。",
  announcement_media: "中国招标投标公共服务平台和项目采购平台。",
  contact_information: "联系人：张宁；联系电话：0951-0000000。",
  bid_bond: "人民币壹拾万元整，采用银行保函或保险保函。",
  bid_validity: "投标截止之日起90日历天。",
  clarification_rules: "投标人通过项目采购平台提交澄清问题，招标人统一答复。",
  rejection_rules: "资格审查不合格、实质性条款不响应或报价超过最高限价的，否决投标。",
  evaluation_method: "综合评估法",
  evaluation_criteria:
    "1|商务响应|15|0-15|资质、业绩和商务响应完整得15分\n2|技术性能|45|0-45|技术指标按响应程度量化评分\n3|实施与服务|20|0-20|实施、培训和质保方案分档评分\n4|投标报价|20|0-20|价格分按基准价/评审价×20计算",
  tie_break_rule: "综合得分相同时报价低者优先；报价仍相同时技术得分高者优先。",
  general_contract_terms_source: "平台参考模板V1.0，正式发布前由法务锁定标准条款版本。",
  payment_terms: "履约担保后支付30%，到货初验后支付40%，最终验收后支付30%。",
  delivery_period: "60日历天",
  delivery_location: "宁夏回族自治区银川市招标人指定地点",
  acceptance_criteria: "按合同、投标文件和技术规格验收并提交到货、检测、安装和验收材料。",
  warranty_requirements: "最终验收合格之日起36个月原厂质保。",
  procurement_list:
    "1|核心交换设备|2|台|详见技术规格表|实质性\n2|接入交换设备|24|台|详见技术规格表|实质性",
  technical_specifications:
    "1|核心交换设备|交换容量≥25.6Tbps；包转发率≥7200Mpps|实质性|公开资料或检测报告\n2|接入交换设备|48个千兆电口；不少于4个万兆光口|实质性|公开资料",
  installation_requirements: "完成上架、布线、配置、联调和割接。",
  training_requirements: "提供不少于2场现场培训。",
  data_security_requirements: "实施过程不得复制业务数据，配置文件和日志加密传输。",
  interface_requirements: "支持SNMPv3、Syslog和标准网络管理接口。",
  operations_requirements: "质保期内提供7×24小时技术支持。",
};

export const FIELD_VALUES: Record<StageKey, Record<string, unknown>> = {
  requirement: {
    project_name: "宁夏数字政务协同平台 E2E 项目",
    project_owner: "宁夏示例政务服务中心",
    construction_scope: "建设统一事项管理、协同办理和运行分析能力",
    project_period: 18,
  },
  feasibility: {
    project_name: "宁夏数字政务协同平台 E2E 项目",
    total_investment: 12_800_000,
    construction_scope: "建设基础支撑、事项管理、协同办理、数据治理和安全运维体系",
    project_period: 18,
  },
  tender: {
    ...TENDER_FORMAL_FIELDS,
    project_name: "宁夏数字政务协同平台 E2E 项目",
    procurement_budget: 9_800_000,
    maximum_price: 9_500_000,
    procurement_scope: "采购事项管理、协同办理、数据治理软件及实施服务",
  },
  contract: {
    party_a: "宁夏示例政务服务中心",
    party_b: "示例数字科技有限公司",
    contract_subject: "数字政务协同平台软件及实施服务",
    contract_scope: "交付事项管理、协同办理和数据治理软件，完成部署、培训及验收支持",
    final_contract_amount: 9_260_000,
    tax_rate: 6,
    tax_inclusion: "含税总价",
    contract_duration: "合同生效后 12 个月",
    delivery_location: "宁夏回族自治区银川市甲方指定地点",
    payment_plan: [
      { label: "预付款", ratio: 30, amount: 2_778_000, trigger: "合同生效并收到合规发票" },
      { label: "初验款", ratio: 40, amount: 3_704_000, trigger: "系统完成初验" },
      { label: "终验款", ratio: 30, amount: 2_778_000, trigger: "系统完成终验" },
    ],
    acceptance: "按照合同范围、技术要求和双方确认的验收方案组织初验与终验",
    warranty: "终验合格之日起提供十二个月免费质保服务",
    breach: "违约责任按照双方确认的合同条款承担",
    effective_conditions: "双方法定代表人或授权代表签字并加盖公章后生效",
  },
};

export const BUILTIN_ACCEPTANCE_FIELD_VALUES: Record<StageKey, Record<string, unknown>> = {
  requirement: {
    project_name: "测试项目—区域绿色数据中心节能改造",
    project_owner: "甲方测试有限公司",
    construction_scope:
      "制冷系统改造、UPS系统改造、智能配电改造、能源管理平台建设、机房环境监控升级、服务器节能调优、基础设施加固、综合布线优化",
    project_period: 12,
    project_location: "测试市高新区数据中心",
  },
  feasibility: {
    project_name: "测试项目—区域绿色数据中心节能改造",
    total_investment: 12_800_000,
    construction_scope:
      "制冷系统改造、UPS系统改造、智能配电改造、能源管理平台建设、机房环境监控升级、服务器节能调优、基础设施加固、综合布线优化",
    project_period: 12,
    project_location: "测试市高新区数据中心",
  },
  tender: {
    ...TENDER_FORMAL_FIELDS,
    project_name: "测试项目—区域绿色数据中心节能改造",
    procurement_budget: 9_800_000,
    maximum_price: 9_500_000,
    procurement_scope:
      "制冷系统改造、UPS系统改造、智能配电改造、能源管理平台建设、机房环境监控升级、服务器节能调优；不含基础设施加固、综合布线优化和三年运维服务",
    delivery_period: "120日历天",
    delivery_location: "测试市高新区数据中心",
  },
  contract: {
    party_a: "甲方测试有限公司",
    party_b: "乙方测试设备有限公司",
    contract_subject: "区域绿色数据中心节能改造设备采购及实施服务",
    contract_scope:
      "制冷系统改造、UPS系统改造、智能配电改造、能源管理平台建设、机房环境监控升级、服务器节能调优；不含基础设施加固、综合布线优化和三年运维服务",
    final_contract_amount: 9_180_000,
    tax_rate: 13,
    tax_inclusion: "含税总价",
    contract_duration: "110日历天",
    delivery_location: "测试市高新区数据中心",
    payment_plan: [
      { label: "预付款", ratio: 20, amount: 1_836_000, trigger: "合同生效且收到合规发票后" },
      { label: "到货款", ratio: 50, amount: 4_590_000, trigger: "全部设备到货并完成开箱验收后" },
      { label: "验收款", ratio: 25, amount: 2_295_000, trigger: "项目最终验收合格后" },
      {
        label: "质保金",
        ratio: 5,
        amount: 459_000,
        trigger: "36个月质保期届满且无未解决质量问题后",
      },
    ],
    acceptance: "按合同、技术规范和双方确认的测试方案完成验收",
    warranty: "项目最终验收合格之日起36个月",
    breach: "违约方按合同约定承担继续履行、采取补救措施或赔偿损失等责任",
    effective_conditions: "双方法定代表人或授权代表签字并加盖公章后生效",
  },
};

export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("账号").fill("admin");
  await page.getByLabel("密码").fill("admin123");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/projects$/);
}

export async function api<T>(
  page: Page,
  method: "GET" | "POST" | "PATCH" | "PUT",
  path: string,
  body?: unknown,
): Promise<T> {
  return page.evaluate(
    async ({ method, path, body, requestId }) => {
      const csrf = document.cookie
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("docchain_csrf="))
        ?.split("=")[1];
      const response = await fetch(path, {
        method,
        credentials: "include",
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}),
          "X-Request-ID": requestId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      const parsed = text ? JSON.parse(text) : null;
      if (!response.ok) {
        throw new Error(`${response.status} ${parsed?.error?.code ?? "request_failed"}: ${text}`);
      }
      return parsed;
    },
    { method, path, body, requestId: randomUUID() },
  );
}

export async function waitForProcurementPlan(page: Page, projectId: string) {
  // Analysis can take several minutes under verify load; do not only wait for UI auto-confirm.
  await expect
    .poll(
      async () => {
        const analyses = await api<Array<{ status: string; error?: string | null }>>(
          page,
          "GET",
          `/api/v1/projects/${projectId}/procurement-analyses`,
        );
        const latest = analyses[0];
        if (!latest) return "waiting";
        if (latest.status === "failed" || latest.status === "stale") {
          throw new Error(`procurement analysis ${latest.status}: ${latest.error ?? ""}`);
        }
        return ["succeeded", "succeeded_demo"].includes(latest.status) ? "ready" : "waiting";
      },
      { timeout: 300_000 },
    )
    .toBe("ready");

  await expect
    .poll(
      async () => {
        const plans = await api<
          Array<{
            id: string;
            status: string;
            confirmation_blocked: boolean;
            draft_generation_allowed: boolean;
            revision: number;
            procurement_package_count?: number | null;
          }>
        >(page, "GET", `/api/v1/projects/${projectId}/procurement-plans`);
        const plan = plans[0];
        if (!plan) return false;
        if (plan.status === "confirmed" && !plan.confirmation_blocked) {
          return plan.draft_generation_allowed;
        }
        if (plan.confirmation_blocked) {
          throw new Error(`procurement plan confirmation blocked: ${plan.id}`);
        }
        if ((plan.procurement_package_count ?? 0) > 0) {
          await api(page, "POST", `/api/v1/procurement-plans/${plan.id}/ensure-default-grouping`);
          const refreshed = (
            await api<Array<{ id: string; status: string; revision: number }>>(
              page,
              "GET",
              `/api/v1/projects/${projectId}/procurement-plans`,
            )
          )[0];
          if (refreshed && refreshed.status !== "confirmed") {
            await api(page, "POST", `/api/v1/procurement-plans/${refreshed.id}/confirm`, {
              revision: refreshed.revision,
              decision_note: "E2E 自动确认待编制清单（与平台默认一包一套一致）。",
            });
          }
        }
        const after = (
          await api<
            Array<{
              status: string;
              confirmation_blocked: boolean;
              draft_generation_allowed: boolean;
            }>
          >(page, "GET", `/api/v1/projects/${projectId}/procurement-plans`)
        )[0];
        return Boolean(
          after &&
          after.status === "confirmed" &&
          !after.confirmation_blocked &&
          after.draft_generation_allowed,
        );
      },
      { timeout: 120_000 },
    )
    .toBe(true);
}

export async function confirmStageFields(
  page: Page,
  projectId: string,
  stage: StageKey,
  valuesByStage: Record<StageKey, Record<string, unknown>> = FIELD_VALUES,
) {
  const definitions = await api<
    Array<{
      field_key: string;
      field_label: string;
      data_type: string;
      unit: string | null;
      criticality: "P0" | "P1" | "P2";
    }>
  >(page, "GET", `/api/v1/field-definitions?stage=${stage}`);
  const definitionsByKey = new Map(definitions.map((item) => [item.field_key, item]));
  const currentFields = await api<Array<{ id: string; field_key: string; revision: number }>>(
    page,
    "GET",
    `/api/v1/field-values?project_id=${projectId}&stage=${stage}`,
  );
  const currentByKey = new Map(currentFields.map((field) => [field.field_key, field]));
  const values = valuesByStage[stage];

  if (stage === "tender") {
    const applicable = await api<{
      groups: Array<{
        document_group_id: string;
        fields: Array<{ field_key: string; label: string; required: boolean; level: string }>;
      }>;
    }>(page, "GET", `/api/v1/projects/${projectId}/stages/tender/applicable-fields`);
    expect(applicable.groups.length, "tender 未找到适用字段分组").toBeGreaterThan(0);
    for (const group of applicable.groups) {
      for (const applicableField of group.fields) {
        const value = values[applicableField.field_key];
        if (value === undefined) continue;
        const definition = definitionsByKey.get(applicableField.field_key);
        if (!definition) continue;
        const targetKey = `doc::${group.document_group_id}::${applicableField.field_key}`;
        const existing = currentByKey.get(targetKey);
        const field = existing
          ? await api<{ id: string; revision: number }>(
              page,
              "PATCH",
              `/api/v1/field-values/${existing.id}`,
              {
                value,
                normalized_value: value,
                unit: definition.unit,
                status: "missing",
                source_type: "user_input",
                revision: existing.revision,
                evidence: null,
              },
            )
          : await api<{ id: string; revision: number }>(
              page,
              "POST",
              `/api/v1/field-values?project_id=${projectId}&stage=${stage}`,
              {
                field_key: targetKey,
                field_label: applicableField.label || definition.field_label,
                data_type: definition.data_type,
                value,
                normalized_value: value,
                unit: definition.unit,
                criticality:
                  (applicableField.level as "P0" | "P1" | "P2") || definition.criticality,
                status: "missing",
                source_type: "user_input",
                confidence: null,
                evidence: null,
              },
            );
        currentByKey.set(targetKey, field);
        await api(page, "POST", `/api/v1/field-values/${field.id}/confirm`, {
          revision: field.revision,
          evidence_acknowledged: false,
        });
      }
    }
    return;
  }

  for (const definition of definitions) {
    const value = values[definition.field_key];
    if (value === undefined) continue;
    const targetKey = definition.field_key;
    const existing = currentByKey.get(targetKey);
    const field = existing
      ? await api<{ id: string; revision: number }>(
          page,
          "PATCH",
          `/api/v1/field-values/${existing.id}`,
          {
            value,
            normalized_value: value,
            unit: definition.unit,
            status: "missing",
            source_type: "user_input",
            revision: existing.revision,
            evidence: null,
          },
        )
      : await api<{ id: string; revision: number }>(
          page,
          "POST",
          `/api/v1/field-values?project_id=${projectId}&stage=${stage}`,
          {
            field_key: targetKey,
            field_label: definition.field_label,
            data_type: definition.data_type,
            value,
            normalized_value: value,
            unit: definition.unit,
            criticality: definition.criticality,
            status: "missing",
            source_type: "user_input",
            confidence: null,
            evidence: null,
          },
        );
    currentByKey.set(targetKey, field);
    await api(page, "POST", `/api/v1/field-values/${field.id}/confirm`, {
      revision: field.revision,
      evidence_acknowledged: false,
    });
  }
}

export async function chooseStageSource(page: Page, projectId: string, stage: StageKey) {
  await page.goto(`/projects/${projectId}/stages/${stage}/source`);
  if (stage === "contract") {
    const upstreamRadio = page.getByRole("radio", { name: /使用上一阶段定稿文件/ });
    await expect(upstreamRadio).toBeEnabled({ timeout: 30_000 });
    if (!(await upstreamRadio.isChecked())) {
      const saveResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "PUT" &&
          new URL(response.url()).pathname.includes("/source") &&
          response.ok(),
      );
      await upstreamRadio.check();
      await saveResponsePromise;
    }
    await expect(page.getByText(/已绑定上一阶段定稿/)).toBeVisible({ timeout: 30_000 });
    return;
  }
  const uploadedRadio = page.getByRole("radio", { name: /使用采购依据材料|使用用户已有文件/ });
  await expect(uploadedRadio).toBeEnabled({ timeout: 30_000 });
  if (!(await uploadedRadio.isChecked())) {
    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname.includes("/source") &&
        response.ok(),
    );
    await uploadedRadio.check();
    await saveResponsePromise;
  }
  await expect(page.getByText(/已绑定上传文件/)).toBeVisible({ timeout: 30_000 });
}

export async function generateReviewFinalize(
  page: Page,
  projectId: string,
  stage: StageKey,
  exportFormats: boolean,
) {
  await page.goto(`/projects/${projectId}/stages/${stage}/generation`);
  const outlineButton = page.getByRole("button", { name: /生成文档目录|重新生成目录/ });
  await expect(outlineButton).toBeVisible({ timeout: 30_000 });
  await outlineButton.click();
  const selectAll = page.getByRole("checkbox", { name: "全选" });
  await expect(selectAll).toBeVisible({ timeout: 30_000 });
  await selectAll.check();
  if (stage === "tender") {
    const selector = page.getByLabel("生成模板");
    const equipmentOption = selector
      .locator("option")
      .filter({ hasText: "设备采购招标文件适配模板" });
    if ((await equipmentOption.count()) > 0) {
      await selector.selectOption((await equipmentOption.first().getAttribute("value")) ?? "");
      await page.getByRole("button", { name: /重新生成目录|生成文档目录/ }).click();
      await expect(page.getByRole("checkbox", { name: "全选" })).toBeVisible();
      await page.getByRole("checkbox", { name: "全选" }).check();
    }
    await page.getByRole("checkbox", { name: /我已核对采购制度|本次范围同时识别到/ }).check();
  }
  const generationResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/generation-jobs",
  );
  await page.getByRole("button", { name: /生成所选 \d+ 个章节/ }).click();
  const generationResponse = await generationResponsePromise;
  const generationBody = await generationResponse.text();
  expect(generationResponse.status(), generationBody).toBe(202);
  const confirmationLink = page.getByRole("link", { name: /进入文档确认 · V\d+/ });
  await expect(confirmationLink).toBeVisible({
    timeout: 90_000,
  });
  await confirmationLink.click();

  const saveAll = page.getByRole("button", { name: "保存全部并完成审阅" });
  await expect(saveAll).toBeVisible({ timeout: 30_000 });
  await saveAll.click();
  await expect(page.getByText("正文已保存并完成审阅")).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "确认定稿" }).click();
  await expect(page.getByRole("button", { name: "已定稿" })).toBeVisible({ timeout: 90_000 });

  if (exportFormats) {
    await page.getByRole("button", { name: "DOCX" }).click();
    await page.getByRole("button", { name: "PDF" }).click();
    await expect(page.getByRole("link", { name: /下载 DOCX/ })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("link", { name: /下载 PDF/ })).toBeVisible({ timeout: 90_000 });
  }
}
