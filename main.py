from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from fastapi import Depends, FastAPI, Header, Query
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.ai_gateway import CodexGateway
from app.ai_models import CodexDraftRequest, CodexDraftResponse
from app.enterprise_models import (
    CompanyLoginRequest,
    CompanyPolicyRequest,
    CompanyPolicyResponse,
    DelegationsResponse,
    DelegationsUpsertRequest,
    EngineersResponse,
    EngineersUpsertRequest,
    RejectionKnowledgeResponse,
    SessionResponse,
    WorkflowTaskCreateRequest,
    WorkflowTaskDecisionRequest,
    WorkflowTaskInterventionRequest,
    WorkflowTasksResponse,
    WorkflowType,
)
from app.enterprise_service import EnterpriseService
from app.enterprise_store import EnterpriseStore
from app.executor import SafeExecutor
from app.models import (
    ApprovalRequest,
    AuditResponse,
    ExecuteRequest,
    InterventionRequest,
    SlackTestRequest,
    TaskCreateRequest,
    TaskListResponse,
    TaskResponse,
)
from app.notifications import NoOpNotifier, notifier_from_env
from app.risk_engine.engine import RiskAssessmentEngine
from app.risk_engine.models import RiskAssessmentResult
from app.service import TaskService
from app.store import TaskStore

app = FastAPI(
    title="Codex Governor",
    version="0.1.0",
    summary="Human-governed orchestration for AI coding agents across SDLC stages.",
)

store = TaskStore()
notifier = notifier_from_env()
service = TaskService(store=store, executor=SafeExecutor(), notifier=notifier)
enterprise_store = EnterpriseStore()
enterprise_service = EnterpriseService(store=enterprise_store)
ai_gateway = CodexGateway()
risk_assessment_engine = RiskAssessmentEngine()
prototype_dir = Path(__file__).resolve().parents[1] / "prototype"
app.mount("/prototype", StaticFiles(directory=str(prototype_dir)), name="prototype")


class RiskAssessmentRequest(BaseModel):
    generated_patch: str
    prompt: str = ""
    metadata: Optional[dict[str, Any]] = None


class RiskAssessmentResponse(BaseModel):
    status: str = "success"
    data: RiskAssessmentResult


def actor_from_header(x_actor: str = Header(default="unknown_actor")) -> str:
    return x_actor or "unknown_actor"


def session_token_header(x_session_token: str = Header(default="")) -> str:
    return x_session_token.strip()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/tasks", response_model=TaskResponse, status_code=201)
def create_task(req: TaskCreateRequest, actor: str = Depends(actor_from_header)) -> TaskResponse:
    return service.create_task(req, actor=actor)


@app.get("/tasks", response_model=TaskListResponse)
def list_tasks() -> TaskListResponse:
    return service.list_tasks()


@app.get("/tasks/{task_id}", response_model=TaskResponse)
def get_task(task_id: str) -> TaskResponse:
    return service.get_task(task_id)


@app.post("/tasks/{task_id}/approve", response_model=TaskResponse)
def approve_task(task_id: str, req: ApprovalRequest) -> TaskResponse:
    return service.approve(task_id, req)


@app.post("/tasks/{task_id}/execute", response_model=TaskResponse)
def execute_task(task_id: str, req: ExecuteRequest) -> TaskResponse:
    return service.execute(task_id, req)


@app.post("/tasks/{task_id}/intervene", response_model=TaskResponse)
def intervene_task(task_id: str, req: InterventionRequest) -> TaskResponse:
    return service.intervene(task_id, req)


@app.get("/tasks/{task_id}/audit", response_model=AuditResponse)
def audit_task(task_id: str) -> AuditResponse:
    return service.audit_log(task_id)


@app.post("/integrations/slack/test")
def slack_test(req: SlackTestRequest) -> dict[str, bool]:
    ok = notifier.healthcheck(actor=req.actor)
    configured = not isinstance(notifier, NoOpNotifier)
    return {"ok": ok, "configured": configured}


@app.get("/", include_in_schema=False)
def webapp() -> FileResponse:
    return FileResponse(prototype_dir / "index.html")


@app.post("/enterprise/login", response_model=SessionResponse)
def enterprise_login(req: CompanyLoginRequest) -> SessionResponse:
    return enterprise_service.login_or_register(req)


@app.post("/enterprise/engineers", response_model=EngineersResponse)
def upsert_enterprise_engineers(
    req: EngineersUpsertRequest,
    token: str = Depends(session_token_header),
) -> EngineersResponse:
    company_id = enterprise_service.company_from_session(token)
    return enterprise_service.upsert_engineers(company_id, req)


