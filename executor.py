from __future__ import annotations

from app.models import ExecutionResult, TaskEntity


class SafeExecutor:
    """
    Simulates delegated agent execution with a strict deny list.
    Replace with real Codex integration in production.
    """

    DENY_PATTERNS = (
        "rm -rf /",
        "drop database",
        "delete from users",
        "curl http://",
        "curl https://",
    )

    def execute(self, task: TaskEntity) -> ExecutionResult:
        actions = " ".join(task.proposed_actions).lower()
        for pattern in self.DENY_PATTERNS:
            if pattern in actions:
                return ExecutionResult(
                    ok=False,
                    output=f"Execution blocked: action contains denied pattern '{pattern}'.",
                )

        # In a real system this is where signed task envelopes would be delegated.
        rendered = "\n".join(f"- {action}" for action in task.proposed_actions)
        return ExecutionResult(ok=True, output=f"Executed delegated actions:\n{rendered}")
