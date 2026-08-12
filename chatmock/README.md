<div align="center">

# ChatMock

**Allows Codex to work in your favourite chat apps and coding tools.**

[![PyPI](https://img.shields.io/pypi/v/chatmock?color=blue&label=pypi)](https://pypi.org/project/chatmock/)
[![Python](https://img.shields.io/pypi/pyversions/chatmock)](https://pypi.org/project/chatmock/)
[![License](https://img.shields.io/github/license/RayBytes/ChatMock)](LICENSE)
[![Stars](https://img.shields.io/github/stars/RayBytes/ChatMock?style=flat)](https://github.com/RayBytes/ChatMock/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/RayBytes/ChatMock)](https://github.com/RayBytes/ChatMock/commits/main)
[![Issues](https://img.shields.io/github/issues/RayBytes/ChatMock)](https://github.com/RayBytes/ChatMock/issues)

<br>


</div>

<br>

## Install

#### Homebrew
```bash
brew tap RayBytes/chatmock
brew install chatmock
```

#### pipx / pip
```bash
pipx install chatmock
```

#### GUI
Download from [releases](https://github.com/RayBytes/ChatMock/releases) (macOS & Windows)

#### Docker
See [DOCKER.md](DOCKER.md)

<br>

## Getting Started

```bash
# 1. Sign in with your ChatGPT account
chatmock login

# 2. Start the server
chatmock serve
```

The server runs at `http://127.0.0.1:8000` by default. Use `http://127.0.0.1:8000/v1` as your base URL for OpenAI-compatible apps.

<br>

## Usage

<details open>
<summary><b>Python</b></summary>

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8000/v1",
    api_key="anything"  # not checked
)

response = client.chat.completions.create(
    model="gpt-5.6-sol",
    messages=[{"role": "user", "content": "hello"}]
)
print(response.choices[0].message.content)
```

</details>

<details>
<summary><b>cURL</b></summary>

```bash
curl http://127.0.0.1:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.6-sol",
    "messages": [{"role": "user", "content": "hello"}]
  }'
```

</details>

<br>

## Supported Models

- `gpt-5.6-sol` (default; `gpt-5.6` is an alias)
- `gpt-5.5`
- `gpt-5.4`
- `gpt-5.4-mini`
- `gpt-5.2`
- `gpt-5.1`
- `gpt-5`
- `gpt-5.3-codex`
- `gpt-5.3-codex-spark`
- `gpt-5.2-codex`
- `gpt-5-codex`
- `gpt-5.1-codex`
- `gpt-5.1-codex-max`
- `gpt-5.1-codex-mini`
- `codex-mini`

### Other providers

Breadboard's fork also reaches Anthropic, Google Gemini, OpenAI, OpenRouter,
Groq, DeepSeek, xAI, Mistral, Together, Ollama and any custom OpenAI-compatible
endpoint. Those models are addressed with a provider prefix
(`anthropic/claude-opus-4-5`, `openrouter/<vendor>/<model>`), and `default`
resolves to whichever model was chosen as the global background model.

Credentials are managed through `GET/PUT /v1/providers` (or the dashboard's
Settings → Providers tab) and stored beside `auth.json`. See
[docs/MODEL_PROVIDERS.md](../docs/MODEL_PROVIDERS.md).

### Embeddings

`POST /v1/embeddings` speaks the OpenAI shape and picks its backend from the
model id:

- `local/bge-small-en-v1.5` (and the other ids from `GET /v1/embeddings/models`)
  runs in-process through [fastembed](https://github.com/qdrant/fastembed) —
  ONNX Runtime on the CPU, no key, and no network once the weights are cached
  under `<home>/embedding-models`. This is the only backend that works on a
  machine with no paid provider configured, which is why it is the default.
- `openai/text-embedding-3-small`, `google/…`, or any other configured
  provider relays to that provider's own `/embeddings` with the credentials
  already stored for chat.

Local embeddings need the extra: `pip install -e '.[embeddings]'`. Without it
the endpoint answers 503 naming the install, and everything else keeps working.
The ChatGPT and Anthropic upstreams have no embeddings endpoint and say so
rather than 404ing.

Embedding models are deliberately absent from `/v1/models` — that list feeds
model pickers, where a vector model would be a model that produces no answer.

<br>

## Features

- Tool / function calling
- Vision / image input
- Thinking summaries (via think tags)
- Configurable thinking effort
- Fast mode for supported models
- Web search tool
- OpenAI-compatible `/v1/responses` (HTTP + WebSocket)
- OpenAI-compatible `/v1/embeddings`, with a keyless local backend
- Ollama-compatible endpoints
- Reasoning effort exposed as separate models (optional)

<br>

## Configuration

All flags go after `chatmock serve`. These can also be set as environment variables.

| Flag | Env var | Options | Default | Description |
|------|---------|---------|---------|-------------|
| `--reasoning-effort` | `CHATGPT_LOCAL_REASONING_EFFORT` | none, minimal, low, medium, high, xhigh, max | medium | How hard the model thinks (`max` requires GPT-5.6) |
| `--reasoning-summary` | `CHATGPT_LOCAL_REASONING_SUMMARY` | auto, concise, detailed, none | auto | Thinking summary verbosity |
| `--reasoning-compat` | `CHATGPT_LOCAL_REASONING_COMPAT` | legacy, o3, think-tags | think-tags | How reasoning is returned to the client |
| `--fast-mode` | `CHATGPT_LOCAL_FAST_MODE` | true/false | false | Priority processing for supported models |
| `--enable-web-search` | `CHATGPT_LOCAL_ENABLE_WEB_SEARCH` | true/false | false | Allow the model to search the web |
| `--expose-reasoning-models` | `CHATGPT_LOCAL_EXPOSE_REASONING_MODELS` | true/false | false | List each reasoning level as its own model |

<details>
<summary><b>Web search in a request</b></summary>

```json
{
  "model": "gpt-5.6-sol",
  "messages": [{"role": "user", "content": "latest news on ..."}],
  "responses_tools": [{"type": "web_search"}],
  "responses_tool_choice": "auto"
}
```

</details>

<details>
<summary><b>Fast mode in a request</b></summary>

```json
{
  "model": "gpt-5.6-sol",
  "input": "summarize this",
  "fast_mode": true
}
```

</details>

<br>

## Notes

Use responsibly and at your own risk. This project is not affiliated with OpenAI.

<br>

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=RayBytes/ChatMock&type=Timeline)](https://www.star-history.com/#RayBytes/ChatMock&Timeline)
