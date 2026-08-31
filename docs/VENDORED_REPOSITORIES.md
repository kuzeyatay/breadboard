# Integrated Upstream Source Snapshots

Breadboard commits the upstream projects it integrates as ordinary files. A
fresh clone therefore contains the source needed to inspect, build, and adapt
those integrations without initializing Git submodules or cloning dozens of
repositories separately.

These trees are source snapshots, not claims of authorship. Each project keeps
its upstream license, notices, and contribution guidance. GitHub Linguist marks
the snapshots as vendored so their language mix does not overwhelm
Breadboard's own repository statistics.

## Snapshot policy

- The manifest records the upstream origin, branch, and base revision used for
  each snapshot.
- Local nested `.git` directories are workstation metadata and are never part
  of the Breadboard repository.
- The committed files reflect the working trees at import time. Breadboard's
  local Hermes terminal-permission integration and Vibe Trading lockfile
  adjustments are layered on their recorded base revisions.
- Upstream submodules that were not materialized are omitted:
  `inbox-zero/apps/web/app/(marketing)`, `mem0/evaluation`, and
  `Vvvebjs/demo/landing`.
- Reproducible bulk corpora and media are omitted to keep clones and GitHub
  operations practical: `harvey-labs/tasks`, HyperFrames producer test
  fixtures, `openGym/media`, `pxpipe/eval`, and
  `Resource2Skill/skills_wiki`. Screenpipe's downloadable ONNX Runtime archive
  is omitted as well.
- Stirling PDF's two test private-key fixtures are intentionally omitted. No
  runtime credentials, generated workspaces, dependency installs, or nested
  repository histories are included.
- LFS-backed files that remain in a snapshot are committed as ordinary Git
  blobs; the imported attribute files disable their upstream LFS filters.

The snapshot contains approximately 122,000 upstream files (3.3 GiB before Git
compression) after those exclusions.

## Refreshing a snapshot

1. Update the nested upstream checkout and review its license and changes.
2. Stage its tracked working-tree files explicitly as ordinary files; never
   stage the directory as a gitlink.
3. Preserve the exclusions above, update this revision table, and keep the
   top-level Linguist entry in `.gitattributes`.
4. Verify that the outer index contains no mode `160000` entries, no file
   approaches GitHub's 100 MiB limit, and no secrets or private keys are staged.
5. Build or test the Breadboard integration that consumes the snapshot.

## Revisions

