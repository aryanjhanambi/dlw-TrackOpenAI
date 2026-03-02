from __future__ import annotations

import json
import os
from typing import Any, Protocol
from urllib import request


class Notifier(Protocol):
    def task_event(
        self,
        *,
        event_type: str,
        actor: str,
        task_id: str,
        title: str,
        status: str,
        detail: dict[str, Any],
    ) -> None: ...

    def healthcheck(self, actor: str) -> bool: ...


class NoOpNotifier:
    def task_event(
        self,
        *,
        event_type: str,
        actor: str,
        task_id: str,
        title: str,
        status: str,
        detail: dict[str, Any],
    ) -> None:
        return None

    def healthcheck(self, actor: str) -> bool:
        return True


class SlackWebhookNotifier:
    def __init__(self, webhook_url: str, channel: str | None = None) -> None:
        self.webhook_url = webhook_url
        self.channel = channel

    def task_event(
        self,
        *,
        event_type: str,
        actor: str,
        task_id: str,
        title: str,
        status: str,
        detail: dict[str, Any],
    ) -> None:
        text = (
            f"*Codex Governor* `{event_type}`\n"
            f"- Task: `{task_id}` ({title})\n"
            f"- Actor: `{actor}`\n"
            f"- Status: `{status}`\n"
            f"- Detail: `{json.dumps(detail, ensure_ascii=True)}`"
        )
        self._post(text)

    def healthcheck(self, actor: str) -> bool:
        try:
            return self._post(f"*Codex Governor* Slack integration check by `{actor}`")
        except Exception:
            return False

    def _post(self, text: str) -> bool:
        payload: dict[str, Any] = {"text": text}
        if self.channel:
            payload["channel"] = self.channel
        data = json.dumps(payload).encode("utf-8")
        req = request.Request(
            self.webhook_url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(req, timeout=2.5) as resp:
            return 200 <= resp.status < 300


def notifier_from_env() -> Notifier:
    webhook = os.getenv("SLACK_WEBHOOK_URL", "").strip()
    channel = os.getenv("SLACK_CHANNEL", "").strip() or None
    if webhook:
        return SlackWebhookNotifier(webhook_url=webhook, channel=channel)
    return NoOpNotifier()
