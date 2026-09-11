from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

PENDING_MARKER = "【待确认】"


@dataclass(frozen=True)
class TenderBlockSpec:
    block_type: str
    content: dict[str, Any]
    source_kind: str = "template_reference"
    field_refs: tuple[str, ...] = ()
    reviewed: bool = False


def _display(value: object) -> str:
    if value in (None, "", [], {}):
        return PENDING_MARKER
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, (int, float, Decimal)):
        return f"{value:,}"
    if isinstance(value, list):
        return "；".join(_display(item) for item in value)
    if isinstance(value, dict):
        return "；".join(f"{key}：{_display(item)}" for key, item in value.items())
    return str(value).strip() or PENDING_MARKER


def field_value(fields: dict[str, Any], key: str, *, unit: str | None = None) -> str:
    result = _display(fields.get(key))
    if result == PENDING_MARKER or not unit:
        return result
    if unit == "元":
        try:
            return f"{Decimal(str(fields[key])):,.2f} 元"
        except (InvalidOperation, TypeError, ValueError):
            return f"{result} 元"
    return result if result.endswith(unit) else f"{result}{unit}"


def _inline_value(value: str) -> str:
    if value == PENDING_MARKER:
        return value
    return re.sub(r"[。；;，,\s]+$", "", value)


def _field_present(fields: dict[str, Any], key: str) -> bool:
    """True when generation snapshot carries a real value for this key.

    Non-applicable / unconfirmed optional fields must not inject 【待确认】 into prose.
    """
    return key in fields and fields.get(key) not in (None, "", [], {})


def _join_clauses(clauses: list[str]) -> str:
    cleaned = [clause.strip().rstrip("。；;") for clause in clauses if clause and clause.strip()]
    return "；".join(cleaned) + "。" if cleaned else ""


def _paragraph(text: str, *field_refs: str, source_kind: str = "template_reference") -> TenderBlockSpec:
    return TenderBlockSpec(
        block_type="paragraph",
        content={"text": text},
        source_kind=source_kind,
        field_refs=field_refs,
    )


def _table(
    caption: str,
    headers: list[str],
    rows: list[list[str]],
    *field_refs: str,
    widths: list[float] | None = None,
) -> TenderBlockSpec:
    return TenderBlockSpec(
        block_type="table",
        content={
            "caption": caption,
            "headers": headers,
            "rows": rows,
            "column_widths": widths or [],
        },
        source_kind="confirmed_field" if field_refs else "template_reference",
        field_refs=field_refs,
    )


def _pipe_rows(raw: object, columns: int, fallback: list[list[str]]) -> list[list[str]]:
    if not isinstance(raw, str) or not raw.strip():
        return fallback
    rows: list[list[str]] = []
    for line in raw.splitlines():
        values = [item.strip() for item in line.split("|")]
        if not any(values):
            continue
        rows.append((values + [""] * columns)[:columns])
    return rows or fallback


def tender_notice_title(method: object) -> str:
    normalized = str(method or "").strip().lower()
    if normalized in {"invited_tender", "invitation", "邀请招标", "邀请"}:
        return "投标邀请书"
    if normalized in {"public_tender", "open_tender", "公开招标", "公开"}:
        return "招标公告"
    return "招标公告或投标邀请书"


