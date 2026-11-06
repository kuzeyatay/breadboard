# Personality bots

Open **Capabilities → Bots**. The six starter personalities are Sage (teacher),
Spark (creative partner), Moss (reflection), Byte (engineering), Nova (research),
and Boo (storytelling). **New bot** creates your own. Settings edits a bot's
name, description, personality, avatar shape, color, and face. Duplicate makes
an editable copy. There are 18 avatar shapes from Libraries.dev's `bot-avatars`.

**Open chat** creates or reopens that bot's dedicated saved conversation. Bot
identity appears above the conversation, and its avatar replaces the thinking
orb. Live work animates; completed turns keep a still avatar. Reduced-motion
changes immediately stop animation. Regular conversations retain their orb.

Personality changes apply to the next turn, with Agent mode on or off. Bots use
the conversation's selected model and existing tool permissions. Each bot has
its own transcript; the existing account memory settings still apply. Removing
a bot hides it from the roster and preserves its identity in saved chats.

## Implementation

- `conversation_bots` stores account-owned definitions, including customized
  starter bots. Defaults seed once and do not overwrite edits or removals.
- `bot_chats` links each bot to one canonical conversation. All mutations and
  conversation lookups are scoped to the authenticated user.
- The personality enters the Hermes system prompt and the direct provider
  instructions. The full bot personality is retained within the persona budget,
  including when a specialist is also selected.
- Hermes Bot Mode's identity and duplicate-name helpers were adapted from
  v0.21.5, pinned to commit `f97608f178d1ffeca59860195ab7da295f7c8e5f`, with its
  MIT license retained under `dashboard/src/vendor/hermes-bots`.
- This integrates personality bots into Breadboard's runtime. It does not
  replace the customized Hermes checkout or import upstream's separate profile
  homes, peer messaging, groups, or routines.

## Verification (2026-09-26)

From `dashboard`:

```powershell
node --test tests/bots-store.test.mjs tests/bots-mode.test.mjs
node node_modules/typescript/bin/tsc -p tsconfig.bots.json --pretty false
npx eslint src/lib/bots src/app/components/bots src/app/api/bots src/vendor/hermes-bots/identity.ts src/app/components/assistant-response-meta.tsx
```

The 11 focused tests exercise real SQLite storage, canonical conversation
creation, HTTP handler validation and ownership, archive behavior, prompt
composition, and the direct turn pipeline. The provider is a deterministic
fixture: requests are inspected and streamed replies are persisted, without
calling a paid model. Unrelated hooks and teaching preparation are stubbed.

The Chromium test uses the actual Capabilities shell, Bots components, avatar
library, response metadata, HTTP handlers, and a temporary database. It covers
creation, editing, copying, removal, failed-save recovery, chat navigation and
reopening, ordinary-chat fallback, avatar lifecycle, live reduced-motion
changes, and a 390px viewport. Other capability panels and Next navigation are
test fixtures. Screenshots are under `qa/bots-*.png`.

These tests do not claim a live model's personality behavior or an installed
desktop production build was verified. Full-repository TypeScript checking
also reports unrelated errors in vendored OpenMAIC and Quartz editor types;
the scoped check covers the changed application code and its dependencies.

Results: all 11 feature tests passed, the scoped TypeScript check passed, and
the targeted lint check passed. Another 20 regression tests passed across
Agency persona integration, thinking text and browser UI, token-arrow motion,
and the dashboard test runner. The browser-lane manifest and its expected list
include the new Bots test.
