---
name: send-to-my-phone
description: Send something from this chat to the user's own WhatsApp or Telegram so it reaches them on their phone. Use when they say "send this to my whatsapp", "text this to me", "put that on my telegram", "message me this", or ask for a summary, note, reminder or artifact to be sent to them.
license: MIT
allowed-tools:
  - messaging_send
---

# Send to my phone

Use this skill when the user wants something from this conversation to arrive on
their phone. `messaging_send` delivers it to their own WhatsApp self-chat or
their own Telegram thread with the bot they linked.

breadboard:
  category: featured
  surfaces: [dashboard_terminal, garden_chat]
  requiredTools:
    - messaging_send
  requiredArtifactKinds: []
  requiredRuntimes: []
  requiredMcpServers: []
  optionalMcpServers: []

## The destination is not yours to choose

There is no recipient argument, and that is deliberate. Breadboard resolves the
destination itself from the linked account, so this tool can only ever reach the
user's own thread.

If the user asks you to message somebody else — a colleague, a family member, a
number they paste into the chat — say plainly that this only sends to their own
phone, and stop. Do not look for another route, do not draft the message into a
terminal command, and do not ask them to forward it as a workaround unless they
raise that themselves.

## Which channel

Send to the channel the user named. When they say "my phone", "text me" or
"message me" without naming one, pick the channel that is linked; if both are,
ask once rather than guessing, because the two apps reach different threads.

## Writing the message

The text lands in a phone messenger, not in this chat. Write it accordingly:

- Plain sentences. No Markdown headings, tables, code fences, or bullet
  characters that render as literal asterisks on a phone.
- Short. WhatsApp is capped at 4,000 characters and Telegram at 12,000, but the
  useful length is far below either — a message that needs scrolling on a phone
  should have been a summary.
- Self-contained. The user reads it away from this conversation, so "the second
  option we discussed" means nothing. Restate what it refers to.
- No preamble. Send the content, not "Here is the thing you asked for:".

When the user says "send **this**", work out what "this" points at and send that
content, not a description of it. If it was a long answer, send a version
shortened for a phone and say in the chat that you shortened it.

## Attaching an artifact

Pass `artifactId` to attach one artifact from this same conversation as a file.
The rendered output is sent when the artifact has one — the PDF rather than its
Markdown source — and the accompanying `text` becomes the caption.

Artifacts from other chats are refused, by design. If the user wants one of
those, open it in its own conversation.

## After sending

Say what went where in one short line: what you sent, which app, and whether a
file was attached. Do not repeat the whole message back into the chat — the
point was to move it off the screen.

## When it cannot be sent

The tool reports exactly why, and each reason has a specific fix. Pass it on
rather than paraphrasing it as a generic failure:

- Not linked — the user pairs the app in Settings → Messaging.
- WhatsApp linked but not connected — press Connect in that panel.
- No Telegram chat yet — Telegram bots cannot open a conversation, so the user
  must message their bot once before anything can be sent back.
- Rate limited — more than six messages in a minute. Messaging accounts get
  restricted for bursts, so wait rather than retrying immediately.

## Do not send unprompted

Only send when the user asked for something to be sent. Never use this to report
your own progress, to notify them that a long task finished, or to nudge them
about an unanswered question. An unexpected message on someone's phone is a
different thing from a line of text in a chat they are already reading.
