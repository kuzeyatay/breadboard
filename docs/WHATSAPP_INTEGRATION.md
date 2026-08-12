# WhatsApp integration

Message Breadboard from your phone. Every WhatsApp conversation opens a real
Breadboard chat that appears in the Terminal's Recents, carries the same memory,
capabilities, artifacts and audit trail as a chat you type by hand, and can be
picked up and continued in the app.

## Why Breadboard drives the bridge instead of running `hermes gateway`

Hermes ships a complete WhatsApp stack: a Baileys bridge plus a messaging gateway
that answers messages itself. Running `hermes gateway` would have been less code,
but the gateway answers from **its own session store** — the conversation would
live inside Hermes and never appear in Breadboard. The requirement was the
opposite: a WhatsApp message must create a chat the desktop app can see.

So Breadboard owns the bridge process directly and routes every message through
its own pipeline. This is the same division of responsibility the Hermes runtime
migration already establishes (`docs/HERMES_RUNTIME.md`): Breadboard is
authoritative for conversations, permissions and persistence; Hermes owns only the
model loop.

```text
WhatsApp on your phone
        ↓  linked-device protocol
Hermes Baileys bridge          hermes-agent/scripts/whatsapp-bridge/bridge.js
        ↓  loopback HTTP (127.0.0.1)
Breadboard WhatsApp service    dashboard/src/lib/whatsapp/service.ts
        ↓
createConversation → resolveConversationRuntime → startConversationTurn
        ↓
Hermes runtime (model loop) → ChatMock
        ↓
durable transcript  ──→ Terminal Recents (desktop app)
                    └─→ reply sent back to WhatsApp
```

## What the user does

1. Open the **Intelligence** menu next to the composer → **Settings** →
   **Messaging**, and pick **WhatsApp**. (This used to be an icon in the Terminal
   bar; linking a phone is a once-a-year setup task, and it now sits beside
   Telegram, since "which of my messaging apps can reach Breadboard" is one
   question. The service picker carries each one's live state as a dot.)
2. Press **Link with QR code**. First use installs the bridge's npm dependencies
   (once, about a minute), then a QR code appears.
3. On the phone: WhatsApp → Settings → Linked devices → Link a device → scan.
4. The gateway starts on its own. Message the linked number and Breadboard
   answers; the chat is already in Recents.

`/help` and `/new` work from WhatsApp. `/new` forces a fresh chat instead of
continuing the current one.

## Modes

| Mode | How it works | Notes |
| --- | --- | --- |
| **Personal self-chat** (default) | Link your own WhatsApp; message yourself. | The bridge forwards only your own messages in your own self-chat, so there is no allowlist to manage. |
| **Separate bot number** | Link a second number; people message it. | Requires an allowlist — specific numbers, or `*` for everyone. Bot mode refuses an empty allowlist. |

## Threading

A WhatsApp thread keeps writing into the same Breadboard chat while it stays
warm, and opens a new chat after a quiet spell (default 6 hours,
`BREADBOARD_WHATSAPP_NEW_CHAT_AFTER_MINUTES`). The mapping lives in
`whatsapp_chats`; deleting the Breadboard chat simply causes the next message to
open a new one.

## Security

- **Credentials never touch Breadboard.** The linked-device session lives on disk
  under Hermes's private directory (`~/.hermes/platforms/whatsapp/session`, or
  `HERMES_HOME`), the same path `hermes whatsapp` uses. Nothing about it is stored
  in SQLite and nothing about it is sent to the browser.
- **The QR payload never leaves the server.** It is a live pairing credential, so
  only a rendered PNG reaches the browser.
- **One owner.** Whoever pairs the device owns it; other Breadboard accounts on
  the same machine get 403 from every WhatsApp route and cannot see its chats.
- **Two allowlist checks.** The bridge gates inbound traffic from its environment,
  and Breadboard re-decides from stored settings before a message can spend
  tokens — the bridge is a separate process whose environment can be stale.
- **Redelivery is idempotent.** WhatsApp redelivers on reconnect; a message id may
  only ever produce one turn (`whatsapp_seen_messages`).
- **Unattended means unattended.** A turn that stops for a permission decision is
  not auto-approved — WhatsApp is told to open the app.
- **Unlink removes the credentials.** "Unlink device" stops the bridge and deletes
  the session directory, so the device stops working; remove the entry from
  WhatsApp → Linked devices on the phone as well.

