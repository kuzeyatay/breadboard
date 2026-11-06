# Windows PC controls

These helpers run through Breadboard's `terminal_execute_command` tool, retaining
its existing capability grants, exact-command approvals, runtime cancellation,
and command evidence. The tool description advertises the helper and its help
action, so normal prompts can discover it. Restart Breadboard after changing the
plugin to load the updated tool description.

Example prompts:

- “Mute my PC.” / “Set my volume to 25%.”
- “Mute my microphone.”
- “Set my screen brightness to 40%.”
- “Which monitors and printers are connected?”
- “How much battery is left?”
- “Copy this text to my clipboard.”
- “Show this document in Explorer.”
- “Open sound settings.”
- “Print this PDF on my Canon printer.”
- “Show the print queue.” / “Cancel print job 12 on that printer.”

Call `windows_control.ps1 -Action help` for the closed action/parameter catalog.
The existing `windows_audio.ps1` entry point remains compatible.

## Printing

Discover printers and choose an exact installed queue name. If there is no unique
default, resolve that choice before submitting. `-Action print -CheckOnly`
validates the file, printer, backend and output destination without submitting a
job. Offline printers fail with an actionable error.

PDF, text, Markdown, CSV and common raster images use Windows printer drivers.
PDF uses the built-in Windows PDF renderer, up to 200 pages at 200 dpi (maximum
4000 pixels per dimension); text files print their literal text. Office files use
their registered `PrintTo` handler, one copy per request. When a handler is absent,
open the document and use the application's print UI through the existing computer
control tools. Animated images print the first frame.

`Microsoft Print to PDF` also accepts an explicit new `-OutputPath` for PDF,
text and images. Existing output files are never overwritten. Other printers
requiring interactive output are rejected by the unattended helper.

Printing returns `submitted` for the native driver or `handed-to-application`
for an Office handler, with `Verified: false`: neither proves that a physical
page was printed. Print-to-PDF returns `output-created` only after checking its
PDF header and EOF. A timeout or uncertain submission must not be retried
automatically because that can print duplicates. Inspect the queue first;
a job can disappear because it has already completed.

## Windows compatibility and verification

Runtime retains canonical `\\?\` paths for containment but presents ordinary
DOS/UNC paths in `TEMP` and `TMP` to children. PowerShell 5.1's .NET compiler
cannot use a verbatim temp path. The Terminal worker also normalizes these paths
for compatibility with an already-running older supervisor, preserves Unicode
output, and captures a failed command's status inside its PowerShell scope.

Audio, brightness and clipboard writes read back the changed value. Brightness
requires a display exposing Windows WMI brightness control. Open-file, Explorer
and settings actions report a launch, without claiming the UI task completed.

Run `node --test tests/runtime-v2-terminal-command-worker.test.mjs
tests/windows-controls.test.mjs` from `dashboard`. The latter uses real Windows
APIs and an isolated PDF print destination. Set
`BREADBOARD_TEST_WINDOWS_HARDWARE=1` for the opt-in audio, brightness and clipboard
acceptance checks; they restore the original state in `finally` blocks. No test
submits paper to a physical printer.
