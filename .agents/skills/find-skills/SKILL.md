---
name: find-skills
description: Search for candidate skills that could provide a missing capability, and report their metadata for human review. Discovery only — never installs or executes anything. Restricted to the terminal and capability scout.
---

# Find skills

Discovery-only procedure for locating candidate skills. This skill is available
ONLY to the dashboard terminal and the capability scout. It never installs,
promotes, or runs anything — installation is a separate, explicit, human-approved
quarantine → review → promotion flow handled by Breadboard.

1. Given a described missing capability, query Breadboard's skill search endpoint
   (`GET /api/openharness/skills/search?q=<capability>` on the dashboard). It
   returns candidate skills from the curated registry with: name, source
   (repo/url), version/commit, description, and declared requested commands,
   dependencies, filesystem access, and network access.
2. Rank candidates by relevance to the requested capability.
3. Report the candidates to the user as METADATA ONLY. For each, summarize what
   it does and what it requests (commands, deps, access). Flag anything that
   requests shell, network, or filesystem access as requiring careful review.
4. Do NOT download, install, promote, or execute. If the user wants a candidate,
   tell them Breadboard will download it into QUARANTINE for inspection, and that
   they must explicitly approve promotion after reviewing its files and manifest.

Never recommend running an unreviewed skill.
