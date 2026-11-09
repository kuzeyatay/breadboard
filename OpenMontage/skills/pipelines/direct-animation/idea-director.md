# Direct animation brief

Use this pipeline for a complete visual instruction that can be rendered from local shapes, text, diagrams, or supplied assets. It does not require web research. If fulfilling the brief needs new factual claims, inspiration from a reference video, generated imagery, character rigging, or new narration, select the corresponding full pipeline before production. Do not downgrade that request to this pipeline.

Read the manifest, run registry preflight, and inspect `video_compose.get_info()` for available render engines. Follow the renderer and approval policy applicable to this run. Record the actual local options considered; do not claim an unavailable renderer ran.

Initialize one project with `init_project(project_id, title=title, pipeline_type="direct-animation")`. Write a schema-valid `brief` using only the supplied content. Record dimensions, frame rate, exact motion, audio intent and any explicit assumptions in `brief.metadata`. Silence is valid when requested. Do not invent a voice, soundtrack, source list or audience study.

Write the idea checkpoint with `brief` and `decision_log`. The `pipeline_dir` argument is the projects **parent** (`Path(os.environ["OPENMONTAGE_PROJECTS_DIR"])`), not the individual project directory. Passing the project directory duplicates the project ID and hides progress from the chat.

Use `schemas/artifacts/decision_log.schema.json`: each decision needs `decision_id`, `stage`, `category`, `subject`, `options_considered`, `selected`, and `reason`. Each option needs `option_id`, `label`, `score`, and `reason`; `selected` names its `option_id`. Record pipeline selection, renderer and composition mode. Use a single well-scoped checkpoint call instead of manually creating or rewriting the cumulative log. If autonomy is authorized, record that policy truthfully; never label an autonomous decision as a human approval.

Proceed directly to compose after the completed idea checkpoint. This pipeline implements the user's already supplied visual decision, so its manifest does not require a second human approval. Keep `human_approved=False` unless an actual later approval was given; record autonomous execution in metadata. A caller can still request a stricter approval policy. This manifest has no research, proposal, asset-generation or publishing stages. Do not create synthetic substitutes for those artifacts.
