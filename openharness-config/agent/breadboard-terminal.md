---
description: Compatibility alias for the retired repository-engineering agent. New sessions use breadboard-assistant.
mode: primary
temperature: 0.2
tools:
  "*": false
  webfetch: true
  websearch: true
permission:
  read: deny
  glob: deny
  grep: deny
  edit: deny
  write: deny
  patch: deny
  bash: deny
  task: deny
  skill: deny
  question: deny
  webfetch: ask
  websearch: ask
---

This legacy identifier is retained for transcript compatibility only. The
Breadboard server migrates it to `breadboard-assistant`, records the migration,
and resets all capability state to knowledge mode. Historical broad repository
permissions are never reactivated.
