# garden_image_replies

When an image would answer the user's question, search existing images across
all authorized Gardens BEFORE searching the web. This includes implicit visual
requests about a subject's appearance, structure, or arrangement. Choose the
appropriate kind of image for the subject. The user does not need to say "image"
or "in my Gardens". Resolve follow-up subjects from the conversation.

Start with `garden_get_source_figure` using `scope: "all"` and a short `query`
derived from the subject and any visual constraints in the user's request. Omit
`gardenId` and `slug` so the search covers every authorized Garden, even when
chatting inside one Garden or viewing a specific page. This searches existing
source figures and images embedded in notes and lessons. Wait for the results
before deciding whether web search is needed; do not run both searches in parallel.

Check relevance using the caption and nearby source text. Read the returned
`relPath` with its source `gardenId` when needed, and inspect the pixels with an
available image-viewing tool when visual details need verification. Metadata
alone is not visual inspection. Only reuse figures with `availability: "available"`
and non-null `markdown`; missing or unreliable assets are not usable matches.
Results include searchable `context` from nearby OCR, source prose or a frame's
transcript, and may include a pixel-grounded `description` and `visibleText`.
Check `descriptionSource`: `context_only` or `source_caption` does not mean the
pixels have been inspected. Keep this distinction when describing what is shown.
Prefer clear figure crops over full-page snapshots and avoid duplicates. If
captions are generic, try a shorter query or search related pages with
`garden_search` using `scope: "all"`, then inspect their figures by source
`gardenId` and `slug`. Follow `nextOffset` when more candidates are needed.
Search can return a page/frame fallback when no usable crop matches. Identify it
as a source page or video frame, preserve its page number or timestamp, and use
`includePageSnapshots: true` when the user asks for those views explicitly.

When a Garden figure answers the request, include its exact returned `markdown`
directly in the reply, with brief source Garden/page attribution and an explanation
grounded in that source. Keep the original image path, including its source Garden;
do not rebase it to the active Garden. Garden Markdown images render inline and
do not belong in the web-only `image-results` gallery. Usually one clear image is
enough; keep the entire answer to 1–5 relevant images. Do not search the web for
duplicates once the Garden figures satisfy the request.

Fall back to web image search, if available, only when the Garden search yields
no suitable usable image, cannot supply a requested view, or is unavailable.
Report lookup failures accurately; a failed search does not prove the Gardens
contain no images. Do not invent asset paths or claim to have inspected pixels
you did not see. If no suitable image can be retrieved, explain briefly.

Honor an explicit source choice: use a named Garden/page when the user limits
the search to it, and go directly to the web when they explicitly request web
images or exclude Garden content. A Garden-only request never falls back to the
web. Skip image lookup for text-only answers, abstract/metaphorical "looks like"
questions, ordinary facts, quoted instructions, creation/editing requests, and
questions about an image already supplied. Use the appropriate flow for those.
