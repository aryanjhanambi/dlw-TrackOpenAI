from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from app.models import (
    ApprovalRecord,
    AuditEvent,
    ModelProfile,
    RiskAssessment,
    Stage,
    TaskEntity,
    TaskStatus,
)


class TaskStore:
    def __init__(self, db_path: str = "data/governor.db") -> None:
        path = Path(db_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                stage TEXT NOT NULL,
                summary TEXT NOT NULL,
                repository TEXT NOT NULL,
                branch TEXT NOT NULL,
                proposed_actions TEXT NOT NULL,
                impacts_production INTEGER NOT NULL,
                touches_security_controls INTEGER NOT NULL,
                touches_data_layer INTEGER NOT NULL,
                estimated_files_changed INTEGER NOT NULL,
                confidence REAL NOT NULL,
                model_profile TEXT NOT NULL DEFAULT '{}',
                risk_assessment TEXT NOT NULL,
                status TEXT NOT NULL,
                paused INTEGER NOT NULL,
                dry_run_completed INTEGER NOT NULL DEFAULT 0,
                approvals TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS audit_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                actor TEXT NOT NULL,
                detail TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (task_id) REFERENCES tasks(id)
            );
            """
        )
        columns = {row["name"] for row in self._conn.execute("PRAGMA table_info(tasks)").fetchall()}
        if "dry_run_completed" not in columns:
            self._conn.execute(
                "ALTER TABLE tasks ADD COLUMN dry_run_completed INTEGER NOT NULL DEFAULT 0"
            )
        if "model_profile" not in columns:
            self._conn.execute(
                "ALTER TABLE tasks ADD COLUMN model_profile TEXT NOT NULL DEFAULT '{}'"
            )
        self._conn.commit()

    def upsert_task(self, task: TaskEntity) -> None:
        approvals_json = json.dumps([a.model_dump(mode="json") for a in task.approvals])
        self._conn.execute(
            """
            INSERT INTO tasks (
                id, title, stage, summary, repository, branch, proposed_actions,
                impacts_production, touches_security_controls, touches_data_layer,
                estimated_files_changed, confidence, model_profile, risk_assessment, status, paused,
                dry_run_completed, approvals, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title=excluded.title,
                stage=excluded.stage,
                summary=excluded.summary,
                repository=excluded.repository,
                branch=excluded.branch,
                proposed_actions=excluded.proposed_actions,
                impacts_production=excluded.impacts_production,
                touches_security_controls=excluded.touches_security_controls,
                touches_data_layer=excluded.touches_data_layer,
                estimated_files_changed=excluded.estimated_files_changed,
                confidence=excluded.confidence,
                model_profile=excluded.model_profile,
                risk_assessment=excluded.risk_assessment,
                status=excluded.status,
                paused=excluded.paused,
                dry_run_completed=excluded.dry_run_completed,
                approvals=excluded.approvals,
                created_at=excluded.created_at,
                updated_at=excluded.updated_at
            """,
            (
                task.id,
                task.title,
                task.stage.value,
                task.summary,
                task.repository,
                task.branch,
                json.dumps(task.proposed_actions),
                int(task.impacts_production),
                int(task.touches_security_controls),
                int(task.touches_data_layer),
                task.estimated_files_changed,
                task.confidence,
                json.dumps(task.model_profile.model_dump(mode="json")),
                json.dumps(task.risk_assessment.model_dump(mode="json")),
                task.status.value,
                int(task.paused),
                int(task.dry_run_completed),
                approvals_json,
                task.created_at.isoformat(),
                task.updated_at.isoformat(),
            ),
        )
        self._conn.commit()

    def get_task(self, task_id: str) -> TaskEntity | None:
        row = self._conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if row is None:
            return None
        return self._row_to_task(row)

    def list_tasks(self) -> list[TaskEntity]:
        rows = self._conn.execute(
            "SELECT * FROM tasks ORDER BY updated_at DESC"
        ).fetchall()
        return [self._row_to_task(r) for r in rows]

    def add_event(self, task_id: str, event_type: str, actor: str, detail: dict[str, Any]) -> None:
        self._conn.execute(
            """
            INSERT INTO audit_events (task_id, event_type, actor, detail, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                task_id,
                event_type,
                actor,
                json.dumps(detail),
                datetime.utcnow().isoformat() + "Z",
            ),
        )
        self._conn.commit()

    def get_events(self, task_id: str) -> list[AuditEvent]:
        rows = self._conn.execute(
            """
            SELECT event_type, actor, detail, created_at
            FROM audit_events
            WHERE task_id = ?
            ORDER BY id ASC
            """,
            (task_id,),
        ).fetchall()
        events: list[AuditEvent] = []
        for row in rows:
            events.append(
                AuditEvent(
                    event_type=row["event_type"],
                    actor=row["actor"],
                    detail=json.loads(row["detail"]),
                    created_at=datetime.fromisoformat(row["created_at"].replace("Z", "+00:00")),
                )
            )
        return events

    @staticmethod
    def _row_to_task(row: sqlite3.Row) -> TaskEntity:
        approvals = [ApprovalRecord.model_validate(a) for a in json.loads(row["approvals"])]
        risk_assessment = RiskAssessment.model_validate(json.loads(row["risk_assessment"]))
        model_profile_raw = json.loads(row["model_profile"]) if row["model_profile"] else {}
        if not model_profile_raw:
            model_profile_raw = {
                "provider": "unknown",
                "model_id": "unknown",
                "model_version": "unknown",
                "drift_signal": 0.0,
                "historical_failure_rate": 0.0,
                "autonomy_level": 1,
                "safety_override_requested": False,
            }
        model_profile = ModelProfile.model_validate(model_profile_raw)
        return TaskEntity(
            id=row["id"],
            title=row["title"],
            stage=Stage(row["stage"]),
            summary=row["summary"],
            repository=row["repository"],
            branch=row["branch"],
            proposed_actions=list(json.loads(row["proposed_actions"])),
            impacts_production=bool(row["impacts_production"]),
            touches_security_controls=bool(row["touches_security_controls"]),
            touches_data_layer=bool(row["touches_data_layer"]),
            estimated_files_changed=int(row["estimated_files_changed"]),
            confidence=float(row["confidence"]),
            model_profile=model_profile,
            risk_assessment=risk_assessment,
            status=TaskStatus(row["status"]),
            approvals=approvals,
            paused=bool(row["paused"]),
            dry_run_completed=bool(row["dry_run_completed"]),
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )
