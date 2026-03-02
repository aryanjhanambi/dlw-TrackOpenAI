from __future__ import annotations

from datetime import datetime, timezone
from secrets import token_urlsafe
from uuid import uuid4

from fastapi import HTTPException

from app.enterprise_models import (
    CompanyLoginRequest,
    CompanyPolicyRequest,
    CompanyPolicyResponse,
    DecisionType,
    DelegationsUpsertRequest,
    DelegationsResponse,
    EngineersResponse,
    EngineersUpsertRequest,
    RejectionKnowledgeResponse,
    SessionResponse,
    WorkflowStatus,
    WorkflowTaskCreateRequest,
    WorkflowTaskDecisionRequest,
    WorkflowTasksResponse,
    WorkflowType,
)
from app.enterprise_store import EnterpriseStore


class EnterpriseService:
    def __init__(self, store: EnterpriseStore) -> None:
        self.store = store

    def login_or_register(self, req: CompanyLoginRequest) -> SessionResponse:
        self.store.upsert_company(req.company_id, req.lead_name, req.lead_email)
        token = token_urlsafe(24)
        self.store.create_session(token, req.company_id)
        return SessionResponse(
            session_token=token,
            company_id=req.company_id,
            lead_name=req.lead_name,
            lead_email=req.lead_email,
        )

    def company_from_session(self, token: str) -> str:
        company_id = self.store.company_id_from_session(token) or ""
        if not company_id:
            raise HTTPException(status_code=401, detail="Invalid or expired session token")
        return company_id

    def upsert_engineers(self, company_id: str, req: EngineersUpsertRequest) -> EngineersResponse:
        payload = [item.model_dump(mode="python") for item in req.engineers]
        self.store.replace_engineers(company_id, payload)
        return EngineersResponse(items=self.store.list_engineers(company_id))

    def list_engineers(self, company_id: str) -> EngineersResponse:
        return EngineersResponse(items=self.store.list_engineers(company_id))

    def upsert_policy(self, company_id: str, req: CompanyPolicyRequest) -> CompanyPolicyResponse:
        return self.store.upsert_policy(
            company_id=company_id,
            preferred_languages=req.preferred_languages,
            formatting_rules=req.formatting_rules,
            approval_expectations=req.approval_expectations,
        )

    def get_policy(self, company_id: str) -> CompanyPolicyResponse:
        return self.store.get_policy(company_id)

    def upsert_delegations(self, company_id: str, req: DelegationsUpsertRequest) -> DelegationsResponse:
        payload = [item.model_dump(mode="python") for item in req.items]
        self.store.replace_delegations(company_id, payload)
        return DelegationsResponse(items=self.store.list_delegations(company_id))

    def list_delegations(self, company_id: str) -> DelegationsResponse:
        return DelegationsResponse(items=self.store.list_delegations(company_id))

    def create_workflow_task(self, company_id: str, req: WorkflowTaskCreateRequest) -> WorkflowTasksResponse:
        task_id = str(uuid4())
        self.store.create_workflow_task(
            task_id=task_id,
            company_id=company_id,
            workflow=req.workflow,
            title=req.title,
            description=req.description,
            assignee_email=req.assignee_email,
            severity=req.severity,
            proposed_changes=req.proposed_changes,
        )
        return self.list_workflow_tasks(company_id, workflow=None)

    def list_workflow_tasks(
        self, company_id: str, workflow: WorkflowType | None
    ) -> WorkflowTasksResponse:
        return WorkflowTasksResponse(items=self.store.list_workflow_tasks(company_id, workflow))

    def decide_workflow_task(
        self,
        company_id: str,
        task_id: str,
        req: WorkflowTaskDecisionRequest,
    ) -> WorkflowTasksResponse:
        task = self.store.get_workflow_task(task_id)
        if task is None or task.company_id != company_id:
            raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")
        if task.status in {WorkflowStatus.APPROVED, WorkflowStatus.TERMINATED}:
            raise HTTPException(status_code=409, detail="Task is already finalized")

        new_status = WorkflowStatus.APPROVED
        if req.decision == DecisionType.REJECT:
            new_status = WorkflowStatus.REJECTED
            issue = req.rejection_issue.strip()
            if not issue:
                raise HTTPException(status_code=400, detail="rejection_issue is required when rejecting")
            self.store.add_rejection_knowledge(
                company_id=company_id,
                task_id=task.id,
                workflow=task.workflow,
                issue=issue,
                proposed_solution=req.proposed_solution.strip() or "No solution proposed yet.",
                context=f"{task.title}: {task.description}",
            )

        self.store.update_workflow_task_decision(
            task_id=task_id,
            status=new_status.value,
            reviewer=req.reviewer,
            decision_notes=req.notes,
        )
        return self.list_workflow_tasks(company_id, workflow=None)

    def intervene_workflow_task(
        self,
        company_id: str,
        task_id: str,
        action: str,
    ) -> WorkflowTasksResponse:
        task = self.store.get_workflow_task(task_id)
        if task is None or task.company_id != company_id:
            raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")
        action_norm = action.strip().lower()
        if action_norm not in {"pause", "terminate", "resume"}:
            raise HTTPException(status_code=400, detail="action must be pause, resume, or terminate")

        if action_norm == "pause":
            status = WorkflowStatus.PAUSED.value
        elif action_norm == "terminate":
            status = WorkflowStatus.TERMINATED.value
        else:
            status = WorkflowStatus.PENDING_REVIEW.value

        self.store.update_workflow_task_decision(
            task_id=task_id,
            status=status,
            reviewer="intervention-controller",
            decision_notes=f"Manual intervention: {action_norm}",
        )
        return self.list_workflow_tasks(company_id, workflow=None)

    def list_rejection_knowledge(self, company_id: str, query: str = "") -> RejectionKnowledgeResponse:
        return RejectionKnowledgeResponse(items=self.store.list_rejection_knowledge(company_id, query=query))

    def confirmation_document(self, company_id: str, task_id: str) -> tuple[str, str]:
        task = self.store.get_workflow_task(task_id)
        if task is None or task.company_id != company_id:
            raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")
        if task.status != WorkflowStatus.APPROVED:
            raise HTTPException(status_code=409, detail="Confirmation doc is available only for approved tasks")

        created = datetime.now(tz=timezone.utc).isoformat()
        serious_changes = "\n".join(f"- {line}" for line in task.proposed_changes)
        body = (
            "MERIDIAN GOVERNANCE CONFIRMATION\n"
            "================================\n\n"
            f"Generated At (UTC): {created}\n"
            f"Company: {company_id}\n"
            f"Task ID: {task.id}\n"
            f"Workflow: {task.workflow.value}\n"
            f"Title: {task.title}\n"
            f"Assignee: {task.assignee_email}\n"
            f"Severity: {task.severity}\n"
            f"Reviewer: {task.reviewer or 'n/a'}\n"
            f"Decision Notes: {task.decision_notes or 'n/a'}\n\n"
            "Serious Changes Reviewed\n"
            "------------------------\n"
            f"{serious_changes}\n"
        )
        filename = f"{task.id}-confirmation.txt"
        return filename, body
