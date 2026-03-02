from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


class FakeGateway:
    def generate(self, req):  # noqa: ANN001
        return {
            "generated_code": "def safe_fn():\n    return 'ok'\n",
            "summary": f"Generated for {req.task_title}",
            "risk_notes": ["Needs human review"],
            "model": "fake-codex",
            "cached": False,
            "prompt_chars": 120,
            "output_chars": 31,
            "metadata": {"test": True},
        }


def test_ai_codex_draft_endpoint(monkeypatch):
    monkeypatch.setattr("app.main.ai_gateway", FakeGateway())
    client = TestClient(app)

    payload = {
        "project_name": "Core Project",
        "task_title": "Add retry helper",
        "stage": "development",
        "task_prompt": "Create a Python retry helper with exponential backoff.",
        "input_code": "",
        "policy": {
            "languages": ["python"],
            "structure": "clean-arch",
            "formatting": "black",
            "security": ["no hardcoded secrets"],
            "constraints": "Include unit tests.",
        },
        "force_refresh": False,
    }

    response = client.post("/ai/codex-draft", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert "generated_code" in body
    assert body["model"] == "fake-codex"
