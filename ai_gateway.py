from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import dataclass
from typing import Any
from urllib import error, request

from fastapi import HTTPException

from app.ai_models import CodexDraftRequest, CodexDraftResponse


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _extract_response_text(payload: dict[str, Any]) -> str:
    out = payload.get("output_text")
    if isinstance(out, str) and out.strip():
        return out

    output = payload.get("output")
    if isinstance(output, list):
        chunks: list[str] = []
        for item in output:
            if not isinstance(item, dict):
                continue
            contents = item.get("content")
            if not isinstance(contents, list):
                continue
            for c in contents:
                if not isinstance(c, dict):
                    continue
                text = c.get("text")
                if isinstance(text, str) and text:
                    chunks.append(text)
        if chunks:
            return "\n".join(chunks)
    return ""


def _extract_json_block(text: str) -> dict[str, Any]:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass
    return {}


@dataclass
class _CacheItem:
    value: CodexDraftResponse
    created_at: float


class CodexGateway:
    """
    Thin OpenAI gateway with spend controls:
    - Request-size cap
    - Max calls/hour
    - Optional caching for repeated prompts
    """

    def __init__(self) -> None:
        self.model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
        self.max_output_tokens = _env_int("MERIDIAN_AI_MAX_OUTPUT_TOKENS", 700)
        self.max_input_chars = _env_int("MERIDIAN_AI_MAX_INPUT_CHARS", 12000)
        self.max_calls_per_hour = _env_int("MERIDIAN_AI_MAX_CALLS_PER_HOUR", 40)
        self.cache_ttl_seconds = _env_int("MERIDIAN_AI_CACHE_TTL_SECONDS", 3600)
        self._cache: dict[str, _CacheItem] = {}
        self._call_timestamps: list[float] = []

    def _prompt_hash(self, req: CodexDraftRequest) -> str:
        payload = {
            "project_name": req.project_name.strip(),
            "task_title": req.task_title.strip(),
            "stage": req.stage.strip(),
            "task_prompt": req.task_prompt.strip(),
            "input_code": req.input_code.strip(),
            "policy": req.policy.model_dump(mode="python"),
        }
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    def _prune_budget_window(self) -> None:
        cutoff = time.time() - 3600
        self._call_timestamps = [t for t in self._call_timestamps if t >= cutoff]

    def _check_hourly_budget(self) -> None:
        self._prune_budget_window()
        if len(self._call_timestamps) >= self.max_calls_per_hour:
            raise HTTPException(
                status_code=429,
                detail=(
                    "AI hourly request limit reached. Wait before generating again, "
                    "or raise MERIDIAN_AI_MAX_CALLS_PER_HOUR."
                ),
            )

    def _build_messages(self, req: CodexDraftRequest) -> tuple[str, str]:
        policy = req.policy
        system = (
            "You are Codex acting as a safe enterprise coding assistant.\n"
            "Follow company policy exactly. If policy and user request conflict, policy wins.\n"
            "Return strict JSON with keys: generated_code (string), summary (string), "
            "risk_notes (array of strings).\n"
            "Keep response concise and production-safe."
        )
        user = (
            f"Project: {req.project_name}\n"
            f"Task title: {req.task_title}\n"
            f"SDLC stage: {req.stage}\n\n"
            "Company policy\n"
            f"- Languages: {', '.join(policy.languages) or 'unspecified'}\n"
            f"- Structure: {policy.structure}\n"
            f"- Formatting: {policy.formatting}\n"
            f"- Security: {', '.join(policy.security) or 'unspecified'}\n"
            f"- Constraints: {policy.constraints or 'none'}\n\n"
            f"Task prompt:\n{req.task_prompt}\n\n"
            f"Input code (may be empty):\n{req.input_code or '(none)'}\n\n"
            "Produce code that respects all policy constraints. "
            "If unsafe or impossible, return best safe partial code and explain risks."
        )
        return system, user

    def _call_openai(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            raise HTTPException(
                status_code=503,
                detail="OPENAI_API_KEY is not configured on the server.",
            )

        body = {
            "model": self.model,
            "input": [
                {"role": "system", "content": [{"type": "input_text", "text": system_prompt}]},
                {"role": "user", "content": [{"type": "input_text", "text": user_prompt}]},
            ],
            "max_output_tokens": self.max_output_tokens,
            "temperature": 0.2,
        }
        data = json.dumps(body).encode("utf-8")
        req = request.Request(
            url="https://api.openai.com/v1/responses",
            data=data,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=45) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw)
        except error.HTTPError as exc:
            payload = exc.read().decode("utf-8", errors="replace")
            raise HTTPException(status_code=502, detail=f"OpenAI HTTPError: {payload}") from exc
        except error.URLError as exc:
            raise HTTPException(status_code=502, detail=f"OpenAI connectivity error: {exc.reason}") from exc

    def generate(self, req: CodexDraftRequest) -> CodexDraftResponse:
        if len(req.task_prompt) + len(req.input_code) > self.max_input_chars:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Input too large. Combined task_prompt + input_code must be <= {self.max_input_chars} chars."
                ),
            )

        key = self._prompt_hash(req)
        if not req.force_refresh:
            cached = self._cache.get(key)
            if cached and (time.time() - cached.created_at) <= self.cache_ttl_seconds:
                return cached.value.model_copy(update={"cached": True})

        self._check_hourly_budget()
        system_prompt, user_prompt = self._build_messages(req)
        payload = self._call_openai(system_prompt, user_prompt)
        self._call_timestamps.append(time.time())

        raw_text = _extract_response_text(payload)
        structured = _extract_json_block(raw_text)
        generated_code = str(structured.get("generated_code") or "").strip()
        summary = str(structured.get("summary") or "").strip()
        risk_notes_raw = structured.get("risk_notes")
        risk_notes = [str(x) for x in risk_notes_raw] if isinstance(risk_notes_raw, list) else []

        if not generated_code:
            generated_code = raw_text.strip() or "// No code generated."
        if not summary:
            summary = "Policy-aware draft generated by Codex."

        response = CodexDraftResponse(
            generated_code=generated_code,
            summary=summary,
            risk_notes=risk_notes,
            model=self.model,
            cached=False,
            prompt_chars=len(system_prompt) + len(user_prompt),
            output_chars=len(generated_code),
            metadata={
                "response_id": payload.get("id"),
                "usage": payload.get("usage", {}),
            },
        )
        self._cache[key] = _CacheItem(value=response, created_at=time.time())
        return response
