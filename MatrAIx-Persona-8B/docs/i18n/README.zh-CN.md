<div align="center">
  <h1>MatrAIx</h1>
  <p><strong>Simulate before reality.</strong></p>
  <p>
    面向异构模拟用户、以人格驱动的人口级规模基础设施，用于评估 AI 系统与交互式产品。
  </p>
  <p>
    <a href="../../README.md">English</a> |
    <a href="README.ko.md">한국어</a> |
    <strong>简体中文</strong> |
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
    <img src="https://img.youtube.com/vi/cNFkz9Wo1y4/maxresdefault.jpg" alt="在 YouTube 上观看 MatrAIx 演示" width="900">
  </a>
  <p>
    <a href="https://www.youtube.com/watch?v=cNFkz9Wo1y4&t=15s"><img alt="在 YouTube 上观看 MatrAIx 演示" src="https://img.shields.io/badge/%E2%96%B6%20Watch%20the%20demo-on%20YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white"></a>
  </p>
</div>

---

**MatrAIx** 是一套面向异构模拟用户、以人格驱动的人口级规模基础设施，用于评估 AI 系统与交互式产品。它不依赖「通用」或可互换的用户假设，而是将抽样得到的人格记录实例化为 LLM Agent，并在四类环境中以可复现任务驱动运行 —— **Survey（问卷）**、**AI Chatbot（对话）**、**Web**，以及 **App**（原生桌面与移动端，含 macOS 与 iOS）。

