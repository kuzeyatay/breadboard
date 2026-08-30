<div align="center">
  <h1>MatrAIx</h1>
  <p><strong>Simulate before reality.</strong></p>
  <p>
    이질적인 시뮬레이션 사용자로 AI 시스템과 인터랙티브 제품을 평가하기 위한
    인구 규모·페르소나 기반 인프라.
  </p>
  <p>
    <a href="../../README.md">English</a> |
    <strong>한국어</strong> |
    <a href="README.zh-CN.md">简体中文</a> |
    <a href="README.zh-TW.md">繁體中文</a> |
    <a href="README.ja.md">日本語</a> |
    <a href="README.pt-BR.md">Português</a> |
    <a href="README.es.md">Español</a>
  </p>
  <p>
    <a href="https://matraix.ai/"><img alt="Website" src="https://img.shields.io/badge/Website-matraix.ai-4f7cff?style=for-the-badge"></a>
    <a href="https://discord.gg/knVyQQnRFa"><img alt="Discord" src="https://img.shields.io/badge/Discord-join%20MatrAIx-5865F2?style=for-the-badge&logo=discord&logoColor=white"></a>
    <a href="https://x.com/MatrAIx2026"><img alt="X" src="https://img.shields.io/badge/X-%40MatrAIx2026-000000?style=for-the-badge&logo=x&logoColor=white"></a>
    <a href="https://www.linkedin.com/company/matraix"><img alt="LinkedIn" src="https://img.shields.io/badge/LinkedIn-MatrAIx-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white"></a>
    <a href="https://forms.gle/hwEHng5HGWRqcJue9"><img alt="Google Form" src="https://img.shields.io/badge/Google%20Form-join%20MatrAIx-4285F4?style=for-the-badge&logo=googleforms&logoColor=white"></a>
    <a href="../README.md"><img alt="Docs" src="https://img.shields.io/badge/Docs-Handbook-5b5b5b?style=for-the-badge"></a>
    <a href="https://huggingface.co/datasets/MatrAIx2026/MatrAIx_Persona_1M_Public_Release"><img alt="Hugging Face" src="https://img.shields.io/badge/Hugging%20Face-Persona%201M-ffcc4d?style=for-the-badge"></a>
    <a href="../../LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-c33b32?style=for-the-badge"></a>
    <a href="../quickstart.md#10-playground--play-tasks-visually"><img alt="Playground" src="https://img.shields.io/badge/Playground-Visual%20Runner-56b879?style=for-the-badge"></a>
  </p>
</div>

<div align="center">
  <a href="https://www.youtube.com/watch?v=cNFkz9Wo1y4&t=15s">
    <img src="https://img.youtube.com/vi/cNFkz9Wo1y4/maxresdefault.jpg" alt="YouTube에서 MatrAIx 데모 보기" width="900">
  </a>
  <p>
    <a href="https://www.youtube.com/watch?v=cNFkz9Wo1y4&t=15s"><img alt="YouTube에서 MatrAIx 데모 보기" src="https://img.shields.io/badge/%E2%96%B6%20Watch%20the%20demo-on%20YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white"></a>
  </p>
</div>

---

**MatrAIx**는 이질적인 시뮬레이션 사용자로 AI 시스템과 인터랙티브 제품을 평가하기 위한
인구 규모·페르소나 기반 인프라입니다. 범용적이거나 서로 대체 가능한 사용자를 상대로
테스트하는 대신, 샘플링된 페르소나 레코드를 LLM 에이전트로 인스턴스화하고 네 가지 환경 —
**Survey**, **AI Chatbot**, **Web**, **App**(macOS·iOS를 포함한 네이티브 데스크톱·모바일) —
에서 재현 가능한 태스크로 실행합니다.

