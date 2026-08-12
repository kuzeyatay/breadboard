# Send to my phone

Say "send this to my WhatsApp" in a Breadboard chat and it arrives on your
phone. Same for Telegram.

This is the outbound half of the two messaging links. `docs/WHATSAPP_INTEGRATION.md`
and `docs/TELEGRAM_INTEGRATION.md` describe the inbound half — a message from
your phone opens a Breadboard chat and gets answered on the thread it came from.
Nothing there could *start* a message; this can.

```text
you, in the Terminal or Garden Chat
        ↓  "send this to my whatsapp"
messaging-intent.ts          selects the send-to-my-phone skill for the turn
        ↓
Hermes runtime → messaging_send tool
        ↓  loopback, capability-checked
/api/hermes/tools/messaging  → lib/hermes/messaging-service.ts
        ↓                           ↓
  destination resolved         WhatsApp bridge  /send, /send-media
  from YOUR linked account     Telegram Bot API sendMessage, sendDocument
        ↓
your own phone
```

## What it can and cannot do

It sends to **your own thread and nowhere else**. On WhatsApp that is your
self-chat; on Telegram it is your private chat with the bot you linked.

The tool has **no recipient argument**. The destination is decided server-side
from the linked account, so there is no parameter for a model — or for anything
that talked its way into a model's context — to point somewhere else. If you ask
for a message to go to another person, the assistant will tell you it only sends
to your own phone.

You can send:

- the assistant's last answer, shortened for a phone;
- text you dictate ("whatsapp myself: pick up milk");
- a summary the assistant writes of a long thread;
- one artifact from the same chat, as a real file attachment.

## How the destination is worked out

`dashboard/src/lib/messaging/self-target.ts` holds this decision on its own, with
no database or transport in it, so it can be tested directly.

**WhatsApp.** Preferred is a JID Breadboard has actually seen inbound for the
linked number. This matters: a self-chat can arrive as either
`<number>@s.whatsapp.net` or `<number>@lid` — WhatsApp's linked-identity domain —
and only one of them will deliver. Reusing an observed JID avoids guessing. If
you have linked a device but never messaged yourself, a JID is constructed from
the stored number, which is correct for ordinary accounts.

**Telegram.** There is no self-chat and no way to construct a destination: a bot
cannot open a conversation, so a chat id only exists once you have messaged the
bot at least once. Until then, "send this to my Telegram" reports exactly that
rather than failing at the API. Group chats are excluded even when you are in
them — sending a chat's contents to a group is precisely the accident this
module exists to prevent.

## Attachments

Pass an artifact id and the file itself is sent: WhatsApp through the bridge's
`/send-media`, Telegram through `sendDocument`. The rendered output is used when
the artifact has one — the PDF rather than its Markdown source.

The artifact must belong to you **and** to the conversation the send happens in.
Ownership alone is not enough: an artifact id is guessable enough that one chat
could otherwise exfiltrate another chat's output to a phone.

This lifts the "outbound media: not implemented" limitation both integration
docs record, for this path only. Inbound media is still described to the agent
rather than opened.

## Limits

| Limit | Value | Why |
| --- | --- | --- |
| WhatsApp message | 4,000 characters | Same ceiling the inbound reply path uses. |
| Telegram message | 12,000 characters | Telegram's own larger limit; the client chunks it. |
| Telegram caption | 1,024 characters | Telegram's cap. Longer text is sent as a second message rather than truncated. |
| Attachment | 40 MB | Above this it is not a phone message. |
| Rate | 6 per minute per channel | A messaging account that emits bursts gets restricted. The cap protects the account, not just your attention. |

Over-length text is refused up front rather than silently truncated halfway
through a chunked delivery.

## Security

- **The destination is not an input.** See above. This is the whole design.
- **The turn must have selected the skill.** The route requires the capability
  token to allow `messaging_send`, the active decision to list it, *and*
  `send-to-my-phone` to be the selected skill for that turn — the same gate
  Premortem and Watch use.
- **Owner-scoped.** Both links already refuse accounts other than the one that
  paired them; this reads the destination through those same stores.
- **Never anonymous.** Quartz AI is denied the tool explicitly, not merely left
  off its allowlist.
- **Audited.** `messaging.send_started`, `messaging.send_completed` and
  `messaging.send_failed` are recorded with the channel and the reason; the
  message body and the raw chat id are not.

## When it will not send

Each refusal names its own fix rather than failing generically: not linked (pair
it in Settings → Messaging), linked but disconnected (press Connect), no Telegram
chat yet (message your bot once), rate limited (wait).

## Triggering

Plain phrasing selects the skill through `lib/hermes/messaging-intent.ts` — you
never type `/send-to-my-phone`, though it works. The bar is an *instruction to
send*, not a mention of a messaging app, because a chat about the WhatsApp
integration itself says "whatsapp" constantly and must not have its turn bound to
this skill. It runs last in the intent chain, so a turn already claimed by
Premortem, the visualizer or the loop kit keeps it.

## Files

| Area | Path |
| --- | --- |
| Destination decision (pure) | `dashboard/src/lib/messaging/self-target.ts` |
| Send, limits, attachments | `dashboard/src/lib/hermes/messaging-service.ts` |
| Route (auth + gating + audit) | `dashboard/src/app/api/hermes/tools/messaging/route.ts` |
| Tool registration | `hermes-agent/plugins/breadboard/plugin.yaml`, `__init__.py` |
| Scope + per-turn grant | `dashboard/src/lib/hermes/tool-scopes.ts`, `capability-broker.ts` |
| Intent | `dashboard/src/lib/hermes/messaging-intent.ts`, chained in `conversations/turn-service.ts` and `hermes/garden-chat-adapter.ts` |
| Skill | `hermes-skills/prebuilt/send-to-my-phone/SKILL.md` |
| Transports | `dashboard/src/lib/whatsapp/bridge.ts` (`sendMedia`), `dashboard/src/lib/telegram/client.ts` (`sendDocument`) |
| Artifact file resolution | `dashboard/src/lib/hermes/artifact-store.ts` (`artifactDeliveryFile`) |
| Tests | `dashboard/tests/messaging-send.test.mjs` |

Nothing new has to be staged for the desktop build: the WhatsApp bridge was
already packaged, and Telegram needs only `fetch`.

## Verified / not verified

Verified: 24 unit and wiring tests covering destination resolution (observed
self-chat preferred over a constructed JID, groups and other people's chats
excluded, both unlinked paths), intent firing and — more importantly — not
firing on discussion of the feature, the ordering of the intent chain, the
route's four gates, tool registration in the runtime that actually loads it, and
that no recipient argument is read anywhere in the service. `tsc --noEmit` clean
for every file touched.

Not verified: a live send. That needs a paired phone and a real BotFather token,
neither of which is available here — the same boundary both integration docs
already record.
