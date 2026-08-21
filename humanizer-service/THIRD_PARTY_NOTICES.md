# Third-party notices — Breadboard humanizer service

## The model

| | |
| --- | --- |
| Model ID | `cive202/humanize-ai-text-bart-large` |
| Pinned revision | `c74c28e03d3e306c8717d9f85cc18edb7d493299` |
| Upstream base model | `facebook/bart-large` (Meta AI, MIT) |
| Distribution | **Downloaded separately by the user. Not redistributed by Breadboard.** |

Breadboard does **not** bundle, vendor, mirror, package or redistribute these
weights. They are not in this Git repository, not in the desktop installer, and
not in the application's resources. Nothing downloads them because Breadboard
was launched: the download happens only when a person explicitly runs
`npm run setup:humanizer -- --download-model` or presses the install control in
the Breadboard UI. The files land in Breadboard's mutable user-data area and can
be deleted at any time without affecting any user content.

### Licence warning — unresolved

The upstream model card carries an MIT designation **and states that the
designation is a placeholder**. Breadboard therefore treats the weights as an
optional third-party download of *unresolved* licence status, not as MIT
material.

Consequences, which are deliberate:

- The weights are never redistributed by this project in any form.
- No Breadboard documentation describes this model as unconditionally
  MIT-licensed.
- Anyone intending to use rewritten output commercially should resolve the
  licensing with the model's publisher first. Breadboard cannot do that for you.

If and when the upstream licensing is independently resolved, update this file
and `docs/HUMANIZER_INTEGRATION.md` together — and only then.

### Revision pinning

`DEFAULT_MODEL_REVISION` in `breadboard_humanizer/__init__.py` is what the
loader passes to `from_pretrained`. A model repository can be force-pushed, and
a rewriter whose behaviour changes underneath a preservation gate is a rewriter
whose gate was tuned against something else. Moving the pin is a reviewed
change: bump the constant, re-run `humanizer-service/tests`, and re-run the
real-model smoke test documented in `docs/HUMANIZER_INTEGRATION.md`.

## Python dependencies

Installed into a dedicated virtual environment by `npm run setup:humanizer`,
never into the user's global interpreter, and never vendored here:

| Package | Licence |
| --- | --- |
| `torch` | BSD-3-Clause |
| `transformers` | Apache-2.0 |
| `safetensors` | Apache-2.0 |
| `sentencepiece` | Apache-2.0 |
| `pydantic` | MIT |

## Prose scoring

The "AI-style pattern score" shown next to a rewrite is Breadboard's existing
scorer in `dashboard/src/lib/prose-score/`, ported from sloplint
(`aashaexo/soundshuman`, MIT), whose scoring method comes from
`brandonwise/humanizer`. It is a deterministic pattern-density heuristic. It is
not an AI detector and no part of this feature claims to be one.