其基础是一套共享的 **1,290 个类别维度** 人格 Schema，覆盖背景、心理、能力与行为。人格结合了感知依赖关系的合成生成与基于证据的真人数据锚定（grounding）；经确定性、质量过滤的 **百万人格** 核心集（coreset）已在
[Hugging Face](https://huggingface.co/datasets/MatrAIx2026/MatrAIx_Persona_1M_Public_Release)
公开发布，供研究使用。共享遥测、任务自有的验证与报告机制，将个体响应与轨迹同子群体及总体人口层面的发现衔接起来。

名称致敬 *The Matrix*：这是一个便于探索、压力测试与假设生成的模拟世界，**不能替代来自真实人群的证据**。

## 动态与认可

- **学术评论** — [*Can We Simulate the World?*](https://aiscientist.substack.com/p/can-we-simulate-the-world) — Mayank Kejriwal，[*AI Scientist*](https://aiscientist.substack.com/)
- **研究发现** — 登上 [Hugging Face Papers](https://huggingface.co/papers/2608.04205)（[Daily Papers, 2026-08-10](https://huggingface.co/papers/date/2026-08-10)）
- **媒体** — [36氪](https://www.36kr.com/p/3932853833759876) · [Numerama](https://www.numerama.com/tech/2308727-ces-chercheurs-ont-cree-83-milliards-dhumains-virtuels-pour-tester-des-produits-a-notre-place.html) · [Infobae](https://www.infobae.com/tecno/2026/08/10/asi-prueba-la-ia-un-mundo-con-8300-millones-de-personas-digitales-matraix-es-el-metaverso/) · [AI타임스](https://www.aitimes.com/news/articleView.html?idxno=213824) · [Startup Fortune](https://startupfortune.com/harvard-and-mit-built-an-ai-model-of-83-billion-people-to-test-products-on/) · [Forbes Türkiye](https://www.forbes.com.tr/saglik/hastaya-dokunmadan-once-8-3-milyar-kez-denemek-sagligin-yeni-test-dunyasi-matraix) · [WIRED Czech](https://www.wired.cz/news-beat/harvard-a-mit-vytvorily-ai-simulaci-obsahujici-83-miliardy-virtualnich-lidi)
- **产业评论** — Cisco VP & CTO [Gianpaolo Barozzi](https://lnkd.in/p/gE9cV2nw) 有讨论
- **社交** — 登上 [X Trending Story](https://x.com/i/trending/2086626337561911419)

## 发布

- **[2026-08-04]** 技术报告发布于 arXiv：[MatrAIx: Simulating the World with 8.3 Billion Persona Agents](https://arxiv.org/abs/2608.04205)（`2608.04205`）。
- **[2026-08-01]** 在 Hugging Face 发布 [Persona 1M](https://huggingface.co/datasets/MatrAIx2026/MatrAIx_Persona_1M_Public_Release)（约 100 万条经质量过滤的人格）。
- **[2026-07-31]** 开源 Playground 与任务库：[MatrAIx-Persona-8B](https://github.com/MatrAIx-ai/MatrAIx-Persona-8B)。
- **[2026-07-29]** 立场短文：[From Personas to Simulated Users](https://matraix.ai/research/survey-from-personas-to-simulated-users.html)。

## 环境要求

- [Docker](https://docs.docker.com/get-docker/)
- [uv](https://docs.astral.sh/uv/) 与 Python 3.12
- Node.js 20+（仅 Playground / viewer 前端需要）
- 人格 Agent 示例所需的模型 API Key —— 见 [agents.md](../environment/agents.md)

> **Windows 用户**：请在
> [WSL2](https://learn.microsoft.com/windows/wsl/install) 中运行全部命令——打开
> PowerShell 执行 `wsl --install`（会安装 Ubuntu），然后把仓库 clone 到 **WSL
> 文件系统内**（如 `~/MatrAIx`，不要放在 `/mnt/c/…`，后者慢得多），并在 Docker
> Desktop → Settings → Resources 中开启 *WSL integration*。之后本 README 中的所有
> 命令均可原样运行。不支持原生 PowerShell/cmd（任务验证脚本依赖 `bash`）。

## 安装

```bash
git clone <repo-url> && cd MatrAIx
uv venv --python 3.12
uv pip install -e .
uv pip install pytest pytest-asyncio httpx
uv pip install -e packages/playground
uv pip install -e packages/harbor-langsmith
uv pip install -e packages/rewardkit
```

作业与任务统一用 **`uv run matraix run …`** 运行——它会自动配置完整的启动环境，并委托给 Harbor 运行时执行。运行时工具（如 `harbor view`、`harbor upload`）仍使用 **`uv run harbor …`**。

在 GUI 或 CLI 任务运行前，设置与你的提供商匹配的模型 API Key（冒烟测试不需要）：

```bash
export ANTHROPIC_API_KEY="sk-ant-..."   # anthropic/claude-* 模型
# export OPENAI_API_KEY="sk-..."        # openai/gpt-* 模型
```

完整 Key 对照见 [agents.md](../environment/agents.md)。
Playground 也可从 `application/playground/.env.local` 加载 Key。

### 导入 Persona 1M（推荐）

仓库内 `matraix-persona-dev-sample`（约 200）仅用于冒烟测试。真实群组（cohort）与 Playground 采样请导入公开的 1M 数据集：

```bash
huggingface-cli download MatrAIx2026/MatrAIx_Persona_1M_Public_Release \
  --repo-type dataset \
  --local-dir persona/datasets/matraix-persona-1m/release
```

Playground：Dataset → **`matraix-persona-1m`**。CLI：`--dataset persona/datasets/matraix-persona-1m`。
详情：[Handbook § Persona 1M](../README.md#3-persona-1m-recommended)。

## 快速开始

### 冒烟测试（smoke tests）

安装后先跑这两条检查（无需 API Key）。合在一起就覆盖默认路径下的四类任务
（Survey、Chat、Web、OS-app）：

| 检查 | 确认你可以跑 | 命令 |
|------|--------------|------|
| **不用 Docker** | Survey、Chat | `uv run matraix smoke application/tasks/example-survey_product-feedback` |
| **需要 Docker** | Web、OS-app | `uv run matraix run -c configs/jobs/example-job-recipe/harbor-smoke-local.yaml` |

第一条通常几秒内打印 `Smoke: ok`。第二条首次会构建本地镜像（几分钟），成功后输出在 `jobs/harbor-smoke-local/`。步骤说明：[quickstart §3](../quickstart.md#3-smoke-tests-two-lanes)。
### GUI 任务运行

Playground 可选择任务、抽样人格，并启动与 CLI auto 模式相同的 Matraix Playground job。
启动 API + 前端（两个终端）：

```bash
# 终端 A — API
VENV=.venv bash application/playground/backend/run_dev.sh

# 终端 B — 前端
cd application/playground/frontend && npm ci && npm run dev
```

打开 **http://localhost:5173** → Playground → 选择人格群组 →
选择 Survey / Chat / Web / OS app 任务 → **Lock pipeline** → **Run eval**。
详情：[Playground §10](../quickstart.md#10-playground--play-tasks-visually)。

### CLI 任务开发 / 运行

**开发** — 复制 `application/tasks/` 下的参考任务，编辑
`task.toml` / `instruction.md` / `input/` / 验证器（verifier），再注册到 Playground
（[task-guide.md](../application/task-guide.md)）：

```bash
cp -R application/tasks/example-survey_product-feedback \
  application/tasks/<your-task-name>
```

| 类型 | 参考任务 |
|------|----------|
| Survey | `application/tasks/example-survey_product-feedback` |
| Chat | `application/tasks/example-chat-api_support_chatbot` |
| Web | `application/tasks/example-web-playwright_quote-choice` |
| OS-app | `application/tasks/example-computer-use-linux_note-to-csv` |

**运行** — 生成 Matraix Playground job（固定 agent + model），再执行：

```bash
uv run python application/scripts/generate_application_job.py \
  --task application/tasks/example-survey_product-feedback \
  --execution-mode auto \
  --persona-ids 0042 \
  --model-name anthropic/claude-sonnet-4-6

# 使用脚本打印的 export 行与 recipe 路径，例如：
uv run matraix run -c configs/jobs/application-task-job-recipe/example-survey-product-feedback-auto-n1.yaml
```

批量（`--sample-size N`）、过滤条件，以及 chat / web / os-app 示例见：
[docs/quickstart.md](../quickstart.md)。

## 文档

**[MatrAIx Handbook](../README.md)** — 指南，以及 persona / application / environment 文档。

<p align="center">
  <img src="../assets/matraix-architecture.png" alt="MatrAIx 架构" width="900">
</p>

## 仓库结构

```text
MatrAIx/
├── persona/                 Schema、数据集、合成/策展/验证流水线
│   ├── schema/              1,290 维人格 Schema
│   ├── datasets/            开发样本池与人格 YAML
│   ├── validation/          Grounding / 质量验证套件
│   └── scripts/             人格 job 与流水线辅助脚本
├── application/
│   ├── tasks/               Survey · chat · web · os-app 任务规格
│   ├── task-spec/           共享任务契约
│   ├── playground/          可视化运行器（后端 API + 前端）
│   └── scripts/             generate_application_job.py 与任务工具
├── environment/
│   ├── runtime/             Matraix Playground runtime
│   ├── agents/              人格条件化 Agent
│   ├── task-environments/   Docker 镜像 / sidecar
│   └── adapters/            外部适配器（如 SimpleQA）
├── packages/                playground · rewardkit · harbor-langsmith
├── apps/viewer/             与 `harbor view` 配对的前端
├── configs/jobs/            策展与生成的 Matraix Playground job recipe
├── docs/                    Handbook — persona/ · application/ · environment/
├── examples/                最小示例任务
├── src/matraix/             Python 包入口
├── scripts/                 仓库级辅助脚本
├── tests/                   单元 / 环境测试
└── jobs/                    本地 Matraix Playground 运行输出（gitignore）
```

大型生成数据集不纳入 git（见上方 Hugging Face 发布）。

## 加入社区

[![Discord](https://img.shields.io/badge/Discord-join%20MatrAIx-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/knVyQQnRFa)
[![X](https://img.shields.io/badge/X-follow%20%40MatrAIx2026-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/MatrAIx2026)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-follow%20MatrAIx-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/company/matraix)
[![Google Form](https://img.shields.io/badge/Google%20Form-join%20MatrAIx-4285F4?style=for-the-badge&logo=googleforms&logoColor=white)](https://forms.gle/hwEHng5HGWRqcJue9)

1. 加入 Discord —— 昵称格式 **`Full Name - Affiliation`**。填写 Google Form
   （背景、兴趣、论文署名 / 致谢意向）。
2. 来打个招呼！我们很乐意按共同兴趣或经历帮你对接。
3. 参与 MatrAIx 研究社区，一起协作或贡献！

## 引用

若你使用 MatrAIx、Persona 1M 数据集或本仓库中的结果，请引用：

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

论文：[arXiv:2608.04205](https://arxiv.org/abs/2608.04205) ·
完整作者名单：GitHub **Cite this repository**（`CITATION.cff`） ·
数据集：[Persona 1M on Hugging Face](https://huggingface.co/datasets/MatrAIx2026/MatrAIx_Persona_1M_Public_Release)。

## Star History

<a href="https://www.star-history.com/?repos=MatrAIx-ai%2FMatrAIx-Persona-8B&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=MatrAIx-ai/MatrAIx-Persona-8B&type=date&theme=dark&legend=top-left&sealed_token=Yg8UrFwz3ELwyx6wW2CobWIwzUg_VZv53wOwlLji13fApPKuro445vOLW1W5Vy_NfU4NUON-ARepltF9i1-YiNiuSzMK4BVrFHURZLQMoAkeeh4uaxqysfKvTrPQ1cW6zXotcAwoUlKv5Ana5kuWGQj0e-wZoNDaJ6QVL7c8adFut281xX5Quo0c07Y7" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=MatrAIx-ai/MatrAIx-Persona-8B&type=date&legend=top-left&sealed_token=Yg8UrFwz3ELwyx6wW2CobWIwzUg_VZv53wOwlLji13fApPKuro445vOLW1W5Vy_NfU4NUON-ARepltF9i1-YiNiuSzMK4BVrFHURZLQMoAkeeh4uaxqysfKvTrPQ1cW6zXotcAwoUlKv5Ana5kuWGQj0e-wZoNDaJ6QVL7c8adFut281xX5Quo0c07Y7" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=MatrAIx-ai/MatrAIx-Persona-8B&type=date&legend=top-left&sealed_token=Yg8UrFwz3ELwyx6wW2CobWIwzUg_VZv53wOwlLji13fApPKuro445vOLW1W5Vy_NfU4NUON-ARepltF9i1-YiNiuSzMK4BVrFHURZLQMoAkeeh4uaxqysfKvTrPQ1cW6zXotcAwoUlKv5Ana5kuWGQj0e-wZoNDaJ6QVL7c8adFut281xX5Quo0c07Y7" />
 </picture>
</a>

## 许可证

MIT —— 见 [LICENSE](../../LICENSE)。
