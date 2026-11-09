# Compose the supplied animation

Read the saved brief and decision log. Use the renderer already selected at idea. Read its tool usage and relevant engine skills before authoring. Keep source files in this project's directory and render through the installed `video_compose` tool. Its normal per-project staging cache is permitted; do not modify shared engine source or another project.

For arbitrary moving shapes or text, author a small deterministic composition in the selected runtime. Derive motion from frame/time; use the supplied dimensions, duration and colors. Use system fonts unless the user supplied a font. No asset downloads, new providers, preview servers or model calls are needed for a self-contained shape animation.

Write an `in_progress` compose checkpoint, then produce an MP4 in the project's `renders/` directory. Use the exact output path in the render tool. Probe the actual output with ffprobe and inspect at least four frames spanning the beginning, middle and ending. Verify the object moves as requested, the duration and resolution match, and the file fully decodes. Verify intentional silence or supplied audio; do not call missing requested audio a success.

Write schema-valid `render_report` and `final_review` artifacts with the actual measurements and observed checks. A review with `revise` or `fail` is unfinished. Complete the compose checkpoint only when the video and review pass. Pass the projects parent as `pipeline_dir`, preserving the existing idea checkpoint and decision history.

Return the video path and a brief explanation of the renderer, duration and any limitations. A plan, empty file, checkpoint, or source-only project is not a rendered video. There is no external publication stage in this pipeline.
