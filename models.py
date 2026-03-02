from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


def utc_now() -> datetime:
    return datetime.now(tz=timezone.utc)


class Stage(str, Enum):
    DESIGN = "design"
    DEVELOPMENT = "development"
    DEPLOYMENT = "deployment"
    INCIDENT_RESPONSE = "incident_response"
    COMMUNICATION = "communication"
    GOVERNANCE = "governance"


class TaskStatus(str, Enum):
    PENDING_REVIEW = "pending_review"
    READY = "ready"
    EXECUTING = "executing"
    COMPLETED = "completed"
    FAILED = "failed"
    BLOCKED = "blocked"
    TERMINATED = "terminated"


class ApprovalDecision(str, Enum):
    APPROVE = "approve"
    REJECT = "reject"
    REQUEST_CHANGES = "request_changes"


class InterventionAction(str, Enum):
    PAUSE = "pause"
    RESUME = "resume"
    TERMINATE = "terminate"


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class TaskCreateRequest(BaseModel):
    title: str = Field(min_length=3, max_length=160)
    stage: Stage
    summary: str = Field(min_length=10, max_length=5000)
    repository: str = Field(min_length=2, max_length=255)
    branch: str = Field(min_length=1, max_length=255, default="main")
    proposed_actions: list[str] = Field(min_length=1, max_length=100)
    impacts_production: bool = False
    touches_security_controls: bool = False
    touches_data_layer: bool = False
    estimated_files_changed: int = Field(default=1, ge=1, le=5000)
    confidence: float = Field(default=0.7, ge=0.0, le=1.0)
    model_provider: str = Field(default="openai", min_length=2, max_length=80)
    model_id: str = Field(default="codex", min_length=2, max_length=120)
    model_version: str = Field(default="latest", min_length=1, max_length=120)
    drift_signal: float = Field(default=0.0, ge=0.0, le=1.0)
    historical_failure_rate: float = Field(default=0.0, ge=0.0, le=1.0)
    autonomy_level: int = Field(default=3, ge=1, le=5)
    safety_override_requested: bool = False

    @field_validator("proposed_actions")
    @classmethod
    def normalize_actions(cls, value: list[str]) -> list[str]:
        cleaned = [v.strip() for v in value if v.strip()]
        if not cleaned:
            raise ValueError("At least one non-empty action is required")
        return cleaned


class ApprovalRequest(BaseModel):
    reviewer: str = Field(min_length=2, max_length=120)
    decision: ApprovalDecision
    reason: str = Field(min_length=3, max_length=2000)


class InterventionRequest(BaseModel):
    actor: str = Field(min_length=2, max_length=120)
    action: InterventionAction
    reason: str = Field(min_length=3, max_length=2000)


class ExecuteRequest(BaseModel):
    actor: str = Field(min_length=2, max_length=120)
    dry_run: bool = False


class RiskAssessment(BaseModel):
    score: int = Field(ge=0, le=100)
    level: RiskLevel
    rationale: list[str]
    min_required_approvals: int = Field(ge=1, le=3)
    requires_security_approval: bool = False
    requires_dry_run: bool = False
    model_risk_score: int = Field(default=0, ge=0, le=100)
    model_risk_level: RiskLevel = RiskLevel.LOW
    requires_model_risk_approval: bool = False


class ModelProfile(BaseModel):
    provider: str
    model_id: str
    model_version: str
    drift_signal: float
    historical_failure_rate: float
    autonomy_level: int
    safety_override_requested: bool


class ApprovalRecord(BaseModel):
    reviewer: str
    decision: ApprovalDecision
    reason: str
    created_at: datetime


class AuditEvent(BaseModel):
    event_type: str
    actor: str
    detail: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


@dataclass
class TaskEntity:
    id: str
    title: str
    stage: Stage
    summary: str
    repository: str
    branch: str
    proposed_actions: list[str]
    impacts_production: bool
    touches_security_controls: bool
    touches_data_layer: bool
    estimated_files_changed: int
    confidence: float
    model_profile: ModelProfile
    risk_assessment: RiskAssessment
    status: TaskStatus = TaskStatus.PENDING_REVIEW
    approvals: list[ApprovalRecord] = field(default_factory=list)
    paused: bool = False
    dry_run_completed: bool = False
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)

    def to_response(self) -> "TaskResponse":
        return TaskResponse(
            id=self.id,
            title=self.title,
            stage=self.stage,
            summary=self.summary,
            repository=self.repository,
            branch=self.branch,
            proposed_actions=list(self.proposed_actions),
            model_profile=self.model_profile,
            risk_assessment=self.risk_assessment,
            status=self.status,
            approvals=list(self.approvals),
            paused=self.paused,
            dry_run_completed=self.dry_run_completed,
            created_at=self.created_at,
            updated_at=self.updated_at,
        )


class TaskResponse(BaseModel):
    id: str
    title: str
    stage: Stage
    summary: str
    repository: str
    branch: str
    proposed_actions: list[str]
    model_profile: ModelProfile
    risk_assessment: RiskAssessment
    status: TaskStatus
    approvals: list[ApprovalRecord]
    paused: bool
    dry_run_completed: bool
    created_at: datetime
    updated_at: datetime


class TaskListResponse(BaseModel):
    items: list[TaskResponse]


class AuditResponse(BaseModel):
    task_id: str
    events: list[AuditEvent]


class ExecutionResult(BaseModel):
    ok: bool
    output: str


class SlackTestRequest(BaseModel):
    actor: str = Field(min_length=2, max_length=120, default="system")
