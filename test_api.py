from __future__ import annotations

from fastapi.testclient import TestClient

from app.executor import SafeExecutor
from app.main import app
from app.service import TaskService
from app.store import TaskStore


class FakeNotifier:
    def __init__(self) -> None:
        self.events: list[dict[str, str]] = []
        self.healthcheck_calls = 0

    def task_event(
        self,
        *,
        event_type: str,
        actor: str,
        task_id: str,
        title: str,
        status: str,
        detail: dict[str, object],
    ) -> None:
        self.events.append({"event_type": event_type, "actor": actor, "task_id": task_id, "status": status})

    def healthcheck(self, actor: str) -> bool:
        self.healthcheck_calls += 1
        return True


def _client(tmp_path, monkeypatch) -> TestClient:
    store = TaskStore(db_path=str(tmp_path / "test.db"))
    service = TaskService(store=store, executor=SafeExecutor())
    monkeypatch.setattr("app.main.service", service)
    return TestClient(app)


def _client_with_notifier(tmp_path, monkeypatch):
    store = TaskStore(db_path=str(tmp_path / "test.db"))
    notifier = FakeNotifier()
    service = TaskService(store=store, executor=SafeExecutor(), notifier=notifier)
    monkeypatch.setattr("app.main.service", service)
    monkeypatch.setattr("app.main.notifier", notifier)
    return TestClient(app), notifier


