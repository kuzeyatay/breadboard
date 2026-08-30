<div align="center">
  <h1>MatrAIx</h1>
  <p><strong>Simulate before reality.</strong></p>
  <p>
    多様なシミュレーションユーザーで AI システムとインタラクティブ製品を評価するための、
    人口規模・ペルソナ駆動のインフラストラクチャ。
  </p>
  <p>
    <a href="../../README.md">English</a> |
    <a href="README.ko.md">한국어</a> |
    <a href="README.zh-CN.md">简体中文</a> |
    <a href="README.zh-TW.md">繁體中文</a> |
    <strong>日本語</strong> |
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
    <img src="https://img.youtube.com/vi/cNFkz9Wo1y4/maxresdefault.jpg" alt="YouTube で MatrAIx デモを見る" width="900">
  </a>
  <p>
    <a href="https://www.youtube.com/watch?v=cNFkz9Wo1y4&t=15s"><img alt="YouTube で MatrAIx デモを見る" src="https://img.shields.io/badge/%E2%96%B6%20Watch%20the%20demo-on%20YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white"></a>
  </p>
</div>

---

**MatrAIx** は、多様なシミュレーションユーザーで AI システムとインタラクティブ製品を
評価するための、人口規模・ペルソナ駆動のインフラストラクチャです。汎用的・交換可能な
ユーザーに対してテストするのではなく、サンプリングしたペルソナ記録を LLM エージェントとして
インスタンス化し、4 つの環境 — **Survey**、**AI Chatbot**、**Web**、**App**
（macOS / iOS を含むネイティブのデスクトップおよびモバイル）— で再現可能なタスクを実行します。

