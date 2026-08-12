# Telegram integration

Message Breadboard from Telegram. Every Telegram conversation opens a real
Breadboard chat that appears in the Terminal's Recents, carries the same memory,
capabilities, artifacts and audit trail as a chat you type by hand, and can be
picked up and continued in the app.

It sits beside WhatsApp in **Intelligence → Settings → Messaging**, and it is
deliberately the same shape as `docs/WHATSAPP_INTEGRATION.md`: an owned
connection, an allowlist, a chat→conversation map, and idempotent delivery.

## Why there is no bridge process

WhatsApp needs a bridge because its protocol needs a client. Telegram does not —
the Bot API is ordinary HTTPS, so the "bridge" is a long-poll loop inside the
Next.js server process, the same process that already runs the scheduled-chat
scheduler and the WhatsApp drain loop.

```text
Telegram on your phone
        ↓  Bot API (official)
long-poll loop                 dashboard/src/lib/telegram/gateway.ts
        ↓  in-process queue
Breadboard Telegram service    dashboard/src/lib/telegram/service.ts
        ↓
createConversation → resolveConversationRuntime → startConversationTurn
        ↓
Hermes runtime (model loop) → ChatMock
        ↓
durable transcript  ──→ Terminal Recents (desktop app)
                    └─→ reply sent back to Telegram
```

## What the user does

1. In Telegram, message **@BotFather**, send `/newbot`, and pick a name and a
   `@username`. BotFather answers with a token.
2. Open **Intelligence → Settings → Messaging → Telegram**, paste the token, and
   press **Link bot**. Breadboard checks it against Telegram before storing it, so
   a typo is reported here rather than as a bot that silently never answers.
3. Add yourself under **Who can talk to it** — your `@username` or your numeric
   id. Or just message the bot once and press **Allow** next to the entry that
   appears.
4. Message the bot. The chat is already in Recents.

`/help`, `/start` and `/new` work from Telegram. `/new` forces a fresh chat
instead of continuing the current one. Commands sent in a group arrive as
`/help@yourbot`; the suffix is stripped.

## Who can talk to it

A bot's `@name` is public — anyone who learns it can message it — so **an empty
allowlist means nobody, not everybody**. Entries are `@usernames` (matched
case-insensitively, the way Telegram treats them) or numeric ids; `*` is the
explicit opt-in to answering strangers.

A sender who is turned away gets **silence**, not a "you are not allowed" reply
that would confirm the bot is live. They are listed in the panel under "Messaged
the bot and got no answer" with an **Allow** button, which is how you admit
someone without having to look up an id.

## Threading

A Telegram thread keeps writing into the same Breadboard chat while it stays
warm, and opens a new chat after a quiet spell (default 6 hours,
`BREADBOARD_TELEGRAM_NEW_CHAT_AFTER_MINUTES`). The mapping lives in
`telegram_chats`; deleting the Breadboard chat simply causes the next message to
open a new one.

## Security

- **The token never touches the browser or the database.** It is written to
  `~/.hermes/platforms/telegram/bot-token` (mode `600`, or `HERMES_HOME` /
  `BREADBOARD_TELEGRAM_TOKEN_FILE`). The status payload carries only whether a
  token exists and which bot it resolved to. The token is part of every Bot API
  URL, so no URL and no raw response ever reaches an error message or a log line.
- **One owner.** Whoever links the bot owns it; other Breadboard accounts on the
  same machine get 403 from every Telegram route and cannot see its chats.
- **The allowlist is re-decided per message**, from stored settings, before a
  message can spend tokens.
- **Replays are idempotent.** Telegram redelivers every update until it is
  acknowledged by offset. The offset is persisted as it advances (monotonically —
  a late write cannot rewind it), and a message id may still only ever produce one
  turn (`telegram_seen_messages`).
- **Unattended means unattended.** A turn that stops for a permission decision is
  not auto-approved — Telegram is told to open the app.
