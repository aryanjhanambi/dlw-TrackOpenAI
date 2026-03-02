from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path

from app.enterprise_models import (
    CompanyPolicyResponse,
    DelegationRecord,
    EngineerRecord,
    RejectionKnowledgeRecord,
    WorkflowStatus,
    WorkflowTaskRecord,
    WorkflowType,
)


class EnterpriseStore:
    def __init__(self, db_path: str = "data/enterprise.db") -> None:
        path = Path(db_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db_path = path
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _recover_db(self) -> None:
        try:
            self._conn.close()
        except Exception:
            pass

        if self._db_path.exists():
            ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
            backup = self._db_path.with_suffix(f".corrupt.{ts}.db")
            try:
                self._db_path.rename(backup)
            except Exception:
                # If backup/rename fails, continue and attempt fresh connect anyway.
                pass

        self._conn = sqlite3.connect(self._db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS companies (
                company_id TEXT PRIMARY KEY,
                lead_name TEXT NOT NULL,
                lead_email TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                session_token TEXT PRIMARY KEY,
                company_id TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS engineers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_id TEXT NOT NULL,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                role TEXT NOT NULL,
                access_scopes TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS company_policies (
                company_id TEXT PRIMARY KEY,
                preferred_languages TEXT NOT NULL,
                formatting_rules TEXT NOT NULL,
                approval_expectations TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS delegations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_id TEXT NOT NULL,
                engineer_email TEXT NOT NULL,
                company_role TEXT NOT NULL,
                responsibilities TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workflow_tasks (
                id TEXT PRIMARY KEY,
                company_id TEXT NOT NULL,
                workflow TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                assignee_email TEXT NOT NULL,
                severity TEXT NOT NULL,
                proposed_changes TEXT NOT NULL,
                status TEXT NOT NULL,
                reviewer TEXT,
                decision_notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS rejection_knowledge (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_id TEXT NOT NULL,
                task_id TEXT NOT NULL,
                workflow TEXT NOT NULL,
                issue TEXT NOT NULL,
                proposed_solution TEXT NOT NULL,
                context TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        self._conn.commit()

    def create_session(self, session_token: str, company_id: str) -> None:
        now = datetime.utcnow().isoformat() + "Z"
        try:
            self._conn.execute(
                """
                INSERT OR REPLACE INTO sessions (session_token, company_id, created_at)
                VALUES (?, ?, ?)
                """,
                (session_token, company_id, now),
            )
            self._conn.commit()
        except sqlite3.DatabaseError:
            self._recover_db()
            self._conn.execute(
                """
                INSERT OR REPLACE INTO sessions (session_token, company_id, created_at)
                VALUES (?, ?, ?)
                """,
                (session_token, company_id, now),
            )
            self._conn.commit()

    def company_id_from_session(self, session_token: str) -> str | None:
        try:
            row = self._conn.execute(
                "SELECT company_id FROM sessions WHERE session_token = ?",
                (session_token,),
            ).fetchone()
        except sqlite3.DatabaseError:
            self._recover_db()
            row = self._conn.execute(
                "SELECT company_id FROM sessions WHERE session_token = ?",
                (session_token,),
            ).fetchone()
        if row is None:
            return None
        return row["company_id"]

    def upsert_company(self, company_id: str, lead_name: str, lead_email: str) -> None:
        now = datetime.utcnow().isoformat() + "Z"
        try:
            self._conn.execute(
                """
                INSERT INTO companies (company_id, lead_name, lead_email, created_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(company_id) DO UPDATE SET
                    lead_name=excluded.lead_name,
                    lead_email=excluded.lead_email
                """,
                (company_id, lead_name, lead_email, now),
            )
            self._conn.commit()
        except sqlite3.DatabaseError:
            self._recover_db()
            self._conn.execute(
                """
                INSERT INTO companies (company_id, lead_name, lead_email, created_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(company_id) DO UPDATE SET
                    lead_name=excluded.lead_name,
                    lead_email=excluded.lead_email
                """,
                (company_id, lead_name, lead_email, now),
            )
            self._conn.commit()

    def get_company(self, company_id: str) -> dict[str, str] | None:
        row = self._conn.execute(
            "SELECT company_id, lead_name, lead_email FROM companies WHERE company_id = ?",
            (company_id,),
        ).fetchone()
        if row is None:
            return None
        return {
            "company_id": row["company_id"],
            "lead_name": row["lead_name"],
            "lead_email": row["lead_email"],
        }

    def replace_engineers(self, company_id: str, items: list[dict[str, object]]) -> None:
        self._conn.execute("DELETE FROM engineers WHERE company_id = ?", (company_id,))
        now = datetime.utcnow().isoformat() + "Z"
        for item in items:
            self._conn.execute(
                """
                INSERT INTO engineers (company_id, name, email, role, access_scopes, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    company_id,
                    item["name"],
                    item["email"],
                    item["role"],
                    json.dumps(item["access_scopes"]),
                    now,
                ),
            )
        self._conn.commit()

    def list_engineers(self, company_id: str) -> list[EngineerRecord]:
        rows = self._conn.execute(
            """
            SELECT id, company_id, name, email, role, access_scopes, created_at
            FROM engineers
            WHERE company_id = ?
            ORDER BY id ASC
            """,
            (company_id,),
        ).fetchall()
        items: list[EngineerRecord] = []
        for row in rows:
            items.append(
                EngineerRecord(
                    id=int(row["id"]),
                    company_id=row["company_id"],
                    name=row["name"],
                    email=row["email"],
                    role=row["role"],
                    access_scopes=self._decode_list_field(row["access_scopes"]),
                    created_at=self._parse_dt(row["created_at"]),
                )
            )
        return items

    def upsert_policy(
        self,
        company_id: str,
        preferred_languages: list[str],
        formatting_rules: str,
        approval_expectations: str,
    ) -> CompanyPolicyResponse:
        now = datetime.utcnow().isoformat() + "Z"
        self._conn.execute(
            """
            INSERT INTO company_policies (
                company_id, preferred_languages, formatting_rules, approval_expectations, updated_at
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(company_id) DO UPDATE SET
                preferred_languages=excluded.preferred_languages,
                formatting_rules=excluded.formatting_rules,
                approval_expectations=excluded.approval_expectations,
                updated_at=excluded.updated_at
            """,
            (company_id, json.dumps(preferred_languages), formatting_rules, approval_expectations, now),
        )
        self._conn.commit()
        return self.get_policy(company_id)

    def get_policy(self, company_id: str) -> CompanyPolicyResponse:
        row = self._conn.execute(
            """
            SELECT company_id, preferred_languages, formatting_rules, approval_expectations, updated_at
            FROM company_policies
            WHERE company_id = ?
            """,
            (company_id,),
        ).fetchone()
        if row is None:
            now = datetime.utcnow().isoformat() + "Z"
            return CompanyPolicyResponse(
                company_id=company_id,
                preferred_languages=["python"],
                formatting_rules="PEP8 + lint clean + typed public interfaces",
                approval_expectations="At least one human reviewer must approve high-impact changes.",
                updated_at=datetime.fromisoformat(now.replace("Z", "+00:00")),
            )
        return CompanyPolicyResponse(
            company_id=row["company_id"],
            preferred_languages=self._decode_list_field(row["preferred_languages"]) or ["python"],
            formatting_rules=row["formatting_rules"],
            approval_expectations=row["approval_expectations"],
            updated_at=self._parse_dt(row["updated_at"]),
        )

    def replace_delegations(self, company_id: str, items: list[dict[str, object]]) -> None:
        self._conn.execute("DELETE FROM delegations WHERE company_id = ?", (company_id,))
        now = datetime.utcnow().isoformat() + "Z"
        for item in items:
            self._conn.execute(
                """
                INSERT INTO delegations (company_id, engineer_email, company_role, responsibilities, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    company_id,
                    item["engineer_email"],
                    item["company_role"],
                    json.dumps(item["responsibilities"]),
                    now,
                ),
            )
        self._conn.commit()

    def list_delegations(self, company_id: str) -> list[DelegationRecord]:
        rows = self._conn.execute(
            """
            SELECT id, company_id, engineer_email, company_role, responsibilities, created_at
            FROM delegations
            WHERE company_id = ?
            ORDER BY id ASC
            """,
            (company_id,),
        ).fetchall()
        items: list[DelegationRecord] = []
        for row in rows:
            items.append(
                DelegationRecord(
                    id=int(row["id"]),
                    company_id=row["company_id"],
                    engineer_email=row["engineer_email"],
                    company_role=row["company_role"],
                    responsibilities=self._decode_list_field(row["responsibilities"]),
                    created_at=self._parse_dt(row["created_at"]),
                )
            )
        return items

    def create_workflow_task(
        self,
        *,
        task_id: str,
        company_id: str,
        workflow: WorkflowType,
        title: str,
        description: str,
        assignee_email: str,
        severity: str,
        proposed_changes: list[str],
    ) -> None:
        now = datetime.utcnow().isoformat() + "Z"
        self._conn.execute(
            """
            INSERT INTO workflow_tasks (
                id, company_id, workflow, title, description, assignee_email, severity,
                proposed_changes, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                company_id,
                workflow.value,
                title,
                description,
                assignee_email,
                severity,
                json.dumps(proposed_changes),
                "pending_review",
                now,
                now,
            ),
        )
        self._conn.commit()

    def update_workflow_task_decision(
        self,
        *,
        task_id: str,
        status: str,
        reviewer: str,
        decision_notes: str,
    ) -> None:
        now = datetime.utcnow().isoformat() + "Z"
        self._conn.execute(
            """
            UPDATE workflow_tasks
            SET status = ?, reviewer = ?, decision_notes = ?, updated_at = ?
            WHERE id = ?
            """,
            (status, reviewer, decision_notes, now, task_id),
        )
        self._conn.commit()

    def list_workflow_tasks(self, company_id: str, workflow: WorkflowType | None) -> list[WorkflowTaskRecord]:
        if workflow is None:
            rows = self._conn.execute(
                """
                SELECT * FROM workflow_tasks
                WHERE company_id = ?
                ORDER BY updated_at DESC
                """,
                (company_id,),
            ).fetchall()
        else:
            rows = self._conn.execute(
                """
                SELECT * FROM workflow_tasks
                WHERE company_id = ? AND workflow = ?
                ORDER BY updated_at DESC
                """,
                (company_id, workflow.value),
            ).fetchall()
        return [self._to_workflow_task(row) for row in rows]

    def get_workflow_task(self, task_id: str) -> WorkflowTaskRecord | None:
        row = self._conn.execute("SELECT * FROM workflow_tasks WHERE id = ?", (task_id,)).fetchone()
        if row is None:
            return None
        return self._to_workflow_task(row)

    def add_rejection_knowledge(
        self,
        *,
        company_id: str,
        task_id: str,
        workflow: WorkflowType,
        issue: str,
        proposed_solution: str,
        context: str,
    ) -> None:
        now = datetime.utcnow().isoformat() + "Z"
        self._conn.execute(
            """
            INSERT INTO rejection_knowledge (
                company_id, task_id, workflow, issue, proposed_solution, context, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (company_id, task_id, workflow.value, issue, proposed_solution, context, now),
        )
        self._conn.commit()

    def list_rejection_knowledge(self, company_id: str, query: str = "") -> list[RejectionKnowledgeRecord]:
        if query.strip():
            pattern = f"%{query.strip()}%"
            rows = self._conn.execute(
                """
                SELECT * FROM rejection_knowledge
                WHERE company_id = ? AND (issue LIKE ? OR proposed_solution LIKE ? OR context LIKE ?)
                ORDER BY id DESC
                """,
                (company_id, pattern, pattern, pattern),
            ).fetchall()
        else:
            rows = self._conn.execute(
                """
                SELECT * FROM rejection_knowledge
                WHERE company_id = ?
                ORDER BY id DESC
                """,
                (company_id,),
            ).fetchall()
        return [
            RejectionKnowledgeRecord(
                id=int(row["id"]),
                company_id=row["company_id"],
                task_id=row["task_id"],
                workflow=self._parse_workflow(row["workflow"]),
                issue=row["issue"],
                proposed_solution=row["proposed_solution"],
                context=row["context"],
                created_at=self._parse_dt(row["created_at"]),
            )
            for row in rows
        ]

    @classmethod
    def _to_workflow_task(cls, row: sqlite3.Row) -> WorkflowTaskRecord:
        return WorkflowTaskRecord(
            id=row["id"],
            company_id=row["company_id"],
            workflow=cls._parse_workflow(row["workflow"]),
            title=row["title"],
            description=row["description"],
            assignee_email=row["assignee_email"],
            severity=row["severity"],
            proposed_changes=cls._decode_list_field(row["proposed_changes"]),
            status=cls._parse_status(row["status"]),
            reviewer=row["reviewer"],
            decision_notes=row["decision_notes"],
            created_at=cls._parse_dt(row["created_at"]),
            updated_at=cls._parse_dt(row["updated_at"]),
        )

    @staticmethod
    def _parse_dt(value: object) -> datetime:
        raw = str(value or "").strip()
        if not raw:
            return datetime.utcnow()
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return datetime.utcnow()

    @staticmethod
    def _decode_list_field(value: object) -> list[str]:
        if value is None:
            return []

        if isinstance(value, list):
            return [str(v).strip() for v in value if str(v).strip()]

        raw = str(value).strip()
        if not raw:
            return []

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = [part.strip() for part in raw.split(",")]

        if isinstance(parsed, list):
            return [str(v).strip() for v in parsed if str(v).strip()]
        if isinstance(parsed, str) and parsed.strip():
            return [parsed.strip()]
        return []

    @staticmethod
    def _parse_workflow(value: object) -> WorkflowType:
        raw = str(value or "").strip().lower()
        try:
            return WorkflowType(raw)
        except ValueError:
            if raw in {"ppt", "slides", "deck"}:
                return WorkflowType.POWERPOINT
            if raw in {"doc", "docs", "document"}:
                return WorkflowType.WORD
            return WorkflowType.CODE

    @staticmethod
    def _parse_status(value: object) -> WorkflowStatus:
        raw = str(value or "").strip().lower()
        try:
            return WorkflowStatus(raw)
        except ValueError:
            mapping = {
                "pending": WorkflowStatus.PENDING_REVIEW,
                "review": WorkflowStatus.PENDING_REVIEW,
                "in_review": WorkflowStatus.PENDING_REVIEW,
                "done": WorkflowStatus.APPROVED,
                "stopped": WorkflowStatus.TERMINATED,
            }
            return mapping.get(raw, WorkflowStatus.PENDING_REVIEW)
