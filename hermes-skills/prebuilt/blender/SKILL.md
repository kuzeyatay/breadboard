---
name: blender
description: Create and edit Blender scenes, 3D models, materials, lighting, cameras, animations, and renders in the user's local Blender. Use /blender for live scene work and editable .blend projects with image or GLB previews.
license: MIT
allowed-tools:
  - mcp_call
  - artifact_import
---

# Blender

breadboard:
  category: featured
  surfaces: [garden_chat, dashboard_terminal]
  requiredTools: [mcp_call, artifact_import]
  requiredArtifactKinds: [image, model]
  requiredRuntimes: []
  requiredMcpServers: [blender]
  optionalMcpServers: []

Work in the user's running Blender through Breadboard's `blender` connection,
using the MIT-licensed [MCP for Blender](https://github.com/ahujasid/mcp-for-blender).
This skill operates Blender directly; do not delegate it to Resource2Skill or
install a separate `bpy` package. Dimensioned engineering CAD belongs to `/cad`.

## Connect and inspect

Discover the exact upstream schemas before the first call:

```json
{"connection":"blender","tool":"__breadboard_list_tools","args":{}}
```

Send that envelope to `mcp_call`. If tools are deferred, search for `mcp_call`,
describe it, and invoke it through `tool_call`. Use the same connection for all
subsequent calls. The pinned server exposes `get_addon_status`, `get_scene_info`,
`execute_blender_code`, and `look` (the current visual inspection tool).

Call `get_addon_status`, then `get_scene_info` with `fields: ["settings",
"location", "size", "materials"]`. Inspect the existing file, selected objects,
units, camera, and render settings before editing. A registered MCP server does
not prove Blender is open: upstream sometimes returns errors as ordinary text
without `isError`. Treat `Error ...` and connection failures as failures.

If unavailable, direct the user to **Settings → Connections → Blender**. Blender
must be open with the **MCP for Blender** add-on enabled and its server running
on the default port, 9876. Setup details are in
[references/setup.md](references/setup.md). Never repeatedly retry a closed app.

## Build and verify

Use `execute_blender_code` for small, inspectable `bpy` operations. Inspect names
and Blender's version rather than assuming the startup cube or an old API.
Prefer explicit data access over selection-dependent operators. Name created
objects and group them in a collection for this task. Preserve unrelated objects,
materials, and the user's active project. Do not clear the scene unless the task
requires replacing it. Save a new version before substantial changes to an
existing project; do not overwrite the original unless requested.

Set dimensions, units, material properties, lighting, and camera deliberately.
Use `look` to inspect composition after meaningful changes. Render a modest
preview before an expensive final render or animation. Inspect the actual result
and fix visible errors before delivering it. When a tool accepts `user_prompt`,
pass the user's request rather than an invented instruction.

Asset libraries and paid generators are optional upstream features. Use only
the integrations reported available by `get_addon_status`, and only when the
requested task calls for external assets or generation. Do not enable telemetry,
upload a project, or spend generation credits just to create ordinary geometry.

## Save and deliver

Resolve the current conversation's authorized workspace from the session/tool
context. Save under a task-specific folder there, using absolute paths meaningful
to the local Blender process. Never guess a workspace or use another chat's files.

Save the editable project with `bpy.ops.wm.save_as_mainfile(filepath=...)`. For
viewing in chat, export GLB with `bpy.ops.export_scene.gltf(...,
export_format='GLB')` or render a PNG using the configured camera. Use a new
filename for each revision. Print the paths and confirm the files exist and have
nonzero size before importing them.

Publish the produced files with `artifact_import`, their exact paths, useful
titles, and `sourceSkill: "blender"`: `kind: "model"` for GLB, `kind: "image"`
for PNG, `kind: "video"` for a completed video, and `kind: "unknown"` for the
editable `.blend` download. A `.blend` file is not a GLB model preview. Do not
claim an artifact is attached until import succeeds.

If a mutation or render times out, its outcome is unknown: inspect the scene,
output path, or render status before retrying. Do not replay the same script
blindly, duplicate objects, or close the user's Blender to recover. Report what
was saved, what was visually checked, and any remaining limitation.
