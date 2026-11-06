# Garden visual search and description coverage

Visual answers search all authorized Gardens before web image search, unless the
user explicitly chooses another source. This applies to any subject; no topic is
hard-coded. Matching results keep the original image URL and source attribution.

`garden_get_source_figure` searches detected figures and equations, embedded
Markdown/reference/HTML images, and `source_images` frontmatter. It includes
visible notes, sources, lessons and index pages. Hidden/draft pages and assets
outside the authorized Garden remain excluded.

Search combines specific captions, descriptions, visible text, local OCR/prose,
and video transcript context. Direct visual matches rank above incidental source
mentions. OCR context stays within its page; video frames retain timestamps.
When no usable crop matches, search can return its full page or saved frame.
Use `includePageSnapshots: true` to include snapshots explicitly.

Each result reports `descriptionSource`:

| Value | Evidence |
| --- | --- |
| `vision` | A saved description generated from the image pixels |
| `visual_detection` | A non-generic caption from the existing figure detector |
| `source_caption` | An existing source caption, without a verified pixel description |
| `context_only` | A generic label with nearby text available for matching |

Context retrieval does not claim the pixels were inspected. Missing or unreliable
assets have no reusable Markdown embed. An unreadable Garden is reported without
preventing search of the other authorized Gardens.

## New imports

Document ingestion, website imports and Watch video imports share resumable
per-image description enrichment. The model receives the image plus bounded
source context and returns a caption, visual description and legible text. This
also covers handwritten drawings retained as OCR crops or page snapshots.
Document imports save every embedded image returned by the document parser.
On Windows, embedded EMF/WMF drawings are rendered to PNG before they are
linked in the source note, so browsers and the vision model can read them.
Descriptions are stored separately under `.breadboard/visual-descriptions` and
remain available through Learn workspace rebuilds. Changed images invalidate
their cached descriptions; copied images with unchanged bytes can reuse them.

Declining document map generation does not trigger additional description model
calls. Existing figure-detector captions are reused. Provider failure, unsupported
images and unreadable output remain pending; they never become fabricated
descriptions or discard the source. The caller receives coverage counts. Watch
retains every selected frame instead of reducing the selection to 24 frames.

## Existing Gardens

From `dashboard`, run a read-only coverage report:

```powershell
node --experimental-strip-types scripts/backfill-garden-visual-descriptions.mjs --content-path ../quartz/content --all
```

To generate missing descriptions, provide the configured vision-capable model:

```powershell
node --env-file=.env.local --experimental-strip-types scripts/backfill-garden-visual-descriptions.mjs --content-path ../quartz/content --all --apply --model "<configured-model>"
```

Use `--garden <slug>` instead of `--all` to limit the run. Apply requires an
explicit model plus `OPENAI_BASE_URL` and `OPENAI_API_KEY`. It processes every
inventory page, skips completed descriptions, and stops further model requests
after a provider failure. Run it again to resume. Coverage remains visible;
apply exits nonzero if any images remain pending or unavailable.

For the live desktop library and its current background-model selection, use:

```powershell
node --experimental-strip-types scripts/backfill-garden-visual-descriptions.mjs --background --apply --data-dir "$env:APPDATA/breadboard-desktop/Data" --user-id 1 --all --batch-size 8 --concurrency 4 --report ../tmp/garden-visual-background-all.json
```

Use the intended account's user ID. This mode resolves the dynamic model endpoint
from `runtime/endpoints.json`, reads the background model through `/v1/providers`,
and confines the run to that user's owned Gardens. It reads each Garden catalog
once, deduplicates identical image bytes, and batches labeled images. A returned
description is accepted only for an unambiguous matching image ID. Every image
path still receives its own durable receipt.

`scripts/run-garden-visual-backfill.mjs` is a finite supervisor for one backfill.
Pass `--data-dir`, `--user-id`, `--report` and `--status-file`. It waits up to six
hours for the desktop model, resumes interrupted runs, retries pending outputs
individually, then verifies fresh coverage and Telecom 1 retrieval. The current
handoff contract targets the Telecom 1 Learn supervisor. It does not launch the
desktop or restart Learn. `readyForSupervisor` becomes true only after a verified
completion handoff is written. `needs_attention` means it could not finish;
creating `<status-file>.stop` stops it and retains completed descriptions.

This covers stored images attached to visible Garden pages. It does not promise
detection of every visual in an original document, every moment of a video,
remote images that were never captured, or unreferenced files in assets. Missing
files and stale cross-Garden references need source repair before they can be
reused. Large or undecodable images remain pending rather than marked described.

## Verification

Regression coverage includes OCR page isolation, handwritten-style generic crop
labels, HTML figures, equations, frontmatter-only snapshots, video timestamps,
ranking, pagination beyond 50 images, authorization, missing assets, hidden pages,
provider failure, cancellation, cache reuse/invalidation, Learn staging, and all
31 Watch-selected frames surviving import. A local model API fixture exercises
the backfill command's read-only default, actual image requests and resume path.
