# Resource2Skill integration

`/agents:resource2skill` runs Microsoft's cloned Resource2Skill agent against
its distilled Web, PowerPoint, Excel, Blender, and REAPER-style audio libraries.
It uses the model selected in Breadboard through ChatMock and returns every
generated file as a durable, downloadable chat output.

```text
/agents:resource2skill [--domain web|ppt|excel|blender|reaper] <brief>
        |
        v
Breadboard bridge -> Resource2Skill agent + domain MCP -> isolated run output
```

The domain is inferred for ordinary requests (deck, workbook, 3D scene, music,
otherwise Web). Use `--domain` when wording is ambiguous.

## Setup

Resource2Skill requires Python 3.11. Setup is explicit and installs only into
`.runtime/resource2skill-venv`:

```powershell
npm run setup:resource2skill
npm run setup:resource2skill -- --with-web
npm run setup:resource2skill -- --with-blender
npm run setup:resource2skill -- --check
```

PowerPoint rendering additionally needs LibreOffice (`soffice`). Audio rendering
needs `fluidsynth` and `VWS_REAPER_SOUNDFONT`. These system dependencies are
reported by the setup panel and are never installed by a run.

## Architecture and safety

- `scripts/resource2skill-bridge.py` keeps the upstream checkout unchanged,
  injects ChatMock's OpenAI-compatible endpoint, and gives each run a private
  output directory.
- `dashboard/src/lib/resource2skill/` owns discovery, setup, execution,
  per-user run state, output containment, and artifact scanning.
- `dashboard/src/app/api/resource2skill/` exposes authenticated health, setup,
  run, event, abort, and artifact endpoints.
- Workspaces carry an `owner.json`; every read checks the signed-in user and
  decoded artifact paths are containment-checked.
- Generated HTML and source are downloads, not executable pages on the
  dashboard origin.

The first-party routing skill is
`hermes-skills/prebuilt/resource2skill/SKILL.md`. Pulling the Microsoft clone
updates the runtime and skill libraries without overwriting Breadboard's bridge.
