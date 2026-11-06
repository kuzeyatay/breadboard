---
name: veo
description: Generate and download Veo videos through the user's connected Google Flow subscription. Use /veo for text-to-video, video from image references, available Veo model choices, and checking or downloading a requested clip. Uses Google sign-in and Flow credits, with no Gemini API key.
license: MIT
allowed-tools:
  - mcp_call
  - artifact_import
---

# Veo

breadboard:
  category: featured
  surfaces: [garden_chat, dashboard_terminal]
  requiredTools: [mcp_call, artifact_import]
  requiredArtifactKinds: [video]
  requiredRuntimes: []
  requiredMcpServers: [google-flow]
  optionalMcpServers: []

Use the `google-flow` connection automatically attached by this skill. Invoke
its discovered tools through `mcp_call` with `connection: "google-flow"`.
Google Flow uses the user's Google subscription and available Flow credits.
Never ask for a Gemini API key or send Veo requests to CLIProxy's Gemini text or
image route. Nano Banana generates images; Veo generates video.

## Connection and model

1. Call `flow_list_accounts`. If `readyForGeneration` is false, direct the user
   to **Settings → Connections → Google Flow · Veo** to finish setup. Do not
   extract browser cookies, operate Flow with generic browser tools, or claim
   a connected account without a verified default. Account completion belongs
   to Settings. Veo uses a dedicated hidden Breadboard tab sharing its browser
   sign-in. Never open a visible generation tab, Edge, or an extension workflow.
2. Use the returned `defaultAccountId` with `flow_inspect_account` to discover
   the account's current models, aspect ratios, output counts, durations and
   upscales. For capability questions also call `flow_help`.
3. Select an exact available **Veo** model ID. Respect a requested Veo variant;
   otherwise prefer an available Veo Fast model for one clip. Do not use
   `ui-default`: it may select Omni instead. If no Veo model is available,
   explain the account's actual choices and ask before substituting a model.
   Do not invent duration or upscale choices that inspection did not return.

## Generate, track, deliver

A user request to generate a clip authorizes that clip's Flow credit use. Set
`confirmCreditSpend: true` for the requested generation. Merely invoking /veo
without a prompt, asking about capabilities, or checking a job does not
authorize generation. Default to one output and no upscale; request new user
authorization before producing additional variants or spending on an upscale.

Call `flow_generate_video` with the prompt, verified account and exact Veo
model. Use only user-provided image/video references at their actual local
paths. Set `outputDirectory` to an absolute subdirectory of the current
conversation's authorized workspace, such as `generated/veo`, and `download`
to true. Obtain the workspace from the current tool/session context; do not
guess a home directory or save into another conversation's workspace. Set
`timeoutSeconds` to 60 so the call yields to job tracking promptly.

Keep the returned job ID. For `processing`, `submitted`, `configuring`, or
`upscaling`, poll **that same ID** through `flow_job_status` with `waitSeconds`
at most 30. Never submit the prompt again because it is queued or a call timed
out. If a submission times out before returning an ID, report that its outcome
is unknown and stop; an automatic retry could spend credits twice.

When ready, use `flow_download_job` with that ID if the video has not already
downloaded. Use only its `downloadedFiles`; never choose a gallery item by
position, guess the latest file, or replace the download with browser actions.
Report `job_asset_identity_missing`, `generated_asset_not_found`, failed jobs,
sign-in expiry, account limits and insufficient credits accurately. An import
failure is a delivery problem: retry publishing the existing file, not generation.

Publish each completed video with `artifact_import`, `kind: "video"`, its exact
downloaded path, a useful title, and `sourceSkill: "veo"`. Return the resulting
Breadboard video artifact so the user can play and download it in chat. Never
claim a finished video for a pending job, screenshot, text response or missing
file. If the user stops waiting, include the job ID for a later status request.
