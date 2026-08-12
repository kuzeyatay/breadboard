# Model providers

Breadboard reaches models through **ChatMock**, its local OpenAI-compatible
proxy. Every subsystem — Garden Chat, Hermes, UI-TARS, OpenCode/Hermes,
deep research, the learn pipeline — points at `CHATMOCK_BASE_URL`, so teaching
ChatMock to reach more upstreams gives all of them multi-provider support at
once, with no change to how they are wired.

## Two ways to reach a model

1. **Subscriptions (no API key).** Sign in to plans you already pay for — ChatGPT
   (Accounts tab), plus Claude Pro/Max, Google/Gemini, Kimi and Grok through the
   local subscription proxy. Nothing is billed per token. See
   [Subscriptions](#subscriptions-no-api-key).
2. **API keys.** Google AI Studio is offered as a setup path even before a key
   is saved, because it is the documented recovery route when a subscription
   account is out of quota. Other pay-per-token vendors remain hidden unless
   already configured, and their environment keys are ignored unless explicitly
   opted into (see below).

Both end up as ordinary provider-prefixed model ids, so anything that can run on
one can run on the other.

## What is supported

| Provider | Auth | Kind | Model ids |
| --- | --- | --- | --- |
| Subscriptions | OAuth, via CLIProxyAPI | OpenAI-compatible | `cliproxy/<model>` |
| ChatGPT | OAuth sign-in (Settings → Accounts) | ChatGPT Responses API | `gpt-5.6-sol`, … |
| Anthropic | API key | Native Messages API, translated | `anthropic/claude-opus-4-5` |
| Google Gemini | API key | OpenAI-compatible layer | `google/gemini-2.5-pro` |
| OpenAI | API key | OpenAI | `openai/gpt-5.1` |
| OpenRouter | API key | OpenAI-compatible | `openrouter/<vendor>/<model>` |
| Groq, DeepSeek, xAI, Mistral, Together | API key | OpenAI-compatible | `groq/llama-3.3-70b-versatile`, … |
| Custom endpoint | optional key | OpenAI-compatible | `custom/<model>` |

A local **Ollama** is reached through the custom endpoint (`http://127.0.0.1:11434/v1`).
It is not catalogued separately: needing no key, it counted as configured from a
default base URL alone, so its models showed in the picker whether or not
anything was listening on that port.

Gemini is reached through Google's own OpenAI-compatible endpoint
(`/v1beta/openai`) rather than the native `generateContent` API: it already
covers streaming, tool calls, structured output and vision, so a second
hand-written translator would add failure modes without adding capability.

## Model ids

Public ids stay OpenAI-shaped. Only the **first** path segment is treated as a
provider, and only when it names a provider ChatMock knows — so vendor-scoped
ids survive intact:

```
gpt-5.6-sol                              -> ChatGPT (unchanged)
anthropic/claude-opus-4-5                -> Anthropic, upstream `claude-opus-4-5`
openrouter/anthropic/claude-sonnet-4.5   -> OpenRouter, upstream `anthropic/claude-sonnet-4.5`
default                                  -> the global background model
```

An id whose prefix names no known provider (a stale
`COUNCIL_MODELS=legacy/model-a`) is not a valid ChatGPT model either, so the
council router substitutes its configured fallback instead of forwarding it.

## The background model

**The Intelligence menu owns it.** Picking a model there (next to the composer)
sets the model that everything asking Breadboard for its default runs on: chat,
Hermes, UI-TARS, OpenCode and deep research. Settings → Accounts deliberately
offers no second control — two pickers for one setting is how they drift apart.

`default` is the sentinel that carries it. ChatMock expands it per request, so
changing the selection applies **without restarting** Hermes, OpenCode, UI-TARS
or deep research — those processes launch with `CHATMOCK_MODEL=default`.

It also lets a provider model run in chat. The agent runtime can only name
models declared in its provider config, which covers the ChatGPT ids; declaring
every model of every provider would mean regenerating that config whenever a key
is added. So a provider-prefixed choice is sent as `default`, which *is*
declared, and ChatMock resolves it to the model that was picked.

A bare id the runtime has not registered (`gpt-5`) is **not** substituted this
way — that would quietly answer with a different model, so it stays an error.

* Stored in `<CHATGPT_LOCAL_HOME>/providers.json` as `default_model`.
* `CHATMOCK_DEFAULT_MODEL` overrides the stored value (headless/CI).
* With nothing configured it resolves to `gpt-5.6-sol`, so behavior is
  unchanged until a choice is made.
* Surfaces that pin an explicit model id keep using it.

Because OpenCode resolves `chatmock/{env:CHATMOCK_MODEL}` against its declared
model map, `default` is registered as a model in both
Hermes reads its generated `HERMES_HOME/config.yaml`; standalone OpenCode reads
`opencode-config/opencode.json`.

## Intelligence modes

The reasoning levels the Intelligence menu offers are a property of the **active
model**, not a fixed ladder:

| Model | Modes |
| --- | --- |
| `gpt-5.6-*` | Light, Medium, High, Extra high, Ultra |
| `gpt-5.1` | Light, Medium, High |
| `anthropic/claude-*` | Light, Medium, High |
| `custom/*`, Groq, DeepSeek, … | *none* |

ChatMock reports the honoured levels per model as `reasoning_efforts` on
`/v1/models`; ChatGPT ids come from its model registry, other providers declare
theirs in the catalog. Two rules follow:

* **A mode that does nothing is never offered.** Providers with no reasoning
  notion show no modes at all, and an effort the model does not honour is
  stripped before dispatch — several OpenAI-compatible upstreams reject unknown
  fields outright, so forwarding it would turn a request into a failure.
* **Switching models clamps the selection.** Going from GPT-5.6 (Ultra) to
  Claude (High) moves to the nearest weaker level rather than leaving the UI
  claiming a depth that is not being used.

For Anthropic the levels are real, not cosmetic: they map onto explicit thinking
budgets (`low` 4k, `medium` 8k, `high` 16k tokens), with `max_tokens` raised
above the budget and sampling controls dropped, both of which the API requires.

## Usage limits

The Usage panel reports the **ChatGPT plan's** rate-limit windows, read from
that upstream's response headers. They say nothing about a model served by
another provider, so when one is active the panel says so instead of showing
numbers that describe a different budget — and it stops polling, because its
refresh is a real ChatGPT request that would spend the quota it is reporting on.

Subscription and API-key providers meter usage on their own side; Breadboard
keeps no counter for them.

## Credentials

Keys live in `<CHATGPT_LOCAL_HOME>/providers.json` (mode `0600`), beside the
ChatGPT `auth.json`. The file is re-read whenever it changes, so a key added
through the UI is picked up on the next request.

Resolution order per provider: **stored key → environment variable → unset**.

For pay-per-token providers the environment step is **off by default**. A stray
`OPENAI_API_KEY` — very often ChatMock's own `local` placeholder rather than a
real credential — otherwise marks that provider configured and fills the model
picker with ids that answer 401. Set
`CHATMOCK_ALLOW_ENV_PROVIDER_KEYS=1` to restore the fallback for a headless or
CI deployment that genuinely supplies keys that way.

Providers that need no API key are unaffected: `CLIPROXY_API_KEY` and
`CUSTOM_OPENAI_BASE_URL` are loopback wiring, not purchased credentials.

Secrets never leave ChatMock: `GET /v1/providers` returns a masked hint
(`sk-a…alue`) and a `configured` flag, never the key. The dashboard stores
nothing and clears its inputs after a successful save.

## Management API

Served by ChatMock alongside the OpenAI surface. Like the rest of ChatMock
(including the OAuth login flow) it assumes a loopback binding; the dashboard
proxies these behind its own session auth.

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/providers` | Redacted provider list, default model, model catalog |
| `PUT /v1/providers/<id>` | Set `apiKey`, `baseUrl`, `enabled`, `models` |
| `DELETE /v1/providers/<id>` | Forget stored credentials (env fallback survives) |
| `POST /v1/providers/<id>/verify` | Exercise the credentials, list live models |
| `GET`/`PUT /v1/settings/default-model` | Read/set the background model |

An empty `apiKey` string explicitly forgets the stored key; omitting the field
leaves it untouched. `PUT /v1/settings/default-model` rejects a model no
configured provider can serve, so the setting cannot silently break every
subsystem that asks for `default`.

Dashboard equivalents (session-authenticated):
`/api/chatmock/providers`, `/api/chatmock/providers/verify`,
`/api/chatmock/default-model`.

## Request routing

```
/v1/chat/completions
  ├─ council (Breadboard's kernel) ── ProviderRouter ── ChatGPT upstream
  │                                                  └─ external provider
  └─ council bypass (tool calls, opt-outs) ────────── external provider dispatch
```

The council stays in the path for external models: picking a different model
changes the *brain*, not the *system*. Its `ProviderRouter` routes a
provider-prefixed id to that provider when configured, and falls back to the
ChatGPT upstream when it is not — a half-finished provider setup degrades
instead of breaking a run.

`/v1/completions` serves external models through their chat API.
`/v1/responses` is ChatGPT-only and returns a `PROVIDER_UNSUPPORTED_ENDPOINT`
error for external models rather than silently using the wrong upstream.

`/v1/models` lists ChatGPT ids first (unchanged for existing clients), then one
prefixed id per model of each configured provider.

## Subscriptions (no API key)

[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) (MIT) is a Go proxy
that signs into AI *subscriptions* over OAuth and serves them behind one
OpenAI-compatible endpoint. Breadboard runs it as an optional loopback service
and registers it in ChatMock as the `cliproxy` provider.

Verified against **v7.2.111**, these sign-ins work:

| Subscription | Flow | Notes |
| --- | --- | --- |
| Claude | browser redirect | Claude Pro or Max |
| Google Gemini | browser redirect | Through Antigravity |
| Kimi | device code | Kimi Code subscription |
| Grok (xAI) | device code | x.ai account |

`gemini-cli`, `qwen` and `iflow` return **404** on the public build, so they are
deliberately not offered — a button that always fails is worse than none. (They
exist only in `CLIProxyAPIPlus`, which is not a public repository.)

### ChatGPT is not here — on purpose

CLIProxyAPI *can* sign into ChatGPT (`codex-auth-url`), but Breadboard does not
offer it. ChatMock already owns that account through its own OAuth on the
**Account** tab, and does more with it: the Responses API, reasoning efforts,
fast mode, prompt caching and rate-limit tracking, none of which survive a trip
through a generic chat-completions proxy.

Offering both meant two sign-ins for one account and two ids for every model
(`gpt-5.6-sol` and `cliproxy/gpt-5.6-sol`). So:

* ChatGPT has one sign-in, on the Account tab. The Providers tab shows its live
  status and links there rather than duplicating the control.
* If a ChatGPT account reaches the proxy by other means (CLIProxyAPI's own CLI),
  the model sync **skips every id ChatMock already serves natively**, so a model
  never appears under two names.

### How to use it

1. `npm run dev` starts it with the rest of the stack; `npm run cliproxy` runs
   it alone. The **first launch downloads the binary**; nothing is vendored into
   the repo.

   It is **required** by default: a failure to start aborts the stack, because
   otherwise every subscription model silently disappears and the cause is a log
   line nobody reads. The trade-off is that a first run with no network cannot
   download the binary and will therefore block startup — set
   `CLIPROXY_MODE=optional` on machines where that matters, or `disabled` to
   skip it entirely.
2. Settings → Providers → **Subscriptions** → Connect. The browser opens; for
   Kimi and Grok a device code is shown to type.
3. On success the panel syncs the models the account unlocked into ChatMock, and
   they become selectable as the background model.

### How it works

```
browser ── /api/cliproxy/login ──> CLIProxyAPI /v0/management/<provider>-auth-url
                                     └─> { url, state }
   user completes the sign-in in a browser tab; the proxy hosts the callback
browser ── /api/cliproxy/login?state= ──> /v0/management/get-auth-status -> ok
browser ── /api/cliproxy/sync ──> /v1/models -> stored on ChatMock's `cliproxy`
```

Breadboard never sees a subscription credential: CLIProxyAPI performs the OAuth
exchange and writes the token to its own `auth-dir`. The dashboard only relays a
URL and polls a state.

Two loopback secrets are generated per install under `CLIPROXY_HOME`
(default `~/.breadboard/cliproxy`), mode `0600`:

* `api-key` — the bearer ChatMock presents to the OpenAI surface.
* `management-key` — the `X-Management-Key` for OAuth endpoints. CLIProxyAPI
  bcrypt-hashes it into its own config on startup; the plaintext file is the
  client-side copy.

The generated `config.yaml` binds to `127.0.0.1`, sets `allow-remote: false`,
and disables the bundled control panel — it would otherwise be a second,
unauthenticated surface onto the same OAuth actions. It is rewritten on every
launch so a stale port or secret can never win.

### Lineage

[ProxyPal](https://github.com/heyhuynhgiabuu/proxypal) is a Tauri desktop app
that wraps this same binary as a sidecar. Breadboard uses **none of its code**
(it is Rust + SolidJS, and all provider logic lives in the Go binary), but its
management-API protocol, provider taxonomy and per-provider key/base-URL/model
shape were the reference for this integration.

## Embeddings

ChatMock also serves `POST /v1/embeddings`, and the backend follows from the
model id exactly as it does for chat:

* `local/bge-small-en-v1.5` (the default, 384-dim) runs **inside ChatMock**
  through fastembed — ONNX Runtime on the CPU. No key, no quota, and no network
  once the weights are cached under `<home>/embedding-models`.
* `openai/text-embedding-3-small`, or any other configured provider, relays to
  that provider's own `/embeddings` with the credentials already stored for chat.
  The ChatGPT and Anthropic upstreams have no embeddings endpoint and say so.

`GET /v1/embeddings/models` lists the local catalog with each model's dimension
and a `localAvailable` flag. Embedding models are deliberately **absent** from
`/v1/models`: that list feeds the chat pickers, where a vector model would be a
model that produces no answer.

The local backend is an optional extra — `pip install -e '.[embeddings]'` in
`chatmock/` — because it pulls ONNX Runtime and tokenizers. Without it the
endpoint answers 503 naming the install and everything else keeps working.

**Three subsystems embed through it**, and all three default to the local model,
which is why hybrid retrieval is on out of the box rather than waiting for
someone to buy a key:

| Subsystem | What vectors buy it |
| --- | --- |
| Deep Tutor knowledge bases | `rag` over a Garden — see [DEEP_TUTOR_INTEGRATION.md](DEEP_TUTOR_INTEGRATION.md) |
| Garden semantic retrieval (`lib/semantic-retrieval.ts`) | The semantic half of its hybrid ranking, which used to be dead without `BREADBOARD_EMBEDDING_MODEL` and a key |
| GBrain sidecar (`gbrain-adapter/`) | `hybrid` mode instead of the `lexical_degraded` every unconfigured install reported |

`dashboard/src/lib/embeddings.ts` is the single answer to "which model, from
where, with what key" — `BREADBOARD_EMBEDDING_MODEL` (with base URL, key and
dimensions) points all of them at a paid provider, and
`BREADBOARD_EMBEDDINGS=off` turns embeddings off everywhere, which each consumer
reports honestly rather than faking. Vectors from two models are not comparable,
so anything that stores them stores the model beside them and treats a change as
invalidation.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `CHATMOCK_MODEL` | Model subsystems request; `default` follows the global choice |
| `CHATMOCK_DEFAULT_MODEL` | Overrides the stored background model |
| `CHATMOCK_PROVIDERS_FILE` | Path to `providers.json` (tests, containers) |
| `CHATMOCK_ALLOW_ENV_PROVIDER_KEYS` | Let env vars configure pay-per-token providers (off by default) |
| `CLIPROXY_MODE` | `required` (default), `optional`, or `disabled` |
| `CLIPROXY_PORT` | Subscription proxy port (default `8317`) |
| `CLIPROXY_HOME` | Binary, config, secrets and OAuth credentials |
| `CLIPROXY_VERSION` | Pin a release instead of tracking the latest |
| `CLIPROXY_API_KEY`, `CLIPROXY_BASE_URL` | Generated/derived; override only for a remote proxy |
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY`, `MISTRAL_API_KEY`, `TOGETHER_API_KEY` | Per-provider key fallbacks |
| `ANTHROPIC_BASE_URL`, `GEMINI_BASE_URL`, `CUSTOM_OPENAI_BASE_URL`, … | Per-provider base-URL overrides |
| `BREADBOARD_EMBEDDINGS` | `off` disables embeddings for every subsystem |
| `BREADBOARD_EMBEDDING_MODEL`, `_BASE_URL`, `_API_KEY`, `_DIMENSIONS` | Point every subsystem at a provider instead of the local model |
| `CHATMOCK_EMBEDDING_CACHE` | Where local ONNX weights are cached |
| `CHATMOCK_PROVIDER_CONNECT_TIMEOUT`, `CHATMOCK_PROVIDER_READ_TIMEOUT`, `CHATMOCK_PROVIDER_MAX_ATTEMPTS`, `CHATMOCK_PROVIDER_RETRY_BACKOFF_SECONDS` | External-provider HTTP tuning |

## Tests

* `chatmock/tests/test_providers.py` — 54 tests: store round-trip and
  redaction, id resolution, router fallback, OpenAI-compatible passthrough,
  Anthropic translation (messages, tools, streaming), management API, and
  end-to-end routing through both the council and the passthrough.
* `dashboard/tests/chatmock-providers.test.mjs` — provider-id validation,
  error mapping, sentinel wiring across launchers and the desktop shell, and
  the guarantee that the settings panel never renders a stored key.
* `dashboard/tests/cliproxy.test.mjs` — the offered OAuth providers match what
  the public build exposes, per-install secret generation and permissions, the
  loopback/locked-down config, Windows path handling, account detection, and
  that no route hands a credential to the browser.

Verified live against CLIProxyAPI v7.2.111: the launcher downloads and starts
it, the generated secrets authorize the management API (and a wrong key gets
401), Claude returns a `claude.ai` redirect URL, Kimi returns a device code, and
a `cliproxy/<model>` request travels ChatMock → CLIProxyAPI. Completing an actual
subscription sign-in requires the user's own credentials and was not performed.