| Directory | Upstream origin | Branch | Base revision |
| --- | --- | --- | --- |
| `agent-loop-engineering-kit` | https://github.com/AlekseiUL/agent-loop-engineering-kit.git | `main` | `d8c814e9259824ee57018d2b6fde88b2dc5840d2` |
| `agent-reach` | https://github.com/Panniantong/agent-reach | `main` | `241b02870892525e009bceaa7823d3f7b6c6f617` |
| `agent-skills` | https://github.com/addyosmani/agent-skills | `main` | `d2478bf0c73a6357df39a3ed6aff16acaa218843` |
| `AI-Youtube-Shorts-Generator` | https://github.com/Anil-matcha/AI-Youtube-Shorts-Generator | `main` | `c30376e94326f8674793c960b482eb532ffbf1f6` |
| `anydoc` | https://github.com/firecrawl/anydoc | `main` | `4a45addbd607e8b59f0c263bca26aab228e10370` |
| `audio-analyzer-rs` | https://github.com/JuzzyDee/audio-analyzer-rs | `main` | `0387fe1630ff0fc7f71bf656be81f3b1f400dda8` |
| `auto-claude-code-research-in-sleep` | https://github.com/wanshuiyin/auto-claude-code-research-in-sleep | `main` | `a5fcc6970f08d45f6a2100abef4d5d234a1cef25` |
| `bolt-slides` | https://github.com/stackblitz/bolt-slides | `main` | `53b55bcf365dc2864fac29e7a5594213611142be` |
| `book-to-skill` | https://github.com/virgiliojr94/book-to-skill | `master` | `b4b373351d0bdf07de0270eef5276aaeaa2f1ffe` |
| `bullshit-detector` | https://github.com/SerhiiKorniienko/bullshit-detector | `main` | `7b8fac1857eba19d25665825793dfbaf0414c6bf` |
| `buzz` | https://github.com/block/buzz.git | `main` | `934f3325c3fdaa3a6f23134b74518139aac8ca3f` |
| `career-ops` | https://github.com/santifer/career-ops | `main` | `cf0d011067b27217ca05c546652fa362f5e028df` |
| `codex` | https://github.com/openai/codex | `main` | `2b5bdcf67547860f2e5c5a605009a70026796b2b` |
| `Cognivia` | https://github.com/SNOWTEAM2023/Cognivia/ | `main` | `fbfa49a8e9a393b2fc8e8abcb3f547e349e0f523` |
| `comfyui` | https://github.com/comfy-org/comfyui | `master` | `2eb609766a749e3104485979615e062e401bab97` |
| `daily_stock_analysis` | https://github.com/ZhuLinsen/daily_stock_analysis | `main` | `235c898a6da8a5229465d49230b479cd92192867` |
| `deep-research` | https://github.com/dzhng/deep-research.git | `main` | `8df5f9b6d8c8f9942ae5e8950972248a152c4f3d` |
| `DeepTutor` | https://github.com/HKUDS/DeepTutor | `main` | `37c3db6df7e886aee4f61c97ec5e618b8ab379e8` |
| `deer-flow` | https://github.com/bytedance/deer-flow.git | `main` | `99c926b7bbcd0570870bc24ceb13ab934935f49c` |
| `diagram-design` | https://github.com/cathrynlavery/diagram-design | `main` | `09df49d8d1a1c7fb2efdfcdc7a2a0713534350a6` |
| `emilkowalski-skills` | https://github.com/emilkowalski/skills | `main` | `de33dbed000212b54400a33767d1e4d03654db2a` |
| `goal` | https://github.com/secemp9/goal | `main` | `0161050d73ee1b3ec71d92ef88a3c0d0725ed65f` |
| `gods-eye-view` | https://github.com/bilawalsidhu/gods-eye-view | `main` | `314a0e1c2ef668cb110674b737e19a44ff6fc1ef` |
| `hallmark` | https://github.com/nutlope/hallmark | `main` | `13ac0ec7e148655948100b6396439e481361d690` |
| `harvey-labs` | https://github.com/harveyai/harvey-labs | `main` | `55510f0e609ffa5cf6f5df17d9a813ce4bb33d0c` |
| `hermes-agent` | https://github.com/nousresearch/hermes-agent | `main` | `4f5c688775a4ba850d7d3adc5dfd54efcf39ebd3` |
| `human-review` | https://github.com/petergyang/human-review | `main` | `dbcb7a69fa4739c4245ee178468f2bc2d6fb2991` |
| `hyperframes` | https://github.com/heygen-com/hyperframes | `main` | `29f004cfc04b351bf38a8b28b20916bb5bad9fc4` |
| `iFixAi` | https://github.com/ifixai-ai/iFixAi | `main` | `4ac9cc1c8765427300d98dc30855c18349610cf1` |
| `inbox-zero` | https://github.com/elie222/inbox-zero | `main` | `0006bea20b141d7386d76d32a6e4551c8333dd59` |
| `loopx` | https://github.com/huangruiteng/loopx | `main` | `924213b86ba7788bdb83ebecab9569ec6cd79b41` |
| `manim` | https://github.com/3b1b/manim | `master` | `01030ac5d23bc294ccb93cbfcda260f2d20dda62` |
| `MatrAIx-Persona-8B` | https://github.com/MatrAIx-ai/MatrAIx-Persona-8B | `main` | `2418b37ffb99f79c0a7d4b3dd4e461ced498aefc` |
| `mcp-google-images-search` | https://github.com/srigi/mcp-google-images-search | `main` | `e9c515eda45807d80d9ccc993be781d0ee13d47b` |
| `mem0` | https://github.com/mem0ai/mem0 | `main` | `4debc58a83377b18be81ae1e5969a300736b2fac` |
| `meta-prompting` | https://github.com/meta-prompting/meta-prompting | `main` | `dc406edd3855b378c1bb8604ca00397e01ea2513` |
| `MoneyPrinterTurbo` | https://github.com/harry0703/MoneyPrinterTurbo | `main` | `bdc45823a15efd438ba88d27bcba3a2e377c867c` |
| `nango` | https://github.com/NangoHQ/nango.git | `master` | `ddd0b201cd7ac31c2a5e278da531f1a065203abd` |
| `oh-my-hermes` | https://github.com/rlaope/oh-my-hermes | `main` | `080030ccef0d3c15123a3f7478b671a0d2ddcf22` |
| `open-alpha-arena` | https://github.com/etrobot/open-alpha-arena | `main` | `15d47c1d48969f63419954927478cdad8a36a6b2` |
| `OpenExecutive` | https://github.com/SenteLabsAI/OpenExecutive | `main` | `755d8ec13083bc231b2d9c331af48ff5df902a81` |
| `opencode` | https://github.com/anomalyco/opencode | `dev` | `017a5977d2107092007623e507fc5c6eb337d3b2` |
| `openGym` | https://github.com/arvids-unavailable/openGym | `main` | `c42ba6b98e3776af5981f20c05ba392238799670` |
| `OpenMontage` | https://github.com/calesthio/OpenMontage | `main` | `4eab34c5cfcccaa4f1970554928feccce73ee930` |
| `OpenPlanter` | https://github.com/ShinMegamiBoson/OpenPlanter | `main` | `81d75620ff50a69f576bc19a8bb17738e952387a` |
| `openmaic` | https://github.com/THU-MAIC/OpenMAIC | `main` | `dfebbcf33f3a56064129903faeab70a9e4243146` |
| `openscience` | https://github.com/synthetic-sciences/openscience | `main` | `74ee13cdd1e086effd7a616a7c0bbad678bc5e51` |
| `openwork` | https://github.com/different-ai/openwork | `dev` | `776a0646be968842f73d523f3c56372a9ee4ed82` |
| `patent-disclosure-skill` | https://github.com/handsomestWei/patent-disclosure-skill | `main` | `ecd62fdb45b9792bb5fb2ebe8dc61157e04faab0` |
| `penecho` | https://github.com/penecho/penecho | `main` | `5d14d54b5a8d06dab4cb6a865f2547556e5ff842` |
| `postiz-app` | https://github.com/gitroomhq/postiz-app | `main` | `cf4c432c00c9db775ea1b1f12480a8e2b89aec32` |
| `premortem` | https://github.com/expectedparrot/premortem | `main` | `724247b820e2bab3613e1055d990ee0efc963a83` |
| `PRAXIST` | https://github.com/sapientinc/PRAXIST | `main` | `7af6a26747ed8ce23b7147ec3243ad21c8346679` |
| `prompt-engineering-guide` | https://github.com/dair-ai/prompt-engineering-guide | `main` | `57673726396dd94acb23bdb1e67f27c78ee85a8e` |
| `pxpipe` | https://github.com/teamchong/pxpipe | `main` | `fdae9c336a6bc2213173e23ffb776018493ae768` |
| `Resource2Skill` | https://github.com/microsoft/Resource2Skill | `main` | `7f101b4cfe214cc496d085a34efac528a17cc375` |
| `reverse-skill` | https://github.com/zhaoxuya520/reverse-skill | `main` | `c60eeeeec064553058b321eafdc3d2af4bc02ede` |
| `ruflo` | https://github.com/ruvnet/ruflo | `main` | `4ac1ab9ff3ee8f0406cfa97fe463944d9b110e9a` |
| `scientific-agent-skills` | https://github.com/k-dense-ai/scientific-agent-skills | `main` | `757b63b1c09798a45c79eea542c9b55dbe04e502` |
| `screenpipe` | https://github.com/screenpipe/screenpipe | `main` | `ef1d14a6a1a65cc931d4f27fc96bfdb1820e2143` |
| `ShapeR` | https://github.com/facebookresearch/ShapeR | `main` | `8e9bd5b25a075bdd2fc4d60027d27e515fa11769` |
| `sim` | https://github.com/simstudioai/sim | `main` | `e741923f72c310bba6c508132bb2d342f904ed64` |
| `SolidworksMCP-python` | https://github.com/andrewbartels1/SolidworksMCP-python | `main` | `a6d1f1be409547c43503dc4a4dcf2c39e6d99096` |
| `soundshuman` | https://github.com/aashaexo/soundshuman | `main` | `a45cfbba9fde843d670e553a0aa98f6a23d7fb28` |
| `stable-fast-3d` | https://github.com/Stability-AI/stable-fast-3d | `main` | `ff21fc491b4dc5314bf6734c7c0dabd86b5f5bb2` |
| `stirling-pdf` | https://github.com/Stirling-Tools/stirling-pdf | `main` | `833d951fd0f8ba946138def5a93eab7e1e877850` |
| `subsai` | https://github.com/absadiki/subsai | `main` | `5ed78a85d2b868a907c811404f7cd9179db39968` |
| `tradingagents` | https://github.com/tauricresearch/tradingagents | `main` | `271e8c88a9874cae3f4ba8059b78301c13fa9e18` |
| `ts-fsrs` | https://github.com/open-spaced-repetition/ts-fsrs | `main` | `cdec8d2f8340f8e62ced596c1da02e20e70073f0` |
| `unlazy` | https://github.com/Leonxlnx/unlazy | `main` | `754d9a68109e39b836cc72a39fb9a823f9d6b613` |
| `unslop` | https://github.com/asavvin-pixel/unslop | `main` | `5e6bac5891a214d3acdfaa296e4c7a5c73ab801e` |
| `Vibe-Trading` | https://github.com/HKUDS/Vibe-Trading | `main` | `b3059dca26cea320accc24ba17060830d2f6a22b` |
| `video-use` | https://github.com/browser-use/video-use | `main` | `8e94eb04d22c5de30bd0febd2cd06fb4103949dd` |
| `vimax` | https://github.com/hkuds/vimax | `main` | `05a48943878312d88fe5a016c12a9654940ecc43` |
| `voicebox` | https://github.com/jamiepine/voicebox | `main` | `51f49dea198384b4eb6087b72c17057c6eb1c1cd` |
| `vox-director` | https://github.com/Alisa0808/vox-director | `main` | `668ec3946fe0139bc985313b15c1a300fca42f94` |
| `Vvvebjs` | https://github.com/givanz/Vvvebjs | `master` | `1acbab7ebfe3e7b004f1f18c039d26550fc04bd8` |
| `wardrobe` | https://github.com/tandpfun/wardrobe | `main` | `f44006cce7e4779e595a35b25fbbc8dabc68d7e4` |
| `watch` | https://github.com/bradautomates/claude-video | `main` | `0b7ada9a8c2fb08f1f52cb21c02ae39261338739` |
| `watermarks-remover` | https://github.com/guillaumemeyer/watermarks-remover | `main` | `ff5db594f189373b80afde42449b5ad952270c95` |