基盤は、背景・心理・能力・行動を網羅する **1,290 のカテゴリ次元** からなる共有スキーマです。
ペルソナは、依存関係を考慮した合成生成と、エビデンスに基づく人間データのグラウンディングを組み合わせて構築されます。
決定的で品質フィルタ済みの **100 万ペルソナ** のコアセットが研究用に
[Hugging Face](https://huggingface.co/datasets/MatrAIx2026/MatrAIx_Persona_1M_Public_Release)
で公開されています。共有テレメトリ、タスク所有の検証、レポートにより、個々の応答と軌跡を
サブグループおよび人口レベルの知見につなぎます。

名前は *The Matrix* に由来します。探索・ストレステスト・仮説生成に有用なシミュレーション世界であり、
**実在の人々から得られるエビデンスの代替ではありません**。

## ニュース & 注目

- **学術コメント** — [*Can We Simulate the World?*](https://aiscientist.substack.com/p/can-we-simulate-the-world) — Mayank Kejriwal（[*AI Scientist*](https://aiscientist.substack.com/)）
- **研究ディスカバリー** — [Hugging Face Papers](https://huggingface.co/papers/2608.04205) に掲載（[Daily Papers, 2026-08-10](https://huggingface.co/papers/date/2026-08-10)）
- **メディア** — [36Kr](https://www.36kr.com/p/3932853833759876) · [Numerama](https://www.numerama.com/tech/2308727-ces-chercheurs-ont-cree-83-milliards-dhumains-virtuels-pour-tester-des-produits-a-notre-place.html) · [Infobae](https://www.infobae.com/tecno/2026/08/10/asi-prueba-la-ia-un-mundo-con-8300-millones-de-personas-digitales-matraix-es-el-metaverso/) · [AI타임스](https://www.aitimes.com/news/articleView.html?idxno=213824) · [Startup Fortune](https://startupfortune.com/harvard-and-mit-built-an-ai-model-of-83-billion-people-to-test-products-on/) · [Forbes Türkiye](https://www.forbes.com.tr/saglik/hastaya-dokunmadan-once-8-3-milyar-kez-denemek-sagligin-yeni-test-dunyasi-matraix) · [WIRED Czech](https://www.wired.cz/news-beat/harvard-a-mit-vytvorily-ai-simulaci-obsahujici-83-miliardy-virtualnich-lidi)
- **業界コメント** — Cisco VP & CTO [Gianpaolo Barozzi](https://lnkd.in/p/gE9cV2nw) が言及
- **ソーシャル** — [X Trending Story](https://x.com/i/trending/2086626337561911419) に掲載

## リリース

- **[2026-08-04]** arXiv 技術レポート: [MatrAIx: Simulating the World with 8.3 Billion Persona Agents](https://arxiv.org/abs/2608.04205) (`2608.04205`)。
- **[2026-08-01]** Hugging Face で [Persona 1M](https://huggingface.co/datasets/MatrAIx2026/MatrAIx_Persona_1M_Public_Release) を公開（約 100 万件の品質フィルタ済みペルソナ）。
- **[2026-07-31]** Playground とタスクライブラリをオープンソース化: [MatrAIx-Persona-8B](https://github.com/MatrAIx-ai/MatrAIx-Persona-8B)。
- **[2026-07-29]** ポジションノート: [From Personas to Simulated Users](https://matraix.ai/research/survey-from-personas-to-simulated-users.html)。

## 要件

- [Docker](https://docs.docker.com/get-docker/)
- [uv](https://docs.astral.sh/uv/) と Python 3.12
- Node.js 20+（Playground / viewer フロントエンドのみ）
- ペルソナエージェント例用のモデル API キー — [agents.md](../environment/agents.md) を参照

> **Windows をお使いの方へ**：すべてのコマンドは
> [WSL2](https://learn.microsoft.com/windows/wsl/install) 内で実行してください。
> PowerShell で `wsl --install` を実行（Ubuntu がインストールされます）した後、
> リポジトリは **WSL ファイルシステム内**（例：`~/MatrAIx`。`/mnt/c/…` は大幅に
> 遅くなるため避けてください）に clone し、Docker Desktop → Settings → Resources
> で *WSL integration* を有効にしてください。以降、本 README のコマンドは
> そのまま動作します。ネイティブの PowerShell/cmd はサポートしていません
> （タスク検証スクリプトが `bash` を必要とするため）。

## インストール

```bash
git clone <repo-url> && cd MatrAIx
uv venv --python 3.12
uv pip install -e .
uv pip install pytest pytest-asyncio httpx
uv pip install -e packages/playground
uv pip install -e packages/harbor-langsmith
uv pip install -e packages/rewardkit
```

ジョブとタスクは **`uv run matraix run …`** で実行します。このコマンドは起動環境を自動で整えたうえで Harbor ランタイムに委譲します。ランタイムユーティリティ（`harbor view`、`harbor upload` など）は引き続き **`uv run harbor …`** を使います。

GUI / CLI タスク実行の前に、プロバイダに合わせたモデル API キーを設定してください
（スモークテストには不要です）：

```bash
export ANTHROPIC_API_KEY="sk-ant-..."   # anthropic/claude-* モデル
# export OPENAI_API_KEY="sk-..."        # openai/gpt-* モデル
```

キーの全体表は [agents.md](../environment/agents.md) を参照。
Playground は `application/playground/.env.local` からもキーを読み込めます。

### Persona 1M のインポート（推奨）

リポジトリ同梱の `matraix-persona-dev-sample`（約 200）はスモークテスト用です。本番相当のコホート / Playground サンプリングには公開 1M をインポートしてください：

```bash
huggingface-cli download MatrAIx2026/MatrAIx_Persona_1M_Public_Release \
  --repo-type dataset \
  --local-dir persona/datasets/matraix-persona-1m/release
```

Playground: Dataset → **`matraix-persona-1m`**。CLI: `--dataset persona/datasets/matraix-persona-1m`。
詳細: [Handbook § Persona 1M](../README.md#3-persona-1m-recommended)。

## クイックスタート

### スモークテスト（smoke tests）

インストール後に、次の 2 つのチェックを実行してください（API キー不要）。
あわせて Survey / Chat / Web / OS-app のデフォルト実行パスが使えることを確認できます：

| チェック | 確認できること | コマンド |
|----------|----------------|----------|
| **Docker なし** | Survey と Chat | `uv run matraix smoke application/tasks/example-survey_product-feedback` |
| **Docker あり** | Web と OS-app | `uv run matraix run -c configs/jobs/example-job-recipe/harbor-smoke-local.yaml` |

1 つ目は数秒で `Smoke: ok` と表示されます。2 つ目は初回にローカルイメージをビルドします（数分）。成功時の出力は `jobs/harbor-smoke-local/`。手順: [quickstart §3](../quickstart.md#3-smoke-tests-two-lanes)。
### GUI でのタスク実行

Playground はタスク選択・ペルソナサンプリングを行い、CLI auto モードと同じ
Matraix Playground job を起動します。
API + フロントエンドを起動（2 つのターミナル）：

```bash
# ターミナル A — API
VENV=.venv bash application/playground/backend/run_dev.sh

# ターミナル B — フロントエンド
cd application/playground/frontend && npm ci && npm run dev
```

**http://localhost:5173** を開く → Playground → ペルソナのコホートを選択 →
Survey / Chat / Web / OS app タスクを選択 → **Lock pipeline** → **Run eval**。
詳細: [Playground §10](../quickstart.md#10-playground--play-tasks-visually)。

### CLI でのタスク開発 / 実行

**開発** — `application/tasks/` 配下の参照タスクをコピーし、
`task.toml` / `instruction.md` / `input/` / 検証スクリプト（verifier）を編集して Playground に登録
（[task-guide.md](../application/task-guide.md)）：

```bash
cp -R application/tasks/example-survey_product-feedback \
  application/tasks/<your-task-name>
```

| 種類 | 参照タスク |
|------|------------|
| Survey | `application/tasks/example-survey_product-feedback` |
| Chat | `application/tasks/example-chat-api_support_chatbot` |
| Web | `application/tasks/example-web-playwright_quote-choice` |
| OS-app | `application/tasks/example-computer-use-linux_note-to-csv` |

**実行** — Matraix Playground job を生成（agent + model を固定）して実行：

```bash
uv run python application/scripts/generate_application_job.py \
  --task application/tasks/example-survey_product-feedback \
  --execution-mode auto \
  --persona-ids 0042 \
  --model-name anthropic/claude-sonnet-4-6

# スクリプトが出力する export 行と recipe パスを使用、例：
uv run matraix run -c configs/jobs/application-task-job-recipe/example-survey-product-feedback-auto-n1.yaml
```

バッチ（`--sample-size N`）、フィルタ、chat / web / os-app の例：
[docs/quickstart.md](../quickstart.md)。

## ドキュメント

**[MatrAIx Handbook](../README.md)** — ガイド、および persona / application / environment のドキュメント。

<p align="center">
  <img src="../assets/matraix-architecture.png" alt="MatrAIx アーキテクチャ" width="900">
</p>

## リポジトリ構成

```text
MatrAIx/
├── persona/                 スキーマ、データセット、合成/キュレーション/検証パイプライン
│   ├── schema/              1,290 次元ペルソナスキーマ
│   ├── datasets/            開発サンプルプールとペルソナ YAML
│   ├── validation/          Grounding / 品質検証スイート
│   └── scripts/             ペルソナ job・パイプラインヘルパー
├── application/
│   ├── tasks/               Survey · chat · web · os-app タスク仕様
│   ├── task-spec/           共有タスク契約
│   ├── playground/          ビジュアルランナー（バックエンド API + フロントエンド）
│   └── scripts/             generate_application_job.py とタスクツール
├── environment/
│   ├── runtime/             Matraix Playground runtime
│   ├── agents/              ペルソナ条件付きエージェント
│   ├── task-environments/   Docker イメージ / sidecar
│   └── adapters/            外部アダプタ（例: SimpleQA）
├── packages/                playground · rewardkit · harbor-langsmith
├── apps/viewer/             `harbor view` と対になるフロントエンド
├── configs/jobs/            キュレート / 生成された Matraix Playground job recipe
├── docs/                    Handbook — persona/ · application/ · environment/
├── examples/                最小のサンプルタスク
├── src/matraix/             Python パッケージのエントリポイント
├── scripts/                 リポジトリレベルのヘルパー
├── tests/                   ユニット / 環境テスト
└── jobs/                    ローカル Matraix Playground 実行出力（gitignore）
```

大規模な生成データセットは git 外に置きます（上記 Hugging Face リリースを参照）。

## コミュニティに参加

[![Discord](https://img.shields.io/badge/Discord-join%20MatrAIx-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/knVyQQnRFa)
[![X](https://img.shields.io/badge/X-follow%20%40MatrAIx2026-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/MatrAIx2026)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-follow%20MatrAIx-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/company/matraix)
[![Google Form](https://img.shields.io/badge/Google%20Form-join%20MatrAIx-4285F4?style=for-the-badge&logo=googleforms&logoColor=white)](https://forms.gle/hwEHng5HGWRqcJue9)

1. Discord に参加 — ニックネームは **`Full Name - Affiliation`**。Google Form に記入
   （背景、興味、論文の著者 / 謝辞）。
2. ぜひごあいさつください！共通の関心や経験をもとに、メンバー同士をおつなぎします。
3. MatrAIx 研究コミュニティでのコラボレーションや貢献をお待ちしています！

## 引用

MatrAIx、Persona 1M データセット、または本リポジトリの結果を利用する場合は、次を引用してください。

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

論文: [arXiv:2608.04205](https://arxiv.org/abs/2608.04205) ·
全著者リスト: GitHub **Cite this repository** (`CITATION.cff`) ·
データセット: [Persona 1M on Hugging Face](https://huggingface.co/datasets/MatrAIx2026/MatrAIx_Persona_1M_Public_Release)。

## Star History

<a href="https://www.star-history.com/?repos=MatrAIx-ai%2FMatrAIx-Persona-8B&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=MatrAIx-ai/MatrAIx-Persona-8B&type=date&theme=dark&legend=top-left&sealed_token=Yg8UrFwz3ELwyx6wW2CobWIwzUg_VZv53wOwlLji13fApPKuro445vOLW1W5Vy_NfU4NUON-ARepltF9i1-YiNiuSzMK4BVrFHURZLQMoAkeeh4uaxqysfKvTrPQ1cW6zXotcAwoUlKv5Ana5kuWGQj0e-wZoNDaJ6QVL7c8adFut281xX5Quo0c07Y7" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=MatrAIx-ai/MatrAIx-Persona-8B&type=date&legend=top-left&sealed_token=Yg8UrFwz3ELwyx6wW2CobWIwzUg_VZv53wOwlLji13fApPKuro445vOLW1W5Vy_NfU4NUON-ARepltF9i1-YiNiuSzMK4BVrFHURZLQMoAkeeh4uaxqysfKvTrPQ1cW6zXotcAwoUlKv5Ana5kuWGQj0e-wZoNDaJ6QVL7c8adFut281xX5Quo0c07Y7" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=MatrAIx-ai/MatrAIx-Persona-8B&type=date&legend=top-left&sealed_token=Yg8UrFwz3ELwyx6wW2CobWIwzUg_VZv53wOwlLji13fApPKuro445vOLW1W5Vy_NfU4NUON-ARepltF9i1-YiNiuSzMK4BVrFHURZLQMoAkeeh4uaxqysfKvTrPQ1cW6zXotcAwoUlKv5Ana5kuWGQj0e-wZoNDaJ6QVL7c8adFut281xX5Quo0c07Y7" />
 </picture>
</a>

## ライセンス

MIT — [LICENSE](../../LICENSE) を参照。
