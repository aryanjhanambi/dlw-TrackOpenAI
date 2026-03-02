# Meridian x Codex 

Meridian is a human-governed AI orchestration platform for enterprise SDLC workflows.
It combines policy-aware code generation, deterministic risk assessment, human approval gates, intervention controls, and auditability.

## What is implemented

- Policy-aware CODEX draft generation (`/ai/codex-draft`)
- Deterministic backend risk assessment engine (`/api/v1/risk/assess`)
- Human approval queue with role-based reviewer selection
- Risk-adaptive review behavior (for example, low-risk reviewer filtering)
- Project isolation under Enterprise ID
- Enterprise-level immutable institutional memory ledger
- Project code preview tabs with per-preview removal
- Full audit timeline and downloadable confirmation records

## Core novelty

- Deterministic risk engine for explainable scoring (0-100 with rule reasons)
- Policy-as-execution: company constraints are injected into AI generation
- Human-in-the-loop governance throughout create -> review -> decision
- Enterprise memory that survives project creation/deletion/reset workflows

## Repo layout

- `app/main.py`: FastAPI app and API routes
- `app/ai_gateway.py`: OpenAI/Codex draft generation gateway
- `app/risk_engine/`: Deterministic risk engine modules
- `app/service.py`, `app/policy.py`, `app/store.py`: core governed task APIs
- `app/enterprise_*.py`: enterprise workflow APIs and storage
- `prototype/index.html`: main webapp UI
- `prototype/style2.css`: webapp styling
- `prototype/app2.js`: frontend logic and API integration
- `tests/`: API tests

## Requirements

- Python 3.11+
- `pip`

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install ".[dev]"
```

## Run locally

```bash
uvicorn app.main:app --reload
```

- Web app: `http://127.0.0.1:8000/`
- OpenAPI docs: `http://127.0.0.1:8000/docs`

## Environment variables

### AI generation

- `OPENAI_API_KEY` (required for `/ai/codex-draft`)
- `OPENAI_MODEL` (optional, default in code)
- `MERIDIAN_AI_MAX_OUTPUT_TOKENS` (optional)


## Main API surfaces

### AI + risk

- `POST /ai/codex-draft`
- `POST /api/v1/risk/assess`

### Enterprise workflow APIs

- `POST /enterprise/login`
- `GET/POST /enterprise/engineers`
- `GET/POST /enterprise/policy`
- `GET/POST /enterprise/delegations`
- `GET/POST /enterprise/workflow-tasks`
- `POST /enterprise/workflow-tasks/{task_id}/decision`
- `POST /enterprise/workflow-tasks/{task_id}/intervene`
- `GET /enterprise/rejection-knowledge`
- `GET /enterprise/workflow-tasks/{task_id}/confirmation-doc`

### Core governed task APIs

- `POST /tasks`
- `GET /tasks`, `GET /tasks/{task_id}`
- `POST /tasks/{task_id}/approve`
- `POST /tasks/{task_id}/execute`
- `POST /tasks/{task_id}/intervene`
- `GET /tasks/{task_id}/audit`

## Frontend walkthrough (current)

After login:

1. `Onboarding`
- Set Enterprise ID + Company Name.
- Projects are scoped to this Enterprise ID.

2. `Organisation Setup`
- Register lead engineer.
- Add members + roles.
- Approval count auto-updates from team composition.

3. `Company Policy`
- Configure languages, structure, formatting, security constraints.
- Optional custom structure sample.

4. `Workflows`
- Create a governed code task.
- Optional "Generate Draft With CODEX".
- View live code preview and step-by-step Codex execution trace.
- Risk assessment is pulled from backend deterministic engine.

5. `Approval Queue`
- Select pending task.
- Review output, run dry-run, approve/reject.
- Reviewer dropdown is sourced from registered members.

6. `Institutional Memory`
- Enterprise-level immutable decision memory (approved/rejected records).
- Not deleted when projects are removed.

7. `Audit`
- End-to-end event timeline and traceability.

8. `Project subtabs`
- Add projects via `+` under Audit.
- Open project code preview tab.
- Remove preview snippets if needed.
- Delete whole project from inside opened project view.

## Persistence behavior

- Frontend workspace state is stored in browser `localStorage`.
- Logout clears auth session only; workspace data remains.
- Reset preserves Institutional Memory ledger while clearing active workspace state.
- Backend persists API task data in SQLite under `data/`.

## Testing

Run tests:

```bash
pytest -q
```

Current test modules include:

- `tests/test_api.py`
- `tests/test_ai_api.py`
- `tests/test_enterprise_api.py`
- `tests/test_risk_engine_api.py`

## Docker

```bash
docker build -t meridian-codex-governor .
docker run --rm -p 8000:8000 meridian-codex-governor
```

## Git hygiene

Do not commit:

- `.env` or API keys
- `data/*.db`
- `__pycache__/`, `.pytest_cache/`, `.venv/`

Current `.gitignore` already excludes Python cache and `data/*.db`.
