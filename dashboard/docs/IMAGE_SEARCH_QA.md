# Image search verification

Image answers use a shared 1–5 image budget. The model chooses the count and
reviews a numbered contact sheet before selecting the pictures. Loading pixels
sets `inspection.status` to `awaiting_review`, not `verified`. Source pages supply
identity/date context; the image supplies visible details.

The service tries originals and then thumbnails, replaces failed or duplicate
candidates, corrects EXIF rotation, and retains loaded pictures when its preview
budget expires. User cancellation still stops the whole result. Text-only model
fallbacks receive no candidate image URLs.

From `dashboard`, run the deterministic integration tests:

```powershell
node --experimental-strip-types --test tests/image-search.test.mjs tests/image-search-preview.test.mjs tests/image-search-google.test.mjs tests/image-results.test.mjs tests/image-search-route.test.mjs tests/image-routing-evaluation.test.mjs tests/url-source-images.test.mjs
node node_modules/typescript/bin/tsc -p tsconfig.image-search.json --pretty false
```

From `hermes-agent`, run the registered-tool HTTP transport tests through the
canonical runner. On Windows, set `HERMES_PYTHON` to `.venv/Scripts/python.exe` and
use Git Bash. Give `--basetemp` a fresh workspace directory if the system temp
directory is inaccessible; use `-j 1` when sharing one base temp between files.

```bash
scripts/run_tests.sh tests/plugins/test_breadboard_image_search.py tests/plugins/test_breadboard_browser_terminal.py -j 1 -q
```

| Layer | Covered behavior |
| --- | --- |
| Search input/provider | Counts, invalid input, safe-search mapping, provider errors, malformed rows, empty pages and raw pagination offsets |
| Google worker/runtime | Structured JSON and accompanying notes, thumbnail-only results, MCP errors, response limits, internal candidate bounds, legacy compatibility and provider offsets preserved through pixel preparation |
| Pixel preparation | 1–5 pictures, actual pixel order, portrait/landscape sizes, EXIF orientation, duplicate bytes, redirects, tiny/oversized images, thumbnail fallback, cancellation and partial timeout |
| Display | Whole-answer cap, nested fences, URL aliases, invalid destinations, signed URLs, streaming JSON, repeated renders and single-image layout |
| HTTP authority | Signed token, owning user, conversation, surface, runtime session, active grant, error statuses and image-free audit records |
| Hermes transport | Real callback HTTP requests, native pixel delivery, candidate order/count, isolated cached screenshot, missing/invalid pixels and text-only fallback |

## Model routing evaluation

The fixture `tests/fixtures/image-routing-cases.json` covers appearance requests,
people, animals, places, product variants, food, clothing, artwork, current and
historical logos, exact counts, comparisons, pronouns, alternate views, Dutch,
French and Spanish, plus negative examples for abstract language, ordinary facts,
quoted instructions, uploaded images, generation and text-only requests.

With the local model gateway running, evaluate a configured model:

```powershell
node --experimental-strip-types scripts/evaluate-image-routing.mjs --model <configured-model-id> --output .tmp-image-routing-report.json
```

This loads the real Breadboard tool schemas and the shipped image policy, and
checks the model's next tool decision, count budget and subject constraints.
It does not execute tool calls or create chats. Exit 0 means all cases passed,
1 means routing failures, and 2 means unavailable/incomplete evaluation. An
offline provider never counts as a successful negative decision.

This targeted routing evaluation is not a full-chat or visual-recognition score.
For release QA, also ask the running app an appearance question, a comparison,
and a historical-photo request; confirm it inspects the right pictures, preserves
attribution, rejects misleading candidates and opens each selected picture.
