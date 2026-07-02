from __future__ import annotations

from typing import Any, Dict, List

import requests

from .types import ModelCall, ProviderError


class OpenRouterProvider:
    """OpenAI-compatible chat completions against OpenRouter."""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://openrouter.ai/api/v1",
        timeout_seconds: int = 600,
    ) -> None:
        if not api_key:
            raise ValueError("OpenRouterProvider requires an api key")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def call_model(self, call: ModelCall) -> str:
        messages: List[Dict[str, Any]] = []
        if isinstance(call.system, str) and call.system.strip():
            messages.append({"role": "system", "content": call.system})
        messages.extend(call.messages or [])

        payload: Dict[str, Any] = {
            "model": call.model,
            "messages": messages,
        }
        if call.temperature is not None:
            payload["temperature"] = call.temperature
        if call.max_tokens is not None:
            payload["max_tokens"] = call.max_tokens

        try:
            response = requests.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                    # Optional OpenRouter attribution headers.
                    "X-Title": "Breadboard Council",
                },
                json=payload,
                timeout=self.timeout_seconds,
            )
        except requests.RequestException as exc:
            raise ProviderError(f"openrouter request failed for {call.model}: {type(exc).__name__}") from exc

        if response.status_code >= 400:
            # Keep upstream bodies out of user-visible errors.
            raise ProviderError(f"openrouter returned HTTP {response.status_code} for {call.model}")

        try:
            body = response.json()
            content = body["choices"][0]["message"]["content"]
        except Exception as exc:
            raise ProviderError(f"openrouter returned an unexpected payload for {call.model}") from exc

        if isinstance(content, list):
            # Some providers return content parts.
            content = "".join(
                part.get("text", "") for part in content if isinstance(part, dict)
            )
        if not isinstance(content, str):
            raise ProviderError(f"openrouter returned no text content for {call.model}")
        return content
