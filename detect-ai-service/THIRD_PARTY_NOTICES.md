# Detect AI third-party notices

Breadboard's Detect AI service is original integration code. It implements
published detector equations and loads the following third-party model assets
only after the user invokes the skill. Model weights are downloaded into the
writable Breadboard data directory and are not redistributed in the Breadboard
source tree or installer.

## Fast-DetectGPT

- Project: <https://github.com/baoguangsheng/fast-detect-gpt>
- Reviewed commit: `971b05202bac2bb504d60c0ac0812fea7a8f7c82`
- License: MIT
- Use: analytic sampling-discrepancy equation and the published normal-fit
  calibration constants for the Falcon-7B/Falcon-7B-Instruct pair.

Copyright (c) 2023 Bao Guangsheng. Permission is granted, free of charge, to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
under the conditions of the MIT License. The full license is in the upstream
repository.

## Binoculars

- Project: <https://github.com/ahans30/Binoculars>
- Reviewed commit: `c8ae2f90d50ee696418bc71d8d9e5020e5f9d7b8`
- License: BSD 3-Clause
- Use: perplexity/cross-perplexity ratio and the published Falcon thresholds.

Copyright (c) 2023 Hans, Schwarzschild, and Goldstein. Redistribution and use
are permitted under the BSD 3-Clause conditions in the upstream LICENSE.

## UniversalFakeDetect

- Project: <https://github.com/WisconsinAIVision/UniversalFakeDetect>
- Reviewed commit: `030495aea3300a8b54c0ec37ec7fe1dd7e63c619`
- License: MIT
- Use: validation preprocessing, frozen CLIP feature architecture, and the
  official linear-head checkpoint.
- Linear-head SHA-256:
  `477100745713bcc957beb2b40859536859b6483fd6301b3b9293151b194c7847`

Copyright (c) Wisconsin AI/Vision Lab. Permission is granted under the MIT
License in the upstream repository.

## OpenAI CLIP ViT-L/14

- Project: <https://github.com/openai/CLIP>
- License: MIT
- Use: official `ViT-L/14` checkpoint loaded by UniversalFakeDetect.
- Checkpoint SHA-256:
  `b8cca3fd41ae0c99ba7e8951adf17d267cdb84cd88be6f7c2e0eca1737a03836`

Copyright (c) OpenAI. Permission is granted under the MIT License in the
upstream repository.

## Falcon-7B model pair

- Base: `tiiuae/falcon-7b`, revision
  `ec89142b67d748a1865ea4451372db8313ada0d8`
- Instruct: `tiiuae/falcon-7b-instruct`, revision
  `8782b5c5d8c9290412416618f36a133653e85285`
- License: Apache License 2.0 as declared in both model repositories.
- Use: local logits for Fast-DetectGPT and Binoculars. The checkpoints are
  downloaded from Hugging Face at the exact revisions above.

## DetectZoo evaluation

DetectZoo was reviewed at commit
`6d91ba26fccd71eec65aae12e338ce4ffda52ec4` as an integration candidate. No
DetectZoo code, weights, or assets are copied or imported because the reviewed
checkout did not include a license file. Breadboard instead ships independent
adapters for the three licensed detector projects listed above.

## Python dependencies

The packaged service also contains the licenses shipped with its locked Python
dependencies, including PyTorch, torchvision, Transformers, Hugging Face Hub,
OpenCLIP, Pillow, safetensors, and tqdm. `runtime-artifact.json` records the
reviewed dependency closure. Nothing here changes the terms of those projects.