The bridge uses WhatsApp's linked-device protocol and is **not** an official
WhatsApp integration. Accounts using third-party bridges can be restricted: keep
usage conversational, do not send bulk messages, and prefer a dedicated number for
bot mode. For a public or commercial deployment, Meta's official path
(`hermes whatsapp-cloud`) is the stable choice and is not wired into Breadboard.

## Files

| Area | Path |
| --- | --- |
| Process supervisor (pair + gateway) | `dashboard/src/lib/whatsapp/bridge.ts` |
| Message → chat routing | `dashboard/src/lib/whatsapp/inbound.ts`, `inbound-policy.ts` |
| Drain loop, lifecycle, autostart | `dashboard/src/lib/whatsapp/service.ts` |
| Settings, chat map, dedupe | `schema.ts`, `store.ts`, `instance.ts` |
| Status payload (QR rendering) | `dashboard/src/lib/whatsapp/status.ts` |
| Routes | `dashboard/src/app/api/whatsapp/route.ts`, `connection/route.ts` |
| UI | `dashboard/src/app/components/settings-whatsapp.tsx`, inside `settings-messaging.tsx` (Settings → Messaging) |
| Autostart | `dashboard/src/instrumentation-node.ts` |
| Desktop packaging | `desktop/scripts/prepare-app-resources.mjs`, `verify-package.mjs` |
| Tests | `dashboard/tests/whatsapp-store.test.mjs`, `whatsapp-integration.test.mjs` |

## Desktop packaging

The installer stages `hermes-agent/scripts/whatsapp-bridge` **with its production
`node_modules` already installed**, because the bundled Node runtime is `node.exe`
alone — there is no npm on the user's machine to install Baileys at first use.
`verify-package.mjs` fails the build if either the bridge or its dependencies are
missing. In a plain repo checkout there is no such constraint: the first
**Connect** runs `npm install` in the bridge directory itself.

The install step is shared with the ui-tars-adapter staging through
`installProductionDependencies()`, which keeps the OneDrive workaround (install in
the OS temp directory, then materialize the tree) in one place.

## Configuration

All optional; the defaults work for a normal checkout and for the packaged
desktop app.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BREADBOARD_WHATSAPP_ENABLED` | on | Set `false` to hide the feature entirely. |
| `BREADBOARD_WHATSAPP_BRIDGE_DIR` | `<repo>/hermes-agent/scripts/whatsapp-bridge` | Where `bridge.js` lives. Falls back to `HERMES_APP_DIR`. |
| `BREADBOARD_WHATSAPP_SESSION_DIR` | `<HERMES_HOME>/platforms/whatsapp/session` | Linked-device credentials. |
| `BREADBOARD_WHATSAPP_BRIDGE_PORT` | `8099` | Loopback port for the bridge's HTTP API. |
| `BREADBOARD_WHATSAPP_NODE` | the server's own Node | Node binary used to spawn the bridge. |
| `BREADBOARD_WHATSAPP_REPLY_PREFIX` | `🌱 *Breadboard*` header | Prepended in self-chat mode; also the bridge's echo guard, so an empty value is only safe in bot mode. |
| `BREADBOARD_WHATSAPP_NEW_CHAT_AFTER_MINUTES` | `360` | Quiet period after which a thread opens a new chat. |

## Verified / not verified

Verified:

- The real bridge, driven by Breadboard's supervisor, produces a live 277-character
  pairing payload which renders to a scannable PNG; cancelling returns cleanly to
  `disconnected`.
- Dependency install into `hermes-agent/scripts/whatsapp-bridge` (142 packages).
- 24 unit/wiring tests, `tsc --noEmit`, `eslint`, `next build`.

Not verified (needs a phone and a live account):

- An actual QR scan, a real inbound message, and a reply delivered back to
  WhatsApp. The pairing half of that path is exercised above; the message half is
  covered by tests against the bridge's own contract, not by a live send.

Not implemented:

- Incoming media and voice notes. The bridge downloads them, but Breadboard
  describes the attachment to the agent rather than opening it, so the model never
  claims to have seen something it did not. Voice transcription (Hermes's STT path)
  is not wired up.
- Outbound media **on the reply path**. Replies to an inbound message are text.
  Sending an artifact as a file *from* Breadboard is implemented separately —
  see `docs/SEND_TO_MY_PHONE.md`.
- The official WhatsApp Business Cloud API path.

## Sending the other way

Everything above is inbound: a message arrives and is answered. Asking Breadboard
to send something to your WhatsApp is `docs/SEND_TO_MY_PHONE.md`.