- **Hopeless failures stop the loop.** A rejected token and a stolen update stream
  (HTTP 409: another poller or a webhook owns the bot) end the poll with a stated
  reason instead of retrying forever. Transient failures back off, and the backoff
  is abortable so **Disconnect** never waits out a 25-second long poll.

This is Telegram's own Bot API, so unlike WhatsApp there is no
terms-of-service risk and nothing unofficial in the path. The trade-off is what a
bot can see: in groups it reads nothing unless BotFather's privacy mode is turned
off or the bot is an admin.

## Files

| Area | Path |
| --- | --- |
| Long-poll loop, queue, state | `dashboard/src/lib/telegram/gateway.ts` |
| Bot API calls (+ reply splitting) | `dashboard/src/lib/telegram/client.ts` |
| Token on disk | `dashboard/src/lib/telegram/credentials.ts` |
| Message → chat routing | `dashboard/src/lib/telegram/inbound.ts`, `inbound-policy.ts` |
| Drain loop, lifecycle, autostart | `dashboard/src/lib/telegram/service.ts` |
| Settings, offset, chat map, dedupe | `schema.ts`, `store.ts`, `instance.ts` |
| Status payload | `dashboard/src/lib/telegram/status.ts` |
| Routes | `dashboard/src/app/api/telegram/route.ts`, `connection/route.ts` |
| UI | `dashboard/src/app/components/settings-telegram.tsx`, inside `settings-messaging.tsx` |
| Autostart | `dashboard/src/instrumentation-node.ts` |
| Tests | `dashboard/tests/telegram-store.test.mjs`, `telegram-integration.test.mjs`, `telegram-gateway-loop.test.mjs` |

Nothing has to be staged for the desktop build: there is no external process and
no dependency beyond `fetch`.

## Configuration

All optional; the defaults work for a normal checkout and for the packaged
desktop app.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BREADBOARD_TELEGRAM_ENABLED` | on | Set `false` to hide the feature entirely. |
| `BREADBOARD_TELEGRAM_BOT_TOKEN` | — | Supply the token from the environment. Wins over the stored file and cannot be removed from the UI. |
| `BREADBOARD_TELEGRAM_TOKEN_FILE` | `<HERMES_HOME>/platforms/telegram/bot-token` | Where the linked token is stored. |
| `BREADBOARD_TELEGRAM_API_BASE` | `https://api.telegram.org` | Point at a self-hosted Bot API server. |
| `BREADBOARD_TELEGRAM_NEW_CHAT_AFTER_MINUTES` | `360` | Quiet period after which a thread opens a new chat. |

## Verified / not verified

Verified:

- The real long-poll loop, driven against a stand-in Bot API on loopback: it
  connects, queues an update, advances and hands out the offset, acknowledges it
  on the next poll, sends a reply as plain text, and stops in well under a second
  without waiting on the in-flight poll.
- The give-up paths: a 409 conflict and a rejected token each stop the loop
  instead of retrying, and a token rejected up front fails `connect` itself.
- Both Settings sections render (linked and unlinked), `tsc --noEmit`, `eslint`.

Not verified (needs a real bot token):

- A live BotFather token, a real inbound message, and a reply delivered back to
  Telegram.

Not implemented:

- Incoming media. The attachment is described to the agent rather than opened, so
  the model never claims to have seen something it did not.
- Outbound media **on the reply path**. Replies to an inbound message are text.
  Sending an artifact as a file *from* Breadboard is implemented separately —
  see `docs/SEND_TO_MY_PHONE.md`.
- Webhook mode. Breadboard long-polls, and clears any webhook the bot had — the
  two cannot both be active.

## Sending the other way

Everything above is inbound: a message arrives and is answered. Asking Breadboard
to send something to your Telegram is `docs/SEND_TO_MY_PHONE.md`. Note the
asymmetry with WhatsApp: a bot cannot open a conversation, so you must have
messaged it at least once before anything can be sent to you.
