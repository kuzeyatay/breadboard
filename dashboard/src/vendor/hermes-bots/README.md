# Hermes Bot Mode adaptations

Source: NousResearch/hermes-agent, commit
`f97608f178d1ffeca59860195ab7da295f7c8e5f` (v0.21.5 / v2026.9.24).

- `identity.ts`: adapted from `apps/desktop/src/plugins/hermes-bots/soul.ts`
  (`composeSoul`) and `profile-ops.ts` (`duplicateBot` name allocation).
- License: MIT, Copyright (c) 2026 Nous Research; retained in LICENSE.

Breadboard supplies its own authenticated storage and canonical conversation
mapping. The SDK/host dependencies and legacy shell messaging protocol are
omitted: these bots use Breadboard's runtime and permission broker. Identity
text describes saved chat history without promising a separate Hermes home.
Names are display labels with a 60-character limit rather than profile paths.
The duplicate allocator is account-local, case-insensitive, and preserves the
suffix when truncating a long name. Avatars use `bot-avatars`, as requested.