@app.get("/enterprise/engineers", response_model=EngineersResponse)
def list_enterprise_engineers(token: str = Depends(session_token_header)) -> EngineersResponse:
    company_id = enterprise_service.company_from_session(token)
    return enterprise_service.list_engineers(company_id)


@app.post("/enterprise/policy", response_model=CompanyPolicyResponse)
def upsert_enterprise_policy(
    req: CompanyPolicyRequest,
    token: str = Depends(session_token_header),
) -> CompanyPolicyResponse:
    company_id = enterprise_service.company_from_session(token)
    return enterprise_service.upsert_policy(company_id, req)


@app.get("/enterprise/policy", response_model=CompanyPolicyResponse)
def get_enterprise_policy(token: str = Depends(session_token_header)) -> CompanyPolicyResponse:
    company_id = enterprise_service.company_from_session(token)
    return enterprise_service.get_policy(company_id)


@app.post("/enterprise/delegations", response_model=DelegationsResponse)
def upsert_enterprise_delegations(
    req: DelegationsUpsertRequest,
    token: str = Depends(session_token_header),
) -> DelegationsResponse:
    company_id = enterprise_service.company_from_session(token)
    return enterprise_service.upsert_delegations(company_id, req)


@app.get("/enterprise/delegations", response_model=DelegationsResponse)
def list_enterprise_delegations(token: str = Depends(session_token_header)) -> DelegationsResponse:
    company_id = enterprise_service.company_from_session(token)
    return enterprise_service.list_delegations(company_id)


@app.post("/enterprise/workflow-tasks", response_model=WorkflowTasksResponse)
def create_enterprise_workflow_task(
    req: WorkflowTaskCreateRequest,
    token: str = Depends(session_token_header),
) -> WorkflowTasksResponse:
    company_id = enterprise_service.company_from_session(token)
    return enterprise_service.create_workflow_task(company_id, req)


@app.get("/enterprise/workflow-tasks", response_model=WorkflowTasksResponse)
def list_enterprise_workflow_tasks(
    token: str = Depends(session_token_header),
    workflow: Optional[WorkflowType] = Query(default=None),
) -> WorkflowTasksResponse:
    company_id = enterprise_service.company_from_session(token)
    return enterprise_service.list_workflow_tasks(company_id, workflow)


@app.post("/enterprise/workflow-tasks/{task_id}/decision", response_model=WorkflowTasksResponse)
def decide_enterprise_workflow_task(
    task_id: str,
    req: WorkflowTaskDecisionRequest,
    token: str = Depends(session_token_header),
) -> WorkflowTasksResponse:
    company_id = enterprise_service.company_from_session(token)
    return enterprise_service.decide_workflow_task(company_id, task_id, req)


@app.post("/enterprise/workflow-tasks/{task_id}/intervene", response_model=WorkflowTasksResponse)
def intervene_enterprise_workflow_task(
    task_id: str,
    req: WorkflowTaskInterventionRequest,
    token: str = Depends(session_token_header),
) -> WorkflowTasksResponse:
    company_id = enterprise_service.company_from_session(token)
    return enterprise_service.intervene_workflow_task(company_id, task_id, req.action)


@app.get("/enterprise/rejection-knowledge", response_model=RejectionKnowledgeResponse)
def list_enterprise_rejection_knowledge(
    token: str = Depends(session_token_header),
    q: str = Query(default=""),
) -> RejectionKnowledgeResponse:
    company_id = enterprise_service.company_from_session(token)
    return enterprise_service.list_rejection_knowledge(company_id, query=q)


@app.get("/enterprise/workflow-tasks/{task_id}/confirmation-doc")
def enterprise_confirmation_doc(
    task_id: str,
    token: str = Depends(session_token_header),
) -> PlainTextResponse:
    company_id = enterprise_service.company_from_session(token)
    filename, body = enterprise_service.confirmation_document(company_id, task_id)
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return PlainTextResponse(content=body, headers=headers, media_type="text/plain")


@app.post("/ai/codex-draft", response_model=CodexDraftResponse)
def ai_codex_draft(req: CodexDraftRequest) -> CodexDraftResponse:
    return ai_gateway.generate(req)


@app.post("/api/v1/risk/assess", response_model=RiskAssessmentResponse)
def assess_risk(req: RiskAssessmentRequest) -> RiskAssessmentResponse:
    result = risk_assessment_engine.assess(
        generated_patch=req.generated_patch,
        prompt=req.prompt,
        metadata=req.metadata,
    )
    return RiskAssessmentResponse(data=result)
