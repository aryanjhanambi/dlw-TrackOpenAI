from __future__ import annotations

from fastapi.testclient import TestClient

from app.enterprise_models import CompanyLoginRequest
from app.enterprise_service import EnterpriseService
from app.enterprise_store import EnterpriseStore
from app.main import app


def _client(tmp_path, monkeypatch):
    store = EnterpriseStore(db_path=str(tmp_path / "enterprise_test.db"))
    service = EnterpriseService(store=store)
    monkeypatch.setattr("app.main.enterprise_store", store)
    monkeypatch.setattr("app.main.enterprise_service", service)
    return TestClient(app)


def _login(client: TestClient) -> str:
    res = client.post(
        "/enterprise/login",
        json={"company_id": "acme-001", "lead_name": "Ava Patel", "lead_email": "ava@acme.com"},
    )
    assert res.status_code == 200
    return res.json()["session_token"]


def test_enterprise_setup_and_workflow_lifecycle(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    token = _login(client)
    headers = {"x-session-token": token}

    eng = client.post(
        "/enterprise/engineers",
        headers=headers,
        json={
            "engineers": [
                {
                    "name": "John Dev",
                    "email": "john@acme.com",
                    "role": "backend engineer",
                    "access_scopes": ["repo:payments", "docs:reports"],
                }
            ]
        },
    )
    assert eng.status_code == 200
    assert len(eng.json()["items"]) == 1

    policy = client.post(
        "/enterprise/policy",
        headers=headers,
        json={
            "preferred_languages": ["python", "typescript"],
            "formatting_rules": "PEP8 and strict linting.",
            "approval_expectations": "Lead + governance signoff for high impact.",
        },
    )
    assert policy.status_code == 200
    assert "python" in policy.json()["preferred_languages"]

    delegations = client.post(
        "/enterprise/delegations",
        headers=headers,
        json={
            "items": [
                {
                    "engineer_email": "john@acme.com",
                    "company_role": "release owner",
                    "responsibilities": ["code review", "release checklist"],
                }
            ]
        },
    )
    assert delegations.status_code == 200
    assert len(delegations.json()["items"]) == 1

    tasks = client.post(
        "/enterprise/workflow-tasks",
        headers=headers,
        json={
            "workflow": "code",
            "title": "Ship retry middleware",
            "description": "Implement retry middleware with rollback guardrails.",
            "assignee_email": "john@acme.com",
            "severity": "high",
            "proposed_changes": ["Add middleware", "Update CI checks"],
        },
    )
    assert tasks.status_code == 200
    task_id = tasks.json()["items"][0]["id"]

    reject = client.post(
        f"/enterprise/workflow-tasks/{task_id}/decision",
        headers=headers,
        json={
            "reviewer": "lead-engineer",
            "decision": "reject",
            "notes": "Need stronger rollback safety.",
            "rejection_issue": "Rollback path not validated.",
            "proposed_solution": "Add rollback integration test and runbook.",
        },
    )
    assert reject.status_code == 200

    kb = client.get("/enterprise/rejection-knowledge", headers=headers)
    assert kb.status_code == 200
    assert len(kb.json()["items"]) == 1
    assert "Rollback path not validated" in kb.json()["items"][0]["issue"]


def test_confirmation_doc_requires_approved_task(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    token = _login(client)
    headers = {"x-session-token": token}

    tasks = client.post(
        "/enterprise/workflow-tasks",
        headers=headers,
        json={
            "workflow": "word",
            "title": "Write incident summary",
            "description": "Create summary document for stakeholder reporting.",
            "assignee_email": "john@acme.com",
            "severity": "medium",
            "proposed_changes": ["Include timeline", "Add mitigation plan"],
        },
    )
    task_id = tasks.json()["items"][0]["id"]

    denied = client.get(f"/enterprise/workflow-tasks/{task_id}/confirmation-doc", headers=headers)
    assert denied.status_code == 409

    client.post(
        f"/enterprise/workflow-tasks/{task_id}/decision",
        headers=headers,
        json={
            "reviewer": "lead-engineer",
            "decision": "approve",
            "notes": "Approved for distribution.",
            "rejection_issue": "",
            "proposed_solution": "",
        },
    )
    approved = client.get(f"/enterprise/workflow-tasks/{task_id}/confirmation-doc", headers=headers)
    assert approved.status_code == 200
    assert "MERIDIAN GOVERNANCE CONFIRMATION" in approved.text


def test_session_token_survives_service_reinstantiation(tmp_path):
    store = EnterpriseStore(db_path=str(tmp_path / "enterprise_sessions.db"))
    service_a = EnterpriseService(store=store)
    session = service_a.login_or_register(
        req=CompanyLoginRequest(
            company_id="acme-002",
            lead_name="Sam Lee",
            lead_email="sam@acme.com",
        )
    )
    service_b = EnterpriseService(store=store)
    company_id = service_b.company_from_session(session.session_token)
    assert company_id == "acme-002"
