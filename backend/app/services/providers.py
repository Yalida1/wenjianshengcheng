from __future__ import annotations

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

import httpx
from pydantic import BaseModel, Field

from ..config import get_settings

PROMPT_VERSION = "document-section-v1"


class SectionDraft(BaseModel):
    key: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=300)
    paragraphs: list[str] = Field(min_length=1)
    field_refs: list[str] = []


class DraftResponse(BaseModel):
    sections: list[SectionDraft] = Field(min_length=1)


@dataclass(frozen=True)
class ProviderContext:
    stage: str
    project_name: str
    fields: dict[str, Any]
    section_plan: list[tuple[str, str]]


class GenerationProvider(ABC):
    name: str
    model: str

    @abstractmethod
    def generate(self, context: ProviderContext) -> DraftResponse: ...


class DemoProvider(GenerationProvider):
    name = "demo"
    model = "deterministic-v1"

    def generate(self, context: ProviderContext) -> DraftResponse:
        field_lines = [
            f"{key}：{value}"
            for key, value in sorted(context.fields.items())
            if value not in (None, "", [], {})
        ]
        evidence_text = "；".join(field_lines)
        sections = []
        for key, title in context.section_plan:
            if evidence_text:
                body = f"本节依据已确认字段编制。{evidence_text}。"
            else:
                body = "本节暂无可用于正式编制的已确认字段，需补充来源证据并人工确认。"
            sections.append(
                SectionDraft(
                    key=key,
                    title=title,
                    paragraphs=[body],
                    field_refs=sorted(context.fields),
                )
            )
        return DraftResponse(sections=sections)


class OpenAICompatibleProvider(GenerationProvider):
    name = "openai_compatible"

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.openai_base_url or not settings.openai_api_key or not settings.openai_model:
            raise RuntimeError("OpenAI-compatible provider configuration is incomplete")
        self.base_url = settings.openai_base_url.rstrip("/")
        self.api_key = settings.openai_api_key
        self.model = settings.openai_model

    def generate(self, context: ProviderContext) -> DraftResponse:
        system = (
            "你是项目文件编制助手。只能使用输入中的已确认字段，不得补写金额、主体、日期、"
            "范围、数量、期限、税率或付款信息。输出必须符合给定 JSON Schema。"
        )
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(context.__dict__, ensure_ascii=False)},
            ],
            "temperature": 0,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "document_draft",
                    "strict": True,
                    "schema": DraftResponse.model_json_schema(),
                },
            },
        }
        with httpx.Client(timeout=90) as client:
            response = client.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=payload,
            )
            response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        return DraftResponse.model_validate_json(content)


def get_provider() -> GenerationProvider:
    if get_settings().llm_provider == "openai_compatible":
        return OpenAICompatibleProvider()
    return DemoProvider()


SECTION_PLANS: dict[str, list[tuple[str, str]]] = {
    "requirement": [
        ("overview", "项目概况"),
        ("background", "建设背景"),
        ("objectives", "建设目标"),
        ("scope", "建设范围"),
        ("schedule", "实施计划"),
    ],
    "feasibility": [
        ("summary", "总论"),
        ("necessity", "建设背景和必要性"),
        ("demand", "需求分析"),
        ("solution", "建设方案"),
        ("investment", "投资估算与资金筹措"),
        ("risk", "效益和风险"),
        ("conclusion", "结论"),
    ],
    "tender": [
        ("announcement", "招标公告"),
        ("instructions", "投标人须知"),
        ("requirements", "采购需求"),
        ("contract_terms", "合同条款"),
        ("evaluation", "评标办法"),
    ],
    "contract": [
        ("parties", "合同主体"),
        ("subject", "合同标的和范围"),
        ("price", "价款和税费"),
        ("delivery", "履行和交付"),
        ("acceptance", "验收和质保"),
        ("payment", "付款安排"),
        ("liability", "违约和争议解决"),
        ("effective", "生效条件"),
    ],
}