def tender_blocks_for_section(
    key: str,
    fields: dict[str, Any],
    *,
    source_context: list[str] | None = None,
) -> list[TenderBlockSpec]:
    project = field_value(fields, "project_name")
    number = field_value(fields, "tender_number")
    package = field_value(fields, "package_number")
    tenderer = field_value(fields, "tenderer")
    agency = field_value(fields, "tender_agency")
    budget = field_value(fields, "procurement_budget", unit="元")
    ceiling = field_value(fields, "maximum_price", unit="元")
    scope = _inline_value(field_value(fields, "procurement_scope"))
    method = field_value(fields, "tender_method")
    qualification = _inline_value(field_value(fields, "qualification_requirements"))
    joint_venture = _inline_value(field_value(fields, "joint_venture_policy"))
    acquisition = _inline_value(field_value(fields, "document_acquisition"))
    deadline = _inline_value(field_value(fields, "bid_deadline"))
    opening = _inline_value(field_value(fields, "bid_opening"))
    media = _inline_value(field_value(fields, "announcement_media"))
    contact = _inline_value(field_value(fields, "contact_information"))
    bond = _inline_value(field_value(fields, "bid_bond"))
    validity = _inline_value(field_value(fields, "bid_validity"))
    clarification = _inline_value(field_value(fields, "clarification_rules"))
    rejection = _inline_value(field_value(fields, "rejection_rules"))
    evaluation_method = field_value(fields, "evaluation_method")
    tie_break = _inline_value(field_value(fields, "tie_break_rule"))
    delivery_period = _inline_value(field_value(fields, "delivery_period"))
    delivery_location = _inline_value(field_value(fields, "delivery_location"))
    payment = _inline_value(field_value(fields, "payment_terms"))
    acceptance = _inline_value(field_value(fields, "acceptance_criteria"))
    warranty = _inline_value(field_value(fields, "warranty_requirements"))
    installation = _inline_value(field_value(fields, "installation_requirements"))
    training = _inline_value(field_value(fields, "training_requirements"))
    data_security = _inline_value(field_value(fields, "data_security_requirements"))
    interfaces = _inline_value(field_value(fields, "interface_requirements"))
    operations = _inline_value(field_value(fields, "operations_requirements"))

    if key in {
        "announcement",
        "procurement_announcement",
        "instructions",
        "evaluation",
        "contract_terms",
        "requirements",
        "bid_format",
    }:
        intros = {
            "announcement": (
                f"本章载明{project}的招标条件、项目概况、投标资格和投标安排。招标方式为{method}。"
            ),
            "procurement_announcement": (
                f"本章载明{project}的采购条件、项目概况、投标资格和投标安排。采购方式为{method}。"
            ),
            "instructions": (
                "本章由投标人须知前附表和投标人须知正文组成。"
                "前附表与正文不一致时，按锁定模板载明的适用规则执行。"
            ),
            "evaluation": f"本章载明资格审查、符合性审查和详细评审标准。本项目采用{evaluation_method}。",
            "contract_terms": (
                "本章由合同协议书、通用合同条款、专用合同条款及合同附件格式组成。"
                "最终合同金额以采购结果及后续合同要素确认为准。"
            ),
            "requirements": (
                f"本章采购需求严格限定在已确认范围内：{scope}。项目全部建设范围不自动等同本次采购范围。"
            ),
            "bid_format": (
                "本章表格由投标人据实填写并按要求签署、盖章。不得改变实质性响应内容或删除必填项目。"
            ),
        }
        return [
            _paragraph(intros[key], "project_name", "tender_method", "evaluation_method", "procurement_scope")
        ]

    paragraphs: dict[str, tuple[str, tuple[str, ...]]] = {
        "announcement_conditions": (
            f"{project}的招标人为{tenderer}，招标代理机构为{agency}。项目资金和招标条件应以已经确认的立项、资金及采购审批资料为依据。",
            ("project_name", "tenderer", "tender_agency"),
        ),
        "announcement_overview": (
            f"项目名称：{project}；招标编号：{number}；标段或包号：{package}；招标方式：{method}。",
            ("project_name", "tender_number", "package_number", "tender_method"),
        ),
        "announcement_scope": (f"招标范围：{scope}。", ("procurement_scope",)),
        "announcement_budget": (
            f"招标预算为{budget}，最高投标限价为{ceiling}。投标报价超过最高投标限价的，按招标文件载明的规则处理。",
            ("procurement_budget", "maximum_price"),
        ),
        "announcement_qualification": (f"投标人资格要求：{qualification}。", ("qualification_requirements",)),
        "announcement_joint_venture": (f"联合体投标政策：{joint_venture}。", ("joint_venture_policy",)),
        "announcement_acquisition": (f"招标文件获取安排：{acquisition}。", ("document_acquisition",)),
        "announcement_deadline": (
            f"投标截止安排：{deadline}。开标安排：{opening}。",
            ("bid_deadline", "bid_opening"),
        ),
        "announcement_media": (f"公告发布媒介：{media}。", ("announcement_media",)),
        "announcement_contact": (
            f"招标人：{tenderer}；招标代理机构：{agency}；联系方式：{contact}。",
            ("tenderer", "tender_agency", "contact_information"),
        ),
        "instructions_general": (
            f"投标人应对本项目进行独立判断并承担投标责任。招标范围为{scope}，未经书面澄清不得扩大或缩减实质性响应边界。",
            ("procurement_scope",),
        ),
        "instructions_documents": (
            f"投标人应完整阅读招标文件及其澄清、修改文件。澄清和修改规则：{clarification}。",
            ("clarification_rules",),
        ),
        "instructions_bid": (
            f"投标有效期：{validity}；投标保证金：{bond}；投标报价不得超过最高投标限价{ceiling}。",
            ("bid_validity", "bid_bond", "maximum_price"),
        ),
        "instructions_opening": (
            f"投标截止安排为：{deadline}；开标安排为：{opening}。"
            "投标人应按照前附表完成签章、加密、上传或现场递交。",
            ("bid_deadline", "bid_opening"),
        ),
        "instructions_rejection": (f"否决投标条件：{rejection}。", ("rejection_rules",)),
        "instructions_appendix": (
            "本章附表包括开标记录、问题澄清通知、问题澄清、确认通知等程序性表格，使用时按招标方式和电子交易平台规则取舍。",
            (),
        ),
        "evaluation_procedure": (
            f"评标委员会按照资格审查、符合性审查和详细评审顺序开展评审，采用{evaluation_method}形成评审结果。",
            ("evaluation_method",),
        ),
        "evaluation_rejection": (f"评审阶段否决投标条件：{rejection}。", ("rejection_rules",)),
        "evaluation_tie_break": (f"综合得分相同时的处理规则：{tie_break}。", ("tie_break_rule",)),
        "agreement_form": (
            f"合同协议书应载明项目名称{project}、合同标的、合同价款、履行期限和双方完整法律主体。合同价款不得由招标预算或最高投标限价自动带入。",
            ("project_name",),
        ),
        "general_terms": (
            "本通用合同条款适用于合同货物、伴随服务及相关履约活动。合同当事人应按照诚实信用原则履行通知、协作、保密和风险防控义务。",
            (),
        ),
        "special_terms": (
            f"专用合同条款应结合项目明确付款、交付、验收、质保、违约和争议解决。付款条件：{payment}；交付期限：{delivery_period}；交付地点：{delivery_location}。",
            ("payment_terms", "delivery_period", "delivery_location"),
        ),
        "performance_guarantee": (
            f"履约担保的形式、金额、提交时间、有效期及退还条件按专用合同条款执行。与投标保证金有关的已确认要求为：{bond}。",
            ("bid_bond",),
        ),
        "payment_delivery_acceptance": (
            f"付款条件：{payment}；交付期限：{delivery_period}；交付地点：{delivery_location}；验收标准及材料：{acceptance}。",
            ("payment_terms", "delivery_period", "delivery_location", "acceptance_criteria"),
        ),
        "warranty_breach_dispute": (
            f"质保及售后要求：{warranty}。任何一方不履行或不适当履行合同义务的，应承担继续履行、采取补救措施或赔偿损失等违约责任。",
            ("warranty_requirements",),
        ),
        "contract_appendices": (
            "合同附件格式包括供货清单、技术协议、履约担保、验收记录、售后服务承诺及双方确认的其他附件。",
            (),
        ),
        "requirements_scope": (f"采购范围：{scope}。", ("procurement_scope",)),
        "requirements_delivery": (
            _join_clauses(
                [
                    f"交付地点：{delivery_location}",
                    f"交付期限：{delivery_period}",
                    *(
                        [f"安装调试要求：{installation}"]
                        if _field_present(fields, "installation_requirements")
                        else []
                    ),
                    *(
                        [f"培训要求：{training}"]
                        if _field_present(fields, "training_requirements")
                        else []
                    ),
                ]
            ),
            tuple(
                key
                for key in (
                    "delivery_location",
                    "delivery_period",
                    "installation_requirements",
                    "training_requirements",
                )
                if key in {"delivery_location", "delivery_period"} or _field_present(fields, key)
            ),
        ),
        "requirements_acceptance": (
            f"验收标准、程序和验收材料：{acceptance}。投标人应提交设备清单、测试记录、合格证明和招标文件要求的其他材料。",
            ("acceptance_criteria",),
        ),
        "requirements_warranty": (
            _join_clauses(
                [
                    f"质保及售后服务：{warranty}",
                    *(
                        [f"运维服务要求：{operations}"]
                        if _field_present(fields, "operations_requirements")
                        else []
                    ),
                ]
            ),
            tuple(
                key
                for key in ("warranty_requirements", "operations_requirements")
                if key == "warranty_requirements" or _field_present(fields, key)
            ),
        ),
        "requirements_security": (
            (
                _join_clauses(
                    [
                        *(
                            [f"数据与安全要求：{data_security}"]
                            if _field_present(fields, "data_security_requirements")
                            else []
                        ),
                        *(
                            [f"接口要求：{interfaces}"]
                            if _field_present(fields, "interface_requirements")
                            else []
                        ),
                    ]
                )
                or "数据安全与系统接口要求按照技术规格书及合同约定执行。"
            ),
            tuple(
                key
                for key in ("data_security_requirements", "interface_requirements")
                if _field_present(fields, key)
            ),
        ),
        "bid_letter": (
            f"投标函应明确响应{project}（招标编号{number}、标段或包号{package}），载明投标总价、交付期、投标有效期和签署日期。",
            ("project_name", "tender_number", "package_number"),
        ),
        "legal_representative": (
            "法定代表人身份证明应由投标人填写单位名称、人员姓名和身份证明信息，并附有效证明材料。",
            (),
        ),
        "authorization": (
            "授权委托书应载明授权范围、期限、代理人身份信息，并由法定代表人和委托代理人按格式签署。",
            (),
        ),
        "qualification_index": (
            "资格证明文件应按资格审查表顺序编制目录，并逐项标明证明材料名称及所在页码。",
            (),
        ),
        "service_plan": (
            "服务方案应围绕供货组织、安装调试、培训、验收、质保、售后及风险响应逐项作出实质性说明。",
            (),
        ),
        "commitment": ("投标人应按招标文件要求提交真实性、廉洁、保密、售后服务及其他项目承诺函。", ()),
    }

    paragraph_expansions: dict[str, list[tuple[str, tuple[str, ...]]]] = {
        "announcement_conditions": [
            (
                "招标人负责本项目招标活动的组织和决策，招标代理机构在委托范围内办理公告发布、文件发售、答疑澄清和开评标组织等事项。各方不得以任何方式规避招标程序或改变已经批准的采购边界。",
                (),
            ),
            (
                "项目资金来源、落实情况和采购审批结论应以来源文件为准。未取得有效来源证据或人工确认的资金、主体和审批信息，不作为投标人报价及履约安排的依据。",
                (),
            ),
        ],
        "announcement_overview": [
            (
                f"本次招标以{package}为独立投标和评审单元。投标人应对所投标段或包号内的全部实质性内容作出响应，不得仅对其中部分内容选择性报价，招标文件另有明确规定的除外。",
                ("package_number",),
            ),
            (
                "项目名称、编号、标段或包号是投标文件编制、递交、开标记录和合同归档的识别依据。投标人应在投标函、报价表及资格证明文件中保持上述标识一致。",
                (),
            ),
        ],
        "announcement_scope": [
            (
                f"本次采购边界为：{scope}。除招标文件明确列入的货物、服务和伴随工作外，项目其他建设内容不因与本项目相关而自动纳入本标段。",
                ("procurement_scope",),
            ),
            (
                "投标报价应覆盖完成采购范围所需的供货、运输、保险、安装、调试、培训、验收配合、质保服务及税费等可预见费用。对范围边界存在疑问的，投标人应在规定期限内提出澄清。",
                (),
            ),
        ],
        "announcement_budget": [
            (
                "预算金额用于采购组织和资金控制，最高投标限价用于判定报价是否有效，两者不等同于最终合同价。最终合同价以采购结果和依法签订的合同为准。",
                (),
            ),
            (
                f"投标人的总价及各分项报价均应真实、完整且口径一致。任何报价超过最高投标限价{ceiling}的，按照否决投标条款处理。",
                ("maximum_price",),
            ),
        ],
        "announcement_qualification": [
            (
                "投标人应在投标文件中逐项提供资格证明材料，并保证材料在投标截止时间处于有效状态。复印件、扫描件、电子证照和原件核验要求按投标人须知前附表执行。",
                (),
            ),
            (
                "资格条件不得通过项目业绩、人员配置或技术响应材料替代，招标文件明确允许等效证明的除外。资格证明缺失、无效或不符合要求的，按资格审查标准处理。",
                (),
            ),
        ],
        "announcement_joint_venture": [
            (
                "允许联合体投标时，联合体各方应签订共同投标协议，明确牵头人、职责分工和责任承担，并不得再以自己名义或参加其他联合体投标。联合体资格按招标文件载明的合并或分别认定规则审查。",
                (),
            ),
            (
                "不接受联合体投标时，两个以上法人或其他组织不得以共同名义提交一份投标文件。分包、协作不当然构成联合体，但不得用于规避投标人资格条件和实质性履约义务。",
                (),
            ),
        ],
        "announcement_acquisition": [
            (
                "潜在投标人应按规定完成登记、身份验证和文件费用支付，并自行确认取得的招标文件版本完整有效。未按规定获取招标文件可能导致无法递交或投标无效的，相关风险由投标人承担。",
                (),
            ),
            (
                "招标文件的澄清、修改和补充文件与原招标文件具有同等效力。内容不一致时，以发出时间在后的有效文件为准。",
                (),
            ),
        ],
        "announcement_deadline": [
            (
                "投标人应预留完成签章、加密、上传或现场递交所需时间。因投标人自身原因造成逾期、文件损坏、无法解密或未送达指定地点的，招标人不予接收。",
                (),
            ),
            (
                "投标截止时间发生依法调整时，招标人将按公告和文件获取渠道发布通知。开标时间、地点或电子交易平台安排相应顺延或调整。",
                (),
            ),
        ],
        "announcement_media": [
            (
                "公告、更正公告和依法应当公开的结果信息应在规定媒介发布。不同媒介内容不一致时，按适用法规和招标文件明确的效力规则处理。",
                (),
            ),
        ],
        "announcement_contact": [
            (
                "潜在投标人就招标文件提出问题时，应使用规定渠道并注明项目名称、招标编号和所投标段或包号。口头咨询答复不构成招标文件组成部分。",
                (),
            ),
        ],
        "instructions_general": [
            (
                "投标人参加投标所发生的准备、编制、递交和现场活动费用由投标人自行承担。招标人不因招标终止、失败或投标文件未被接受而承担投标成本，依法应承担责任的情形除外。",
                (),
            ),
            (
                "投标人不得串通投标、弄虚作假、行贿或以其他违法方式谋取中标。投标人及其关联方参加同一标段投标的限制，按照适用法规和资格审查标准执行。",
                (),
            ),
            (
                "投标人在获取招标文件和参与招标过程中知悉的非公开信息，应仅用于本项目投标。涉及数据、安全和保密的信息不得擅自复制、传播或用于其他目的。",
                (),
            ),
        ],
        "instructions_documents": [
            (
                "招标文件包括公告或邀请书、投标人须知、评标办法、合同条款及格式、采购要求、投标文件格式，以及依法发出的澄清和修改文件。投标人应核对文件页数、附件和版本信息。",
                (),
            ),
            (
                "投标人认为招标文件存在含义不清、相互矛盾或可能影响投标的问题，应按规定期限和形式提出。未在规定期限提出不影响投标人依法享有的权利，但投标人不得自行改变文件要求。",
                (),
            ),
            (
                "澄清或修改可能影响投标文件编制的，招标人将依法顺延投标截止时间。投标人应及时查收并确认，因未关注有效发布渠道造成的后果由投标人承担。",
                (),
            ),
        ],
        "instructions_bid": [
            (
                "投标文件应由投标函、资格证明、商务文件、技术文件、报价文件和招标文件要求的其他材料组成。各组成部分应相互一致并可追溯到对应条款。",
                (),
            ),
            (
                "投标报价应采用招标文件规定的币种、计价口径和税费口径。总价与分项价、数字金额与大写金额不一致时，按照评标办法规定的修正规则处理。",
                (),
            ),
            (
                "投标有效期自投标截止之日起计算。在有效期内，投标人不得撤销投标文件或拒绝依法要求的澄清、签约和履约担保义务。",
                (),
            ),
            (
                "投标文件应由有权签署人签字或盖章，并按照规定装订、加密或密封。涂改、增删处应由有权签署人确认，电子投标文件按交易平台签章规则执行。",
                (),
            ),
        ],
        "instructions_opening": [
            (
                "投标人在投标截止时间前可以按照规定补充、修改或撤回已递交的投标文件。补充和修改内容为投标文件组成部分，并应采用与原文件相同的签署、加密或密封要求。",
                (),
            ),
            (
                "开标时公布投标人名称、投标报价和招标文件规定的其他主要内容，并形成开标记录。投标人对开标过程有异议的，应在规定时间内当场或通过电子交易系统提出。",
                (),
            ),
            (
                "评标委员会可以要求投标人对含义不明确、同类问题表述不一致或有明显文字和计算错误的内容作必要澄清。澄清不得超出投标文件范围或改变实质性内容。",
                (),
            ),
        ],
        "instructions_rejection": [
            (
                "否决投标应以法律法规和招标文件明确载明的条件为依据。评审人员不得新增未在招标文件中公开的否决条件，不得以非实质性格式偏差替代实质性审查。",
                (),
            ),
            (
                "投标被否决的，评标记录应载明对应条款、事实依据和审查结论。投标人依法提出异议或投诉的，按照规定渠道和期限办理。",
                (),
            ),
        ],
        "instructions_appendix": [
            (
                "附表由招标人、招标代理机构、评标委员会或投标人按使用场景填写。采用电子交易的，系统生成记录与纸质附表具有对应关系，并应纳入项目档案。",
                (),
            ),
        ],
        "evaluation_procedure": [
            (
                "评标委员会首先核验投标文件的基本信息和递交状态，再依次开展资格审查和符合性审查。前一环节未通过的投标文件不进入后续详细评审。",
                (),
            ),
            (
                "详细评审按照评审因素、分值、评分区间和量化标准独立评分。评审因素未在招标文件中载明的，不得作为加分、扣分或排序依据。",
                (),
            ),
            (
                "需要进行算术修正、价格折算或异常低价核查的，应按照评标办法统一处理并形成记录。投标人不接受依法作出的算术修正时，按招标文件规定处理。",
                (),
            ),
            (
                "评标委员会汇总有效评分，形成评标报告和中标候选人排序。评标报告应记录审查结论、评分明细、澄清事项和需要说明的不同意见。",
                (),
            ),
        ],
        "evaluation_rejection": [
            (
                "资格证明无效、投标文件未按要求签署、报价超过最高投标限价、未响应实质性要求或存在法律法规规定的其他否决情形时，按对应审查表作否决处理。",
                (),
            ),
            (
                "同一事实不得在资格审查、符合性审查和详细评审中重复作不利评价。否决结论应经评标委员会确认并在评标报告中说明。",
                (),
            ),
        ],
        "evaluation_tie_break": [
            (
                "同分处理仅在综合得分按照规定精度计算后仍相同的投标人之间适用。排序过程应保留计算依据和比较记录，不得临时增加未公开的排序因素。",
                (),
            ),
        ],
        "general_terms": [
            (
                "合同文件由合同协议书、中标通知书、投标函及其附录、专用合同条款、通用合同条款、技术要求、报价清单和双方确认的其他文件组成。文件之间存在不一致时，按照合同约定的解释顺序处理。",
                (),
            ),
            (
                "卖方应提供全新、合格且权属清晰的货物和服务，并保证其符合合同约定的规格、数量、质量和知识产权要求。买方应按合同提供必要条件并完成到货确认、验收和付款审批。",
                (),
            ),
            (
                "货物包装、运输、保险、保管和风险转移按照专用合同条款执行。货物在风险转移前毁损、灭失的，由承担风险的一方负责补足、更换或赔偿。",
                (),
            ),
            (
                "买方有权依据合同开展出厂检验、到货验收、安装调试验收和最终验收。检验或付款不免除卖方对隐蔽缺陷、质量保证和违约责任的承担。",
                (),
            ),
            (
                "因不可预见、不可避免且不可克服的事件影响履约时，受影响方应及时通知并提供证明，同时采取合理措施减少损失。双方根据事件影响协商延期履行、部分免除责任或解除合同。",
                (),
            ),
            (
                "双方对履约中知悉的商业秘密、个人信息和受保护数据承担保密义务。未经权利人书面同意，不得超出合同目的使用或向第三方披露。",
                (),
            ),
        ],
        "special_terms": [
            (
                "专用合同条款是对通用合同条款的项目化补充。专用条款不得将采购范围扩大为项目全部建设范围，也不得将招标预算或最高投标限价直接约定为合同价。",
                (),
            ),
            (
                f"卖方应按照{delivery_period}完成供货及相关服务，并将合同标的交付至{delivery_location}。需要分批交付的，应在合同清单中列明批次、数量、到货条件和阶段验收要求。",
                ("delivery_period", "delivery_location"),
            ),
            (
                f"合同付款按照以下条件办理：{payment}。每次付款前，卖方应提交对应发票、付款申请、验收或进度证明以及合同要求的其他材料。",
                ("payment_terms",),
            ),
        ],
        "performance_guarantee": [
            (
                "要求提交履约担保的，中标人应在合同约定期限内按规定形式和金额提交。履约担保应覆盖交付、安装调试、验收及合同约定的其他关键义务。",
                (),
            ),
            (
                "履约担保有效期不足时，卖方应在到期前办理延长。合同义务完成并满足退还条件后，买方按约定期限办理退还或解除。",
                (),
            ),
        ],
        "payment_delivery_acceptance": [
            (
                "到货时双方应核对包装、数量、型号、外观、随机资料和运输状态，并形成到货记录。到货签收仅证明货物已接收，不代表质量和性能验收合格。",
                (),
            ),
            (
                "安装调试完成后，卖方应提交验收申请和完整验收材料。买方依据技术规格、投标响应、合同和适用标准组织测试，验收结论由双方有权人员确认。",
                (),
            ),
            (
                "验收不合格的，卖方应在规定期限内完成修复、更换或补充并再次申请验收。由此发生的费用和工期责任按照合同约定承担。",
                (),
            ),
        ],
        "warranty_breach_dispute": [
            (
                "质保期内发生故障或缺陷时，卖方应按照约定响应、到场、修复或更换。维修、更换不应降低原技术标准，并应形成可追溯的服务记录。",
                (),
            ),
            (
                "逾期交付、质量不合格、拒绝履行售后义务、违反保密或数据安全要求的，违约方应按专用合同条款承担违约金、赔偿损失或其他责任。",
                (),
            ),
            (
                "履约争议发生后，双方应先通过协商处理；协商不成的，按照专用合同条款确定的仲裁或诉讼方式解决。争议期间，不涉及争议的合同义务应继续履行。",
                (),
            ),
        ],
        "contract_appendices": [
            (
                "合同附件与合同正文具有同等法律效力。附件应标明名称、版本、页数和签署状态，技术协议、供货清单和报价清单之间的数据应保持一致。",
                (),
            ),
            (
                "合同履行中形成的变更单、验收记录、培训记录和售后服务记录，应由双方有权人员确认并归档。任何变更不得以口头约定替代书面程序。",
                (),
            ),
        ],
        "requirements_scope": [
            (
                "投标人应按采购清单提供完整产品、许可、配件和伴随服务，并保证各组成部分能够协同运行。为实现明确功能所必需且报价表要求包含的工作，应纳入投标总价。",
                (),
            ),
            (
                "涉及既有系统、机房环境或第三方接口的，投标人应在投标前结合已提供资料评估实施条件。需要招标人或第三方配合的事项，应在技术响应中明确说明。",
                (),
            ),
        ],
        "requirements_delivery": [
            (
                "交付计划应列明设备采购、生产或备货、运输、到货、安装、配置、联调、试运行和验收节点。投标人应说明关键路径、资源投入和延期风险控制措施。",
                (),
            ),
            (
                "安装调试应符合现场管理、安全生产、网络变更和业务连续性要求。涉及业务割接的，应提交经确认的实施方案、回退方案和应急联系人清单。",
                (),
            ),
            (
                "培训应覆盖设备操作、系统管理、日常巡检、故障处置和配置备份恢复。培训完成后应提交签到记录、培训材料和培训效果确认文件。",
                (),
            ),
        ],
        "requirements_acceptance": [
            (
                "验收分为到货核验、安装调试验收和最终验收。每一阶段的验收对象、测试方法、合格标准、参加人员和输出材料应形成记录。",
                (),
            ),
            (
                "技术指标应逐项测试或核验证明材料，标注为实质性的要求必须全部满足。不能现场测试的指标，应提交制造商公开资料、检测报告或招标文件认可的等效证据。",
                (),
            ),
            (
                "最终验收材料至少包括到货清单、序列号或许可清单、安装配置记录、测试报告、问题整改记录、培训记录和验收报告。材料不完整时，招标人有权要求补充。",
                (),
            ),
        ],
        "requirements_warranty": [
            (
                "质保期自最终验收合格之日起计算。质保期内的维修、更换、升级和技术支持费用应包含在投标报价中，因人为或不可抗力造成的损坏按合同约定处理。",
                (),
            ),
            (
                "售后服务应建立统一受理、分级响应、升级处置和闭环回访机制。重大故障应提供临时恢复措施，并在修复后提交原因分析和预防措施。",
                (),
            ),
        ],
        "requirements_security": [
            (
                "投标产品和实施工具不得设置未经授权的远程访问、后门账户或数据外传功能。默认口令应在交付前修改，管理权限应按最小授权原则配置。",
                (),
            ),
            (
                "配置文件、日志、备份和测试数据应按照招标人的安全要求存储、传输和移交。未经书面同意，不得将业务数据复制到境外、个人设备或非授权环境。",
                (),
            ),
            (
                "接口联调应使用双方确认的协议、字段、认证方式和变更流程。接口异常不得影响既有系统稳定运行，实施前应完成备份并具备可验证的回退能力。",
                (),
            ),
        ],
    }

    fillable_forms: dict[str, tuple[str, list[str], list[list[str]], tuple[str, ...]]] = {
        "agreement_form": (
            "合同协议书",
            ["协议要素", "签约时填写内容"],
            [
                ["项目名称", project],
                ["招标编号及包号", f"{number}；{package}"],
                ["买方（甲方）", "采购结果确定后填写"],
                ["卖方（乙方）", "采购结果确定后填写"],
                ["合同标的", "采购结果确定后填写"],
                ["合同价款", "采购结果确定后填写，不得从预算或最高限价自动带入"],
                ["履行期限", "采购结果确定后填写"],
                ["签署日期及地点", "双方签约时填写"],
            ],
            ("project_name", "tender_number", "package_number"),
        ),
        "bid_letter": (
            "投标函",
            ["投标函项目", "投标人填写内容"],
            [
                ["项目名称", project],
                ["招标编号及包号", f"{number}；{package}"],
                ["投标总价", "投标人填写（大写及小写）"],
                ["交付期", "投标人填写"],
                ["投标有效期", "投标人填写"],
                ["投标人名称", "投标人填写并盖章"],
                ["法定代表人或委托代理人", "签字或盖章"],
                ["日期", "投标人填写"],
            ],
            ("project_name", "tender_number", "package_number"),
        ),
        "legal_representative": (
            "法定代表人身份证明",
            ["证明事项", "投标人填写内容"],
            [
                ["投标人名称", "投标人填写并盖章"],
                ["单位性质及地址", "投标人填写"],
                ["成立时间", "投标人填写"],
                ["法定代表人姓名及职务", "投标人填写"],
                ["身份证件类型及号码", "投标人填写"],
                ["证明材料", "附身份证件复印件及有效主体证明"],
                ["日期", "投标人填写"],
            ],
            (),
        ),
        "authorization": (
            "授权委托书",
            ["授权事项", "投标人填写内容"],
            [
                ["投标人名称", "投标人填写并盖章"],
                ["法定代表人", "姓名、身份证件类型及号码"],
                ["委托代理人", "姓名、身份证件类型及号码"],
                ["授权范围", "明确办理投标、澄清、签署等权限"],
                ["授权期限", "投标人填写"],
                ["双方签署", "法定代表人和委托代理人签字或盖章"],
                ["日期", "投标人填写"],
            ],
            (),
        ),
        "qualification_index": (
            "资格证明文件目录",
            ["序号", "证明材料名称", "对应资格条件", "所在页码", "备注"],
            [
                ["1", "主体资格证明", "资格审查表第1项", "投标人填写", ""],
                ["2", "法定代表人身份证明或授权委托书", "资格审查表第2项", "投标人填写", ""],
                ["3", "联合体材料（如适用）", "资格审查表第3项", "投标人填写", ""],
                ["4", "其他资格证明", "资格审查表第4项", "投标人填写", ""],
            ],
            (),
        ),
        "service_plan": (
            "服务方案",
            ["序号", "方案章节", "投标人响应及所在页码"],
            [
                ["1", "供货组织与进度计划", "投标人填写"],
                ["2", "安装、调试与割接方案", "投标人填写"],
                ["3", "培训与知识转移方案", "投标人填写"],
                ["4", "验收配合与材料提交方案", "投标人填写"],
                ["5", "质保、售后与故障响应方案", "投标人填写"],
                ["6", "风险控制与应急预案", "投标人填写"],
            ],
            (),
        ),
        "commitment": (
            "承诺函",
            ["承诺事项", "投标人承诺及签署"],
            [
                ["投标材料真实性", "投标人填写并承诺"],
                ["廉洁投标", "投标人填写并承诺"],
                ["保密与数据安全", "投标人填写并承诺"],
                ["质保与售后服务", "投标人填写并承诺"],
                ["其他项目承诺", "投标人填写"],
                ["投标人名称、签章及日期", "投标人填写"],
            ],
            (),
        ),
    }
    if key in fillable_forms:
        caption, headers, rows, refs = fillable_forms[key]
        blocks: list[TenderBlockSpec] = []
        if key in paragraphs:
            text, paragraph_refs = paragraphs[key]
            blocks.append(
                _paragraph(
                    text,
                    *paragraph_refs,
                    source_kind="confirmed_field" if paragraph_refs else "template_reference",
                )
            )
            blocks.extend(
                _paragraph(
                    extra_text,
                    *extra_refs,
                    source_kind="confirmed_field" if extra_refs else "template_reference",
                )
                for extra_text, extra_refs in paragraph_expansions.get(key, [])
            )
        blocks.append(_table(caption, headers, rows, *refs))
        return blocks

    if key in paragraphs:
        text, refs = paragraphs[key]
        blocks = [_paragraph(text, *refs, source_kind="confirmed_field" if refs else "template_reference")]
        blocks.extend(
            _paragraph(
                extra_text,
                *extra_refs,
                source_kind="confirmed_field" if extra_refs else "template_reference",
            )
            for extra_text, extra_refs in paragraph_expansions.get(key, [])
        )
        return blocks

    if key == "instructions_schedule":
        return [
            _table(
                "投标人须知前附表",
                ["条款号", "条款名称", "编列内容"],
                [
                    ["1.1.2", "招标人", tenderer],
                    ["1.1.3", "招标代理机构", agency],
                    ["1.1.4", "项目名称", project],
                    ["1.1.5", "招标编号及包号", f"{number}；{package}"],
                    ["1.3.1", "招标范围", scope],
                    ["1.3.2", "交付期限及地点", f"{delivery_period}；{delivery_location}"],
                    ["2.2", "澄清规则", clarification],
                    ["3.3", "最高投标限价", ceiling],
                    ["3.4", "投标保证金", bond],
                    ["3.5", "投标有效期", validity],
                    ["4.2", "投标截止时间", deadline],
                    ["5.1", "开标安排", opening],
                ],
                "tenderer",
                "tender_agency",
                "project_name",
                "tender_number",
                "package_number",
                "procurement_scope",
                "delivery_period",
                "delivery_location",
                "clarification_rules",
                "maximum_price",
                "bid_bond",
                "bid_validity",
                "bid_deadline",
                "bid_opening",
                widths=[2.2, 3.6, 10.0],
            )
        ]
    if key == "evaluation_schedule":
        return [
            _table(
                "评标办法前附表",
                ["评审环节", "采用标准", "评审结论"],
                [
                    ["资格审查", qualification, "通过／不通过"],
                    ["符合性审查", "按招标文件实质性要求逐项审查", "通过／不通过"],
                    ["详细评审", evaluation_method, "按量化标准计分"],
                    ["同分处理", tie_break, "按确认规则排序"],
                ],
                "qualification_requirements",
                "evaluation_method",
                "tie_break_rule",
            )
        ]
    if key == "qualification_review":
        return [
            _table(
                "资格审查表",
                ["序号", "审查项目", "审查标准", "结果"],
                [
                    ["1", "主体资格", qualification, "通过／不通过"],
                    ["2", "法定代表人或授权代表", "证明和授权文件完整、有效", "通过／不通过"],
                    ["3", "联合体", joint_venture, "通过／不通过"],
                    ["4", "其他资格条件", "按公告及投标人须知前附表执行", "通过／不通过"],
                ],
                "qualification_requirements",
                "joint_venture_policy",
            )
        ]
    if key == "compliance_review":
        return [
            _table(
                "符合性审查表",
                ["序号", "审查项目", "审查标准", "结果"],
                [
                    ["1", "签署盖章", "投标文件按规定签署、盖章", "通过／不通过"],
                    ["2", "投标报价", f"不超过最高投标限价{ceiling}", "通过／不通过"],
                    ["3", "实质性要求", "对标注实质性的商务和技术要求作出明确响应", "通过／不通过"],
                    ["4", "投标有效期和保证金", f"有效期{validity}；保证金{bond}", "通过／不通过"],
                ],
                "maximum_price",
                "bid_validity",
                "bid_bond",
            )
        ]
    if key == "scoring_factors":
        rows = _pipe_rows(
            fields.get("evaluation_criteria"),
            5,
            [["1", PENDING_MARKER, PENDING_MARKER, PENDING_MARKER, PENDING_MARKER]],
        )
        return [
            _table(
                "商务、技术和报价评审因素表",
                ["序号", "评审因素", "分值", "评分区间", "量化标准"],
                rows,
                "evaluation_criteria",
                widths=[1.2, 3.0, 1.5, 2.5, 7.6],
            )
        ]
    if key == "procurement_list":
        rows = _pipe_rows(
            fields.get("procurement_list"),
            6,
            [["1", PENDING_MARKER, PENDING_MARKER, PENDING_MARKER, PENDING_MARKER, PENDING_MARKER]],
        )
        return [
            _table(
                "采购清单",
                ["序号", "货物或服务名称", "数量", "单位", "主要要求", "实质性标识"],
                rows,
                "procurement_list",
                widths=[1.0, 4.0, 1.4, 1.4, 6.8, 1.8],
            )
        ]
    if key == "technical_specs":
        rows = _pipe_rows(
            fields.get("technical_specifications"),
            5,
            [["1", PENDING_MARKER, PENDING_MARKER, PENDING_MARKER, PENDING_MARKER]],
        )
        return [
            _table(
                "技术规格和性能指标",
                ["序号", "指标类别", "技术规格", "实质性标识", "证明材料"],
                rows,
                "technical_specifications",
                widths=[1.0, 3.0, 7.2, 3.4, 1.8],
            )
        ]

    form_tables: dict[str, tuple[str, list[str], list[list[str]]]] = {
        "opening_schedule": (
            "开标一览表",
            ["项目", "投标人填写内容"],
            [
                ["投标总价", "投标人填写"],
                ["交付期", "投标人填写"],
                ["投标有效期", "投标人填写"],
                ["备注", "投标人填写"],
            ],
        ),
        "itemized_quote": (
            "分项报价表",
            ["序号", "货物或服务名称", "数量", "单位", "单价", "合价", "备注"],
            [["1", "投标人填写", "投标人填写", "投标人填写", "投标人填写", "投标人填写", "投标人填写"]],
        ),
        "commercial_deviation": (
            "商务偏离表",
            ["序号", "招标文件条款", "投标文件响应", "偏离情况", "说明"],
            [["1", "投标人填写", "投标人填写", "无偏离／正偏离／负偏离", "投标人填写"]],
        ),
        "technical_deviation": (
            "技术偏离表",
            ["序号", "技术要求", "投标响应", "偏离情况", "证明材料页码"],
            [["1", "投标人填写", "投标人填写", "无偏离／正偏离／负偏离", "投标人填写"]],
        ),
        "performance_table": (
            "业绩表",
            ["序号", "项目名称", "委托人", "合同金额", "完成时间", "证明材料页码"],
            [["1", "投标人填写", "投标人填写", "投标人填写", "投标人填写", "投标人填写"]],
        ),
        "team_table": (
            "项目团队表",
            ["序号", "姓名", "岗位", "资格或职称", "相关经验", "证明材料页码"],
            [["1", "投标人填写", "投标人填写", "投标人填写", "投标人填写", "投标人填写"]],
        ),
    }
    if key in form_tables:
        caption, headers, rows = form_tables[key]
        return [_table(caption, headers, rows)]

    if source_context:
        return [_paragraph("与本节相关的已锁定来源要点：" + "；".join(source_context[:3]))]
    return [_paragraph("本节应按照锁定模板和已经确认的项目资料编制；未确认的信息不得进入正式值。")]


def scoring_total(content: object) -> Decimal | None:
    if not isinstance(content, dict) or content.get("caption") != "商务、技术和报价评审因素表":
        return None
    total = Decimal("0")
    rows = content.get("rows")
    if not isinstance(rows, list):
        return None
    try:
        for row in rows:
            if not isinstance(row, list) or len(row) < 3:
                return None
            total += Decimal(str(row[2]).replace("分", "").strip())
    except (InvalidOperation, TypeError, ValueError):
        return None
    return total
