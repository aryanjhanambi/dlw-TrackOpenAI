from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class PolicyContext(BaseModel):
    languages: list[str] = Field(default_factory=list)
    structure: str = Field(default="unspecified", max_length=120)
    formatting: str = Field(default="unspecified", max_length=120)
    security: list[str] = Field(default_factory=list)
    constraints: str = Field(default="", max_length=4000)


class CodexDraftRequest(BaseModel):
    project_name: str = Field(min_length=1, max_length=120)
    task_title: str = Field(min_length=3, max_length=180)
    stage: str = Field(min_length=3, max_length=60)
    task_prompt: str = Field(min_length=10, max_length=8000)
    input_code: str = Field(default="", max_length=12000)
    policy: PolicyContext
    force_refresh: bool = False


class CodexDraftResponse(BaseModel):
    generated_code: str
    summary: str
    risk_notes: list[str]
    model: str
    cached: bool
    prompt_chars: int
    output_chars: int
    metadata: dict[str, Any] = Field(default_factory=dict)