기반은 배경·심리·역량·행동을 아우르는 **1,290개의 범주형 차원**으로 구성된 공유 스키마입니다.
페르소나는 의존성을 고려한 합성 생성과 증거에 기반한 인간 데이터 그라운딩을 결합해 구축됩니다.
결정적이며 품질 필터링을 거친 **백만 페르소나** 코어셋이 연구용으로
[Hugging Face](https://huggingface.co/datasets/MatrAIx2026/MatrAIx_Persona_1M_Public_Release)
에 공개되어 있습니다. 공유 텔레메트리, 태스크 소유 검증, 리포팅이 개별 응답·궤적을
하위 집단 및 인구 수준의 발견으로 연결합니다.

이름은 *The Matrix*에서 따온 것입니다. 탐색·스트레스 테스트·가설 생성에 유용한 시뮬레이션
세계이며, **실제 사람으로부터의 증거를 대체하지 않습니다**.

## 소식 & 주목

- **학술 코멘터리** — [*Can We Simulate the World?*](https://aiscientist.substack.com/p/can-we-simulate-the-world) — Mayank Kejriwal([*AI Scientist*](https://aiscientist.substack.com/))
- **연구 디스커버리** — [Hugging Face Papers](https://huggingface.co/papers/2608.04205) 선정([Daily Papers, 2026-08-10](https://huggingface.co/papers/date/2026-08-10))
- **미디어** — [36Kr](https://www.36kr.com/p/3932853833759876) · [Numerama](https://www.numerama.com/tech/2308727-ces-chercheurs-ont-cree-83-milliards-dhumains-virtuels-pour-tester-des-produits-a-notre-place.html) · [Infobae](https://www.infobae.com/tecno/2026/08/10/asi-prueba-la-ia-un-mundo-con-8300-millones-de-personas-digitales-matraix-es-el-metaverso/) · [AI타임스](https://www.aitimes.com/news/articleView.html?idxno=213824) · [Startup Fortune](https://startupfortune.com/harvard-and-mit-built-an-ai-model-of-83-billion-people-to-test-products-on/) · [Forbes Türkiye](https://www.forbes.com.tr/saglik/hastaya-dokunmadan-once-8-3-milyar-kez-denemek-sagligin-yeni-test-dunyasi-matraix) · [WIRED Czech](https://www.wired.cz/news-beat/harvard-a-mit-vytvorily-ai-simulaci-obsahujici-83-miliardy-virtualnich-lidi)
- **산업 코멘터리** — Cisco VP & CTO [Gianpaolo Barozzi](https://lnkd.in/p/gE9cV2nw)가 언급
- **소셜** — [X Trending Story](https://x.com/i/trending/2086626337561911419)에 선정

## 릴리스

- **[2026-08-04]** arXiv 기술 보고서: [MatrAIx: Simulating the World with 8.3 Billion Persona Agents](https://arxiv.org/abs/2608.04205) (`2608.04205`).
- **[2026-08-01]** Hugging Face에 [Persona 1M](https://huggingface.co/datasets/MatrAIx2026/MatrAIx_Persona_1M_Public_Release) 공개(약 100만 품질 필터 페르소나).
- **[2026-07-31]** Playground와 태스크 라이브러리 오픈소스: [MatrAIx-Persona-8B](https://github.com/MatrAIx-ai/MatrAIx-Persona-8B).
- **[2026-07-29]** 포지션 노트: [From Personas to Simulated Users](https://matraix.ai/research/survey-from-personas-to-simulated-users.html).

## 요구 사항

- [Docker](https://docs.docker.com/get-docker/)
- [uv](https://docs.astral.sh/uv/) 및 Python 3.12
- Node.js 20+ (Playground / viewer 프론트엔드만)
- 페르소나 에이전트 예제용 모델 API 키 — [agents.md](../environment/agents.md) 참고

> **Windows 사용자**: 모든 명령은
> [WSL2](https://learn.microsoft.com/windows/wsl/install) 안에서 실행하세요.
> PowerShell에서 `wsl --install`을 실행하면 Ubuntu가 설치됩니다. 그다음 저장소를
> **WSL 파일시스템 안**(예: `~/MatrAIx`, `/mnt/c/…`는 훨씬 느리므로 피하세요)에
> clone하고, Docker Desktop → Settings → Resources에서 *WSL integration*을
> 활성화하세요. 이후 이 README의 모든 명령이 그대로 동작합니다. 네이티브
> PowerShell/cmd는 지원하지 않습니다(작업 검증 스크립트가 `bash`를 필요로 합니다).

## 설치

```bash
git clone <repo-url> && cd MatrAIx
uv venv --python 3.12
uv pip install -e .
uv pip install pytest pytest-asyncio httpx
uv pip install -e packages/playground
uv pip install -e packages/harbor-langsmith
uv pip install -e packages/rewardkit
```

잡과 태스크는 **`uv run matraix run …`** 으로 실행합니다. 이 명령은 전체 실행 환경을 구성한 뒤 Harbor 런타임에 위임합니다. 런타임 유틸리티(`harbor view`, `harbor upload` 등)는 계속 **`uv run harbor …`** 로 사용합니다.

GUI 또는 CLI 태스크 실행 전에 사용 중인 제공자에 맞는 모델 API 키를 설정하세요
(스모크 테스트에는 필요 없음):

```bash
export ANTHROPIC_API_KEY="sk-ant-..."   # anthropic/claude-* 모델
# export OPENAI_API_KEY="sk-..."        # openai/gpt-* 모델
```

전체 키 매트릭스는 [agents.md](../environment/agents.md)를 참고하세요.
Playground는 `application/playground/.env.local`에서도 키를 로드할 수 있습니다.

### Persona 1M 가져오기 (권장)

저장소의 `matraix-persona-dev-sample`(약 200)은 스모크 테스트 전용입니다. 실제 코호트 / Playground 샘플링에는 공개 1M을 가져오세요:

```bash
huggingface-cli download MatrAIx2026/MatrAIx_Persona_1M_Public_Release \
  --repo-type dataset \
  --local-dir persona/datasets/matraix-persona-1m/release
```

Playground: Dataset → **`matraix-persona-1m`**. CLI: `--dataset persona/datasets/matraix-persona-1m`.
자세한 내용: [Handbook § Persona 1M](../README.md#3-persona-1m-recommended).

## 빠른 시작

### 스모크 테스트(smoke tests)

설치 후 아래 두 검사를 실행하세요(API 키 불필요). 함께 돌리면 Survey / Chat / Web / OS-app
기본 실행 경로가 준비되었는지 확인할 수 있습니다:

| 검사 | 확인할 수 있는 것 | 명령 |
|------|-------------------|------|
| **Docker 없이** | Survey와 Chat | `uv run matraix smoke application/tasks/example-survey_product-feedback` |
| **Docker 사용** | Web와 OS-app | `uv run matraix run -c configs/jobs/example-job-recipe/harbor-smoke-local.yaml` |

첫 번째는 보통 몇 초 안에 `Smoke: ok`를 출력합니다. 두 번째는 첫 실행 시 로컬 이미지를 빌드합니다(수 분). 성공 시 출력은 `jobs/harbor-smoke-local/`. 단계: [quickstart §3](../quickstart.md#3-smoke-tests-two-lanes).
### GUI 태스크 실행

Playground는 태스크를 고르고 페르소나를 샘플링한 뒤, CLI auto 모드와 동일한
Matraix Playground job을 실행합니다.
API + 프론트엔드 시작(터미널 두 개):

```bash
# 터미널 A — API
VENV=.venv bash application/playground/backend/run_dev.sh

# 터미널 B — 프론트엔드
cd application/playground/frontend && npm ci && npm run dev
```

**http://localhost:5173** 열기 → Playground → 페르소나 코호트 선택 →
Survey / Chat / Web / OS app 태스크 선택 → **Lock pipeline** → **Run eval**.
자세한 내용: [Playground §10](../quickstart.md#10-playground--play-tasks-visually).

### CLI 태스크 개발 / 실행

**개발** — `application/tasks/` 아래 참고 태스크를 복사한 뒤
`task.toml` / `instruction.md` / `input/` / 검증기(verifier)를 편집하고 Playground에 등록
([task-guide.md](../application/task-guide.md)):

```bash
cp -R application/tasks/example-survey_product-feedback \
  application/tasks/<your-task-name>
```

| 유형 | 참고 태스크 |
|------|-------------|
| Survey | `application/tasks/example-survey_product-feedback` |
| Chat | `application/tasks/example-chat-api_support_chatbot` |
| Web | `application/tasks/example-web-playwright_quote-choice` |
| OS-app | `application/tasks/example-computer-use-linux_note-to-csv` |

**실행** — Matraix Playground job을 생성(agent + model 고정)한 뒤 실행:

```bash
uv run python application/scripts/generate_application_job.py \
  --task application/tasks/example-survey_product-feedback \
  --execution-mode auto \
  --persona-ids 0042 \
  --model-name anthropic/claude-sonnet-4-6

# 스크립트가 출력하는 export 줄과 recipe 경로를 사용, 예:
uv run matraix run -c configs/jobs/application-task-job-recipe/example-survey-product-feedback-auto-n1.yaml
```

배치(`--sample-size N`), 필터, chat / web / os-app 예제:
[docs/quickstart.md](../quickstart.md).

## 문서

**[MatrAIx Handbook](../README.md)** — 가이드 및 persona / application / environment 문서.

<p align="center">
  <img src="../assets/matraix-architecture.png" alt="MatrAIx 아키텍처" width="900">
</p>

## 저장소 구조

```text
MatrAIx/
├── persona/                 스키마, 데이터셋, 합성/큐레이션/검증 파이프라인
│   ├── schema/              1,290차원 페르소나 스키마
│   ├── datasets/            개발 샘플 풀 및 페르소나 YAML
│   ├── validation/          Grounding / 품질 검증 스위트
│   └── scripts/             페르소나 job·파이프라인 헬퍼
├── application/
│   ├── tasks/               Survey · chat · web · os-app 태스크 스펙
│   ├── task-spec/           공유 태스크 계약
│   ├── playground/          비주얼 러너(백엔드 API + 프론트엔드)
│   └── scripts/             generate_application_job.py 및 태스크 도구
├── environment/
│   ├── runtime/             Matraix Playground runtime
│   ├── agents/              페르소나 조건 에이전트
│   ├── task-environments/   Docker 이미지 / sidecar
│   └── adapters/            외부 어댑터(예: SimpleQA)
├── packages/                playground · rewardkit · harbor-langsmith
├── apps/viewer/             `harbor view`와 짝을 이루는 프론트엔드
├── configs/jobs/            큐레이션·생성된 Matraix Playground job recipe
├── docs/                    Handbook — persona/ · application/ · environment/
├── examples/                최소 예제 태스크
├── src/matraix/             Python 패키지 엔트리포인트
├── scripts/                 저장소 수준 헬퍼
├── tests/                   유닛 / 환경 테스트
└── jobs/                    로컬 Matraix Playground 실행 출력(gitignore)
```

대용량 생성 데이터셋은 git 밖에 둡니다(위 Hugging Face 릴리스 참고).

## 커뮤니티 참여

[![Discord](https://img.shields.io/badge/Discord-join%20MatrAIx-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/knVyQQnRFa)
[![X](https://img.shields.io/badge/X-follow%20%40MatrAIx2026-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/MatrAIx2026)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-follow%20MatrAIx-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/company/matraix)
[![Google Form](https://img.shields.io/badge/Google%20Form-join%20MatrAIx-4285F4?style=for-the-badge&logo=googleforms&logoColor=white)](https://forms.gle/hwEHng5HGWRqcJue9)

1. Discord 가입 — 닉네임 **`Full Name - Affiliation`**. Google Form 작성
   (배경, 관심사, 논문 저자 / 사사).
2. 인사해 주세요! 공통 관심사나 경험을 바탕으로 여러분을 연결해 드리겠습니다.
3. MatrAIx 연구 커뮤니티에 참여해 협업하거나 기여하세요!

## 인용

MatrAIx, Persona 1M 데이터셋, 또는 이 저장소의 결과를 사용할 경우 다음을 인용해 주세요.

```bibtex
@article{li2026matraix,
  title         = {MatrAIx: Simulating the World with 8.3 Billion Persona Agents},
  author        = {Li, Xiaomin and Hao, Yuexing and Hou, Jianheng and Huang, Jintao
                   and Wen, Qianfeng and Huang, Shirley and Liu, Yifan and Liu, Xiaoyi
                   and Fan, Yilan and Wang, Yijun and others},
  year          = {2026},
  eprint        = {2608.04205},
  archivePrefix = {arXiv},
  primaryClass  = {cs.AI},
  url           = {https://arxiv.org/abs/2608.04205}
}
```

논문: [arXiv:2608.04205](https://arxiv.org/abs/2608.04205) ·
전체 저자 목록: GitHub **Cite this repository** (`CITATION.cff`) ·
데이터셋: [Persona 1M on Hugging Face](https://huggingface.co/datasets/MatrAIx2026/MatrAIx_Persona_1M_Public_Release).

## Star History

<a href="https://www.star-history.com/?repos=MatrAIx-ai%2FMatrAIx-Persona-8B&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=MatrAIx-ai/MatrAIx-Persona-8B&type=date&theme=dark&legend=top-left&sealed_token=Yg8UrFwz3ELwyx6wW2CobWIwzUg_VZv53wOwlLji13fApPKuro445vOLW1W5Vy_NfU4NUON-ARepltF9i1-YiNiuSzMK4BVrFHURZLQMoAkeeh4uaxqysfKvTrPQ1cW6zXotcAwoUlKv5Ana5kuWGQj0e-wZoNDaJ6QVL7c8adFut281xX5Quo0c07Y7" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=MatrAIx-ai/MatrAIx-Persona-8B&type=date&legend=top-left&sealed_token=Yg8UrFwz3ELwyx6wW2CobWIwzUg_VZv53wOwlLji13fApPKuro445vOLW1W5Vy_NfU4NUON-ARepltF9i1-YiNiuSzMK4BVrFHURZLQMoAkeeh4uaxqysfKvTrPQ1cW6zXotcAwoUlKv5Ana5kuWGQj0e-wZoNDaJ6QVL7c8adFut281xX5Quo0c07Y7" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=MatrAIx-ai/MatrAIx-Persona-8B&type=date&legend=top-left&sealed_token=Yg8UrFwz3ELwyx6wW2CobWIwzUg_VZv53wOwlLji13fApPKuro445vOLW1W5Vy_NfU4NUON-ARepltF9i1-YiNiuSzMK4BVrFHURZLQMoAkeeh4uaxqysfKvTrPQ1cW6zXotcAwoUlKv5Ana5kuWGQj0e-wZoNDaJ6QVL7c8adFut281xX5Quo0c07Y7" />
 </picture>
</a>

## 라이선스

MIT — [LICENSE](../../LICENSE) 참고.
