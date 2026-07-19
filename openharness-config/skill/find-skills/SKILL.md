---
name: find-skills
description: Discover real candidate skills through the authenticated skills.sh API adapter. Metadata-only; never installs, promotes, or executes.
---

# Find skills

Use this skill only in the dashboard terminal or the Breadboard capability
scout after a structured `capability_gap` has identified a missing capability.

1. Call `capability_search` with a concise query. Breadboard runs the documented
   `npx skills find <query>` command server-side and returns real skills.sh
   candidates.
2. Rank candidates by relevance. Report the package identifier, publisher,
   repository, install count, skills.sh URL, and install command exactly as
   returned. Leave unavailable description, version, commit, and permission
   fields unknown; never invent them.
3. Search is metadata-only. Do not download, install, execute, approve, or
   promote a candidate.
4. If the user chooses a candidate, explain that Breadboard must run a separate
   explicit quarantine action. Quarantine uses the official `skills add`
   command in an isolated staging directory, hashes and inspects the downloaded
   files, and does not make the skill agent-accessible.
5. Promotion is a separate human-approved action. Never recommend running an
   unreviewed skill and never approve your own candidate.
