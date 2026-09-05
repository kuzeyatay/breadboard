---
name: computer-use
description: Operate graphical desktop applications in the background with Hermes Agent on Windows, macOS, or Linux when the task cannot be completed through a direct API, connected service, filesystem or terminal operation, or purpose-built browser tool.
license: MIT
allowed-tools:
  - computer_use
---

# Computer Use

Use Hermes Agent's `computer_use` tool to observe and operate a native desktop
application without taking over the user's cursor or keyboard. The tool is
cross-platform on Windows, macOS, and Linux and requires `cua-driver`.

breadboard:
  category: featured
  surfaces: [dashboard_terminal, garden_chat]
  requiredTools: [computer_use]
  requiredArtifactKinds: []
  requiredRuntimes: []
  requiredMcpServers: []
  optionalMcpServers: []

## When to use it

Select this skill automatically when the user asks you to carry out a task in a
graphical desktop application and there is no direct Breadboard tool for the
operation. An explicit `/computer-use` command also selects it.

Prefer the most direct instrument that can complete the work:

1. Use a connected service or application API when one owns the requested data
   or action.
2. Use filesystem, terminal, or a purpose-built browser tool when the task is
   natively expressible there.
3. Use `computer_use` only when the remaining work truly requires observing,
   clicking, typing, selecting, or scrolling in a graphical application.

In Super Agent mode this ordering is strict: computer use is a last resort, not
a convenience. Do not invoke it until a more direct route is unavailable or a
specific attempted route has failed. A request merely mentioning an app is not
enough.

## Background-only operating loop

1. Call `computer_use` with `action: "list_apps"` or `action: "list_windows"`
   when the target is ambiguous.
2. Target the app with `action: "focus_app"` and `raise_window: false`. This
   selects its window for background input; it must not bring the app forward.
3. Capture with `action: "capture"`. Prefer `mode: "ax"` for text-first work
   and `mode: "som"` when the numbered visual overlay is useful.
4. Act on a numbered `element` from the latest capture whenever possible. Use
   coordinates only when the accessibility tree exposes no usable element.
5. Keep `delivery_mode: "background"` and `bring_to_front: false` on every
   input action.
6. Capture again after each meaningful action and verify the requested effect
   from the returned state before continuing.

Never request foreground delivery. If Hermes returns `effect:
"suspected_noop"`, `code: "background_unavailable"`, or recommends foreground
escalation, stop that route and explain that the application could not be
controlled safely in the background. Do not turn a background task into visible
focus changes.

## Safety and scope

- Treat the latest capture as the only valid source of element numbers; capture
  again after navigation or a substantial layout change.
- Do not type passwords, authentication codes, payment details, private keys,
  or other secrets through desktop control.
- Respect Breadboard approval boundaries for consequential actions. A click on
  Send, Buy, Delete, Publish, or an equivalent final action is not implied by a
  request to prepare the preceding form.
- Hermes hard-blocks destructive system shortcuts and dangerous shell text. Do
  not retry a blocked action in another form.
- When `cua-driver` is missing, report the exact setup command:
  `hermes computer-use install`. Do not install it silently.

## Learned workflows

Saved learned workflows already replay their GUI steps through this same Hermes
background backend. Run the workflow normally with `workflow_run`; do not also
re-enact its steps manually with `computer_use`. The workflow runner re-grounds
controls before acting, pauses at its recorded approval boundaries, and verifies
the observed result after each step.
