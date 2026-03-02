from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException, status

from app.executor import SafeExecutor
from app.models import (
    ApprovalDecision,
    ApprovalRecord,
    ApprovalRequest,
    AuditResponse,
    ExecuteRequest,
    InterventionAction,
    InterventionRequest,
    ModelProfile,
    TaskCreateRequest,
    TaskEntity,
    TaskListResponse,
    TaskResponse,
    TaskStatus,
)
from app.notifications import NoOpNotifier, Notifier
from app.policy import assess_risk
from app.store import TaskStore


def utc_now() -> datetime:
    return datetime.now(tz=timezone.utc)


class TaskService:
    def __init__(
        self,
        store: TaskStore,
        executor: SafeExecutor,
        notifier: Notifier | None = None,
    ) -> None:
        self.store = store
        self.executor = executor
        self.notifier = notifier or NoOpNotifier()

    def create_task(self, req: TaskCreateRequest, actor: str = "requester") -> TaskResponse:
        risk = assess_risk(req)
        task = TaskEntity(
            id=str(uuid4()),
            title=req.title,
            stage=req.stage,
            summary=req.summary,
            repository=req.repository,
            branch=req.branch,
            proposed_actions=req.proposed_actions,
            impacts_production=req.impacts_production,
            touches_security_controls=req.touches_security_controls,
            touches_data_layer=req.touches_data_layer,
            estimated_files_changed=req.estimated_files_changed,
            confidence=req.confidence,
            model_profile=ModelProfile(
                provider=req.model_provider,
                model_id=req.model_id,
                model_version=req.model_version,
                drift_signal=req.drift_signal,
                historical_failure_rate=req.historical_failure_rate,
                autonomy_level=req.autonomy_level,
                safety_override_requested=req.safety_override_requested,
            ),
            risk_assessment=risk,
        )
        self.store.upsert_task(task)
        detail = {
            "stage": task.stage.value,
            "risk_level": task.risk_assessment.level.value,
            "risk_score": task.risk_assessment.score,
            "model_risk_level": task.risk_assessment.model_risk_level.value,
            "model_risk_score": task.risk_assessment.model_risk_score,
        }
        self.store.add_event(
            task.id,
            "task_created",
            actor,
            detail,
        )
        self._notify("task_created", actor, task, detail)
        return task.to_response()

    def list_tasks(self) -> TaskListResponse:
        tasks = self.store.list_tasks()
        return TaskListResponse(items=[t.to_response() for t in tasks])

    def get_task(self, task_id: str) -> TaskResponse:
        task = self._must_get_task(task_id)
        return task.to_response()

    def approve(self, task_id: str, req: ApprovalRequest) -> TaskResponse:
        task = self._must_get_task(task_id)
        if task.status in {TaskStatus.COMPLETED, TaskStatus.TERMINATED, TaskStatus.FAILED}:
            raise HTTPException(status_code=409, detail="Cannot approve a finalized task")

        if any(a.reviewer == req.reviewer for a in task.approvals):
            raise HTTPException(status_code=409, detail="Reviewer already submitted a decision")

        rec = ApprovalRecord(
            reviewer=req.reviewer,
            decision=req.decision,
            reason=req.reason,
            created_at=utc_now(),
        )
        task.approvals.append(rec)

        if req.decision == ApprovalDecision.REJECT:
            task.status = TaskStatus.BLOCKED
        elif req.decision == ApprovalDecision.REQUEST_CHANGES:
            task.status = TaskStatus.PENDING_REVIEW
        else:
            approvals = [a for a in task.approvals if a.decision == ApprovalDecision.APPROVE]
            if len(approvals) >= task.risk_assessment.min_required_approvals:
                task.status = TaskStatus.READY
            else:
                task.status = TaskStatus.PENDING_REVIEW

        task.updated_at = utc_now()
        self.store.upsert_task(task)
        detail = {"decision": req.decision.value, "reason": req.reason}
        self.store.add_event(task_id, "approval_submitted", req.reviewer, detail)
        self._notify("approval_submitted", req.reviewer, task, detail)
        return task.to_response()

    def execute(self, task_id: str, req: ExecuteRequest) -> TaskResponse:
        task = self._must_get_task(task_id)
        if task.paused:
            raise HTTPException(status_code=409, detail="Task is paused and cannot be executed")
        if task.status != TaskStatus.READY:
            raise HTTPException(status_code=409, detail="Task is not approved for execution")
        if task.risk_assessment.requires_dry_run and not task.dry_run_completed and not req.dry_run:
            raise HTTPException(
                status_code=409,
                detail="Dry-run required before live execution for this task",
            )

        if task.risk_assessment.requires_security_approval and not self._has_security_reviewer(task):
            raise HTTPException(
                status_code=409,
                detail="Security approval required but no security reviewer found",
            )
        if task.risk_assessment.requires_model_risk_approval and not self._has_model_risk_reviewer(task):
            raise HTTPException(
                status_code=409,
                detail="Model risk approval required but no model risk reviewer found",
            )

        task.status = TaskStatus.EXECUTING
        task.updated_at = utc_now()
        self.store.upsert_task(task)
        started_detail = {"status": task.status.value, "dry_run": req.dry_run}
        self.store.add_event(
            task.id,
            "execution_started",
            req.actor,
            started_detail,
        )
        self._notify("execution_started", req.actor, task, started_detail)

        result = self.executor.execute(task)
        if req.dry_run:
            task.dry_run_completed = result.ok
            task.status = TaskStatus.READY if result.ok else TaskStatus.BLOCKED
        else:
            task.status = TaskStatus.COMPLETED if result.ok else TaskStatus.FAILED
        task.updated_at = utc_now()
        self.store.upsert_task(task)
        finished_detail = {"ok": result.ok, "output": result.output, "dry_run": req.dry_run}
        self.store.add_event(
            task.id,
            "execution_finished",
            req.actor,
            finished_detail,
        )
        self._notify("execution_finished", req.actor, task, finished_detail)
        return task.to_response()

    def intervene(self, task_id: str, req: InterventionRequest) -> TaskResponse:
        task = self._must_get_task(task_id)
        if req.action == InterventionAction.PAUSE:
            task.paused = True
            if task.status == TaskStatus.EXECUTING:
                task.status = TaskStatus.BLOCKED
        elif req.action == InterventionAction.RESUME:
            task.paused = False
            if task.status == TaskStatus.BLOCKED:
                task.status = TaskStatus.READY
        elif req.action == InterventionAction.TERMINATE:
            task.paused = True
            task.status = TaskStatus.TERMINATED
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid action")

        task.updated_at = utc_now()
        self.store.upsert_task(task)
        detail = {"action": req.action.value, "reason": req.reason, "status": task.status.value}
        self.store.add_event(
            task.id,
            "intervention",
            req.actor,
            detail,
        )
        self._notify("intervention", req.actor, task, detail)
        return task.to_response()

    def audit_log(self, task_id: str) -> AuditResponse:
        _ = self._must_get_task(task_id)
        return AuditResponse(task_id=task_id, events=self.store.get_events(task_id))

    def _must_get_task(self, task_id: str) -> TaskEntity:
        task = self.store.get_task(task_id)
        if task is None:
            raise HTTPException(status_code=404, detail=f"Task '{task_id}' was not found")
        return task

    @staticmethod
    def _has_security_reviewer(task: TaskEntity) -> bool:
        for approval in task.approvals:
            if approval.decision == ApprovalDecision.APPROVE and "security" in approval.reviewer.lower():
                return True
        return False

    @staticmethod
    def _has_model_risk_reviewer(task: TaskEntity) -> bool:
        for approval in task.approvals:
            reviewer = approval.reviewer.lower()
            if approval.decision == ApprovalDecision.APPROVE and (
                "ml-risk" in reviewer or "model-risk" in reviewer or "governance" in reviewer
            ):
                return True
        return False

    def _notify(self, event_type: str, actor: str, task: TaskEntity, detail: dict[str, object]) -> None:
        try:
            self.notifier.task_event(
                event_type=event_type,
                actor=actor,
                task_id=task.id,
                title=task.title,
                status=task.status.value,
                detail=detail,
            )
        except Exception:
            # Notification failures should never block governance workflows.
            return