def test_high_risk_needs_two_approvals(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    payload = {
        "title": "Production DB migration",
        "stage": "deployment",
        "summary": "Roll out migration safely with automated checks and rollback steps.",
        "repository": "enterprise/payments",
        "branch": "release/2026.03",
        "proposed_actions": ["Apply migration", "Verify SLOs in production"],
        "impacts_production": True,
        "touches_security_controls": False,
        "touches_data_layer": True,
        "estimated_files_changed": 20,
        "confidence": 0.72,
    }
    created = client.post("/tasks", json=payload, headers={"x-actor": "pm"}).json()
    assert created["risk_assessment"]["min_required_approvals"] == 2
    task_id = created["id"]

    first = client.post(
        f"/tasks/{task_id}/approve",
        json={"reviewer": "alice", "decision": "approve", "reason": "Looks safe"},
    ).json()
    assert first["status"] == "pending_review"

    second = client.post(
        f"/tasks/{task_id}/approve",
        json={"reviewer": "bob", "decision": "approve", "reason": "Ops approved"},
    ).json()
    assert second["status"] == "ready"
    assert second["risk_assessment"]["requires_dry_run"] is True


def test_security_task_requires_security_approver(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    payload = {
        "title": "Rotate auth keys",
        "stage": "deployment",
        "summary": "Rotate production API keys and validate auth handshakes.",
        "repository": "enterprise/auth",
        "branch": "main",
        "proposed_actions": ["Rotate keys", "Deploy auth config"],
        "impacts_production": True,
        "touches_security_controls": True,
        "touches_data_layer": False,
        "estimated_files_changed": 5,
        "confidence": 0.81,
    }
    created = client.post("/tasks", json=payload).json()
    task_id = created["id"]

    client.post(
        f"/tasks/{task_id}/approve",
        json={"reviewer": "alice", "decision": "approve", "reason": "SRE approved"},
    )
    client.post(
        f"/tasks/{task_id}/approve",
        json={"reviewer": "bob", "decision": "approve", "reason": "Backend approved"},
    )

    blocked = client.post(f"/tasks/{task_id}/execute", json={"actor": "orchestrator"})
    assert blocked.status_code == 409
    assert "Security approval required" in blocked.json()["detail"]

    client.post(
        f"/tasks/{task_id}/approve",
        json={
            "reviewer": "security-team-lead",
            "decision": "approve",
            "reason": "Security sign-off",
        },
    )

    blocked_dry_run = client.post(f"/tasks/{task_id}/execute", json={"actor": "orchestrator"})
    assert blocked_dry_run.status_code == 409
    assert "Dry-run required" in blocked_dry_run.json()["detail"]

    dry_run = client.post(
        f"/tasks/{task_id}/execute", json={"actor": "orchestrator", "dry_run": True}
    )
    assert dry_run.status_code == 200
    assert dry_run.json()["dry_run_completed"] is True
    assert dry_run.json()["status"] == "ready"

    executed = client.post(f"/tasks/{task_id}/execute", json={"actor": "orchestrator"})
    assert executed.status_code == 200
    assert executed.json()["status"] == "completed"


def test_intervention_pause_blocks_execution(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    payload = {
        "title": "Internal refactor",
        "stage": "development",
        "summary": "Refactor payment retry logic and add telemetry.",
        "repository": "enterprise/payments",
        "branch": "feature/retry-logic",
        "proposed_actions": ["Refactor retry module", "Add tests"],
        "impacts_production": False,
        "touches_security_controls": False,
        "touches_data_layer": False,
        "estimated_files_changed": 10,
        "confidence": 0.9,
    }
    created = client.post("/tasks", json=payload).json()
    task_id = created["id"]

    client.post(
        f"/tasks/{task_id}/approve",
        json={"reviewer": "eng-manager", "decision": "approve", "reason": "Approved"},
    )

    paused = client.post(
        f"/tasks/{task_id}/intervene",
        json={"actor": "incident-commander", "action": "pause", "reason": "Freeze window"},
    )
    assert paused.status_code == 200
    assert paused.json()["paused"] is True

    blocked = client.post(f"/tasks/{task_id}/execute", json={"actor": "orchestrator"})
    assert blocked.status_code == 409
    assert "paused" in blocked.json()["detail"].lower()


def test_audit_log_contains_key_events(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    payload = {
        "title": "CI health cleanup",
        "stage": "governance",
        "summary": "Clean stale CI jobs and align templates for security scanning.",
        "repository": "enterprise/platform",
        "branch": "main",
        "proposed_actions": ["Normalize pipelines"],
        "impacts_production": False,
        "touches_security_controls": False,
        "touches_data_layer": False,
        "estimated_files_changed": 2,
        "confidence": 0.88,
    }
    created = client.post("/tasks", json=payload).json()
    task_id = created["id"]

    client.post(
        f"/tasks/{task_id}/approve",
        json={"reviewer": "governance-owner", "decision": "approve", "reason": "Approved"},
    )
    client.post(f"/tasks/{task_id}/execute", json={"actor": "orchestrator"})

    audit = client.get(f"/tasks/{task_id}/audit")
    assert audit.status_code == 200
    event_types = [event["event_type"] for event in audit.json()["events"]]
    assert "task_created" in event_types
    assert "approval_submitted" in event_types
    assert "execution_started" in event_types
    assert "execution_finished" in event_types


def test_model_risk_requires_model_risk_approval(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    payload = {
        "title": "Autonomous rollout with drift",
        "stage": "deployment",
        "summary": "High autonomy rollout while model telemetry indicates drift and prior failures.",
        "repository": "enterprise/release",
        "branch": "main",
        "proposed_actions": ["Deploy release", "Update configuration"],
        "impacts_production": True,
        "touches_security_controls": False,
        "touches_data_layer": False,
        "estimated_files_changed": 25,
        "confidence": 0.42,
        "drift_signal": 0.88,
        "historical_failure_rate": 0.33,
        "autonomy_level": 5,
        "safety_override_requested": True,
    }
    created = client.post("/tasks", json=payload).json()
    task_id = created["id"]
    assert created["risk_assessment"]["requires_model_risk_approval"] is True

    client.post(
        f"/tasks/{task_id}/approve",
        json={"reviewer": "alice", "decision": "approve", "reason": "Looks okay"},
    )
    client.post(
        f"/tasks/{task_id}/approve",
        json={"reviewer": "security-team-lead", "decision": "approve", "reason": "Security okay"},
    )
    blocked = client.post(
        f"/tasks/{task_id}/execute",
        json={"actor": "orchestrator", "dry_run": True},
    )
    assert blocked.status_code == 409
    assert "Model risk approval required" in blocked.json()["detail"]

    client.post(
        f"/tasks/{task_id}/approve",
        json={"reviewer": "ml-risk-officer", "decision": "approve", "reason": "Model governance approved"},
    )
    dry_run = client.post(f"/tasks/{task_id}/execute", json={"actor": "orchestrator", "dry_run": True})
    assert dry_run.status_code == 200


def test_slack_notification_and_healthcheck_endpoint(tmp_path, monkeypatch):
    client, notifier = _client_with_notifier(tmp_path, monkeypatch)
    payload = {
        "title": "Slack event test task",
        "stage": "development",
        "summary": "Validate that governance events trigger collaboration notifications.",
        "repository": "enterprise/platform",
        "branch": "main",
        "proposed_actions": ["Update lint config"],
    }
    created = client.post("/tasks", json=payload)
    assert created.status_code == 201
    task_id = created.json()["id"]
    assert len(notifier.events) >= 1
    assert notifier.events[0]["event_type"] == "task_created"

    approval = client.post(
        f"/tasks/{task_id}/approve",
        json={"reviewer": "governance-owner", "decision": "approve", "reason": "approved"},
    )
    assert approval.status_code == 200
    assert any(event["event_type"] == "approval_submitted" for event in notifier.events)

    health = client.post("/integrations/slack/test", json={"actor": "tester"})
    assert health.status_code == 200
    assert health.json()["ok"] is True
    assert notifier.healthcheck_calls == 1
