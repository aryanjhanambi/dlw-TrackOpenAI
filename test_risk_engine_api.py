from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_risk_assess_endpoint_returns_deterministic_payload():
    client = TestClient(app)
    patch = """--- a/app/auth/middleware.py
+++ b/app/auth/middleware.py
@@ -1,4 +1,4 @@
-def authenticate(request):
+def authenticate_api_key(request):
     token = request.headers.get('Authorization')
     return verify_token(token)
"""

    response = client.post(
        "/api/v1/risk/assess",
        json={
            "generated_patch": patch,
            "prompt": "Update authentication method",
            "metadata": {"project": "demo"},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["data"]["risk_level"] in {"LOW", "MEDIUM", "HIGH"}
    assert 0 <= body["data"]["risk_score"] <= 100
    assert isinstance(body["data"]["risk_reasons"], list)
