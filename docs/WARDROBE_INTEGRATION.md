# Wardrobe

`/agents:wardrobe` turns photographs of clothes into a browsable wardrobe: every
garment in a photo is found, cut out on its own transparent background, filed in
a local library, and photographed again on you.

The runtime is [tandpfun/wardrobe](https://github.com/tandpfun/wardrobe), cloned
at `wardrobe/`. Breadboard drives it; it does not reimplement it.

---

## What shape this is, and why

`docs/ADDING_AN_AGENT.md` names three shapes. This is a **wrapped runtime**, and
the liveness test is unusually clear-cut: `wardrobe/scripts/import-job-api.mjs`
already owns the entire pipeline.

- garment detection, with a bounding box per item and a strict JSON schema
- the cutout prompt, and a chroma key chosen against the garment's own colour
- background removal, spill verification, alpha trimming and re-centring, all in
  `sharp`
- a job store with three review gates, crash recovery on boot, and an **atomic**
  write into `data/library.json`
- the gallery the person browses afterwards

Only two things in that file are model calls, and both go to
`OPENAI_API_BASE_URL`. Rewriting any of the rest would be rewriting somebody
else's working code, so Breadboard supplies the three things the clone genuinely
lacks — a model layer it can reach, a supervisor, and a headless driver — and
changes nothing in the clone.

One consequence worth stating plainly: **the runtime is the Vite dev server.**
The import API is a Vite plugin, so `/api/import/*` only exists while Vite is up,
and the same server is the gallery. It is started lazily on the first import and
then left running.

---

## The image bridge

ChatMock is the model layer, and it does not implement the Images API. Image
generation there is the Responses `image_generation` tool. The clone, meanwhile,
calls `POST /images/edits` with multipart form data and expects
`data[0].b64_json` back.

`lib/wardrobe/bridge.ts` closes that gap. It is a loopback HTTP server that:

- listens on `127.0.0.1` on an ephemeral port, behind a per-process bearer token;
- answers `POST /v1/images/edits` by parsing the multipart body, turning each
  `image[]` part into an `input_image`, and calling `generateArtifactImage` —
  Breadboard's existing image path — with the requested size;
- **forwards everything else verbatim to ChatMock**, which is what keeps the
  clone's `/responses` detection call on the real thing.

The token handed to the clone as its `OPENAI_API_KEY` is the bridge's own. It is
worthless anywhere else, and it is what satisfies the clone's "is a key
configured?" check without a real vendor key existing at all.

Multipart is parsed with `new Response(body, …).formData()` — the runtime's own
parser — rather than a hand-written boundary splitter.

`generateArtifactImage` grew two optional inputs for this: `sourceImages` (the
modeled shot needs two references, the person and the garment, in that order) and
`size`. The single-reference `sourceImage` field is untouched.

---

## Setup, and why the photo is mandatory

Two things stand between a fresh clone and a working wardrobe, and the settings
dialog owns both.

1. **`npm install` in the clone.** Unlike agents that install a published package
   into a Breadboard-owned prefix, this installs in place: Vite resolves its
   plugins and its React from the project directory it starts in. Health checks
   `vite` and `sharp` separately — an install that resolved every JavaScript
   package but failed to fetch sharp's platform binary yields a server that
   starts and then fails every garment at the trim step.

2. **An identity photograph.** This is not an optional nicety on the modeled
   stage. The clone gates its very first endpoint on it:

   ```js
   ready: hasApiKey && hasModelReference
   ```

   so without one, a photo of clothes is refused with a 503 before any model is
   called. Health therefore requires it, and the run route refuses early with the
   sentence that says how to fix it rather than letting a server the person never
   sees answer for it.

   The photo is re-encoded through `sharp` on the way in (a phone JPEG is the
   normal case, and re-encoding is what proves the bytes are an image), written
   to the path the clone itself reads, and never sent anywhere but the image call
   it is a reference for. `data/` is gitignored upstream.

Model settings reach the clone through the child process's environment. Vite's
`loadEnv` lets `process.env` win over a parsed `.env`, so Breadboard never writes
into the clone's `.env` and a file the person keeps for their own use is left
alone.

---

## Driving the import

The clone's own UI shows a person each cutout and asks approve or reject.
Headless there is nobody to ask, so `lib/wardrobe/run-manager.ts` approves
whatever generated successfully and lets a failure end that one garment rather
than the import. Per photo, per garment:

```
POST /api/import/jobs { imageDataUrl }      → one job per garment detected
POST …/stages/garment/regenerate { prompt } → only when the message carried direction
POST …/stages/crop/approve                  → starts the cutout
poll  …                                     → until the garment stage settles
POST …/stages/garment/approve               → FILES THE PIECE, and starts the modeled shot
poll  …                                     → until the modeled stage settles
POST …/stages/modeled/approve               → attaches the photo, closes the job
```

Three things about that order are load-bearing:

- **Approving the cutout is the import.** `persistImported` runs there, so from
  that call on the garment is in `data/library.json` whatever happens next. A
  failed modeled shot is reported as "cutout only", not as a lost piece.
- **The same call starts the modeled stage.** That is why there is no "skip the
  modeled photo" setting: a switch could only ever discard an image already paid
  for. What decides it is whether an identity photo exists, which is a setup
  question.
- **Direction reaches the first attempt through `regenerate`.** It is the only
  endpoint that takes a prompt, so queueing the cutout that way costs one
  generation instead of a default one that would then be replaced.

Stopping a run ends the driving loop between garments. Anything already filed
stays filed — the wardrobe is on disk, not in the run — and the summary says so
rather than implying a rollback.

---

## What the chat gets

- A card with one row per garment: its own colour, its name, its part, and a
  state that moves from *cutting out* to *modelling* to *added*.
- Both pictures per piece as artifacts of that conversation, so they open in the
  viewer and download from the panel.
- A written summary naming every piece, everything left out and why, and a link
  to the gallery.

The gallery is offered as a plain link rather than framed: it is the clone's own
app on a local port, a second window the person owns.

---

## Files

```
lib/wardrobe/identity.ts     command, id, name, parser, flags, run label
lib/wardrobe/runtime.ts      clone discovery, data dir, identity path, availability
lib/wardrobe/bridge.ts       the Images API → ChatMock Responses bridge
lib/wardrobe/service.ts      the supervised Vite dev server
lib/wardrobe/client.ts       typed access to the clone's /api/import/*
lib/wardrobe/run-manager.ts  the driving loop, events, summary
lib/wardrobe/artifact.ts     cutouts and modeled photos as artifacts
lib/wardrobe/setup.ts        npm install, identity photo
lib/wardrobe/settings.ts     stored defaults → a run's shape
api/wardrobe/{runs,runs/[runId]/{events,abort},health,setup}
components/hermes/inline-wardrobe-run.tsx
components/hermes/wardrobe-settings-dialog.tsx
tests/wardrobe-agent.test.mjs
```

Registry entries: `EXTERNAL_AGENT_RUN_KINDS`, `EXTERNAL_AGENT_ABORT_BY_KIND`,
`RUNTIME_AGENT_PROFILES`, `CONFIGURABLE_AGENTS`.

---

## Drift

The runtime is somebody else's app, and neither half imports the other, so
nothing would fail to compile if upstream renamed a route or a stage — the import
would simply stop working. `tests/wardrobe-agent.test.mjs` reads the clone and
asserts the parts this integration stands on: the three endpoints, the three
stage names, the two decisions, that approving the cutout is what files the
piece, that the identity gate is still on the first endpoint, and that both model
calls still go through `OPENAI_API_BASE_URL`.
