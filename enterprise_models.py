from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class WorkflowType(str, Enum):
    CODE = "code"
    POWERPOINT = "powerpoint"
    WORD = "word"


class WorkflowStatus(str, Enum):
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    PAUSED = "paused"
    TERMINATED = "terminated"


class DecisionType(str, Enum):
    APPROVE = "approve"
    REJECT = "reject"


class CompanyLoginRequest(BaseModel):
    company_id: str = Field(min_length=2, max_length=120)
    lead_name: str = Field(min_length=2, max_length=120)
    lead_email: str = Field(min_length=5, max_length=255)


class SessionResponse(BaseModel):
    session_token: str
    company_id: str
    lead_name: str
    lead_email: str


class EngineerInput(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=255)
    role: str = Field(min_length=2, max_length=120)
    access_scopes: list[str] = Field(min_length=1, max_length=50)

    @field_validator("access_scopes")
    @classmethod
    def normalize_scopes(cls, value: list[str]) -> list[str]:
        cleaned = [v.strip() for v in value if v.strip()]
        if not cleaned:
            raise ValueError("At least one access scope is required")
        return cleaned


class EngineersUpsertRequest(BaseModel):
    engineers: list[EngineerInput] = Field(min_length=1, max_length=500)


class EngineerRecord(BaseModel):
    id: int
    company_id: str
    name: str
    email: str
    role: str
    access_scopes: list[str]
    created_at: datetime


class EngineersResponse(BaseModel):
    items: list[EngineerRecord]


class CompanyPolicyRequest(BaseModel):
    preferred_languages: list[str] = Field(min_length=1, max_length=40)
    formatting_rules: str = Field(min_length=5, max_length=4000)
    approval_expectations: str = Field(min_length=5, max_length=4000)


class CompanyPolicyResponse(BaseModel):
    company_id: str
    preferred_languages: list[str]
    formatting_rules: str
    approval_expectations: str
    updated_at: datetime


class DelegationRequest(BaseModel):
    engineer_email: str = Field(min_length=5, max_length=255)
    company_role: str = Field(min_length=2, max_length=120)
    responsibilities: list[str] = Field(min_length=1, max_length=50)

    @field_validator("responsibilities")
    @classmethod
    def normalize_resp(cls, value: list[str]) -> list[str]:
        cleaned = [v.strip() for v in value if v.strip()]
        if not cleaned:
            raise ValueError("At least one responsibility is required")
        return cleaned


class DelegationsUpsertRequest(BaseModel):
    items: list[DelegationRequest] = Field(min_length=1, max_length=500)


class DelegationRecord(BaseModel):
    id: int
    company_id: str
    engineer_email: str
    company_role: str
    responsibilities: list[str]
    created_at: datetime


class DelegationsResponse(BaseModel):
    items: list[DelegationRecord]


class WorkflowTaskCreateRequest(BaseModel):
    workflow: WorkflowType
    title: str = Field(min_length=3, max_length=180)
    description: str = Field(min_length=10, max_length=5000)
    assignee_email: str = Field(min_length=5, max_length=255)
    severity: str = Field(min_length=3, max_length=20, default="medium")
    proposed_changes: list[str] = Field(min_length=1, max_length=100)

    @field_validator("proposed_changes")
    @classmethod
    def normalize_changes(cls, value: list[str]) -> list[str]:
        cleaned = [v.strip() for v in value if v.strip()]
        if not cleaned:
            raise ValueError("At least one proposed change is required")
        return cleaned


class WorkflowTaskDecisionRequest(BaseModel):
    reviewer: str = Field(min_length=2, max_length=120)
    decision: DecisionType
    notes: str = Field(min_length=3, max_length=3000)
    rejection_issue: str = Field(default="", max_length=3000)
    proposed_solution: str = Field(default="", max_length=3000)


class WorkflowTaskInterventionRequest(BaseModel):
    action: str = Field(min_length=4, max_length=20)


class WorkflowTaskRecord(BaseModel):
    id: str
    company_id: str
    workflow: WorkflowType
    title: str
    description: str
    assignee_email: str
    severity: str
    proposed_changes: list[str]
    status: WorkflowStatus
    reviewer: Optional[str] = None
    decision_notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class WorkflowTasksResponse(BaseModel):
    items: list[WorkflowTaskRecord]


class RejectionKnowledgeRecord(BaseModel):
    id: int
    company_id: str
    task_id: str
    workflow: WorkflowType
    issue: str
    proposed_solution: str
    context: str
    created_at: datetime


class RejectionKnowledgeResponse(BaseModel):
    items: list[RejectionKnowledgeRecord]
