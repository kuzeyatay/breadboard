---
name: resource2skill
description: Create polished websites, PowerPoint decks, Excel workbooks, Blender scenes, and music/audio projects with Microsoft Resource2Skill's distilled multimodal skill libraries. Use when the user wants a complete artifact grounded in reusable design or production techniques and is comfortable delegating the build to the Resource2Skill runtime.
---

# Resource2Skill

Delegate the complete artifact build to the dedicated runtime agent. Do not use
terminal commands or call the cloned Python runtime directly.

breadboard:
  category: prebuilt
  surfaces: [garden_chat, dashboard_terminal]
  requiredTools: []
  requiredArtifactKinds: []
  # The dedicated run is launched by the /agents command rather than through
  # Hermes' artifact-renderer registry. Readiness is shown on the run card.
  requiredRuntimes: []
  requiredMcpServers: []
  optionalMcpServers: []

## Workflow

1. Choose the domain from the requested deliverable: `web`, `ppt`, `excel`,
   `blender`, or `reaper`.
2. Preserve the user's content requirements, dimensions, file format, brand
   constraints, and acceptance criteria in one self-contained brief.
3. Route the request through `/agents:resource2skill`. Add
   `--domain <domain>` when the deliverable is ambiguous.
4. Let the run card stream skill discovery, construction, validation, and
   downloadable outputs. Do not duplicate the artifact with another tool.
5. Relay missing-runtime guidance exactly. Installation is a user action in the
   setup panel; never install dependencies from a model-authored turn.

## Domain routing

- `web`: landing pages, interactive sites, HTML/CSS/JavaScript experiences.
- `ppt`: slide decks and editable `.pptx` presentations.
- `excel`: workbooks, models, dashboards, tables, formulas, and `.xlsx` files.
- `blender`: 3D scenes, product renders, `.blend` files, and rendered images.
- `reaper`: songs, arrangements, MIDI projects, and rendered audio.

Use the explicit form when a request crosses domains:

`/agents:resource2skill --domain ppt Build an 8-slide launch deck …`

Resource2Skill owns the artifact-generation loop. Use other Breadboard skills
for analysis before the handoff only when the user asks for that extra work.
