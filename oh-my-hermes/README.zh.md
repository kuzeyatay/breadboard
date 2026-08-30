<p align="center">
  <img src="assets/oh-my-hermes-wordmark.png" alt="OH-MY-HERMES" width="100%" style="display:block;max-width:none;height:auto">
</p>

<table align="center">
  <tr>
    <td width="50%" align="center">
      <img src="assets/hermes-desktop.gif" alt="Hermes Desktop running an OMH workflow" width="380" height="266"><br>
      <sub><b>Hermes 桌面端，搭配 oh-my-hermes。</b><br>选一个工作流，它会先确认再构建。</sub>
    </td>
    <td width="50%" align="center">
      <img src="assets/hermes-cli.gif" alt="Hermes CLI running an OMH workflow" width="380" height="266"><br>
      <sub><b>Hermes CLI，搭配 oh-my-hermes。</b><br>在你已在用的终端里运行同样的工作流。</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="assets/hermes-messenger.gif" alt="Hermes messenger app running an OMH workflow" width="380" height="266"><br>
      <sub><b>Hermes 消息应用，搭配 oh-my-hermes。</b><br>在话题里提出请求，结果回到同一个话题。</sub>
    </td>
    <td width="50%" align="center">
      <img src="assets/omh-setup.gif" alt="omh setup installing the OMH workflows" width="380" height="266"><br>
      <sub><b><code>omh setup</code>，一条命令。</b><br>安装工作流并连接到 Hermes。</sub>
    </td>
  </tr>
</table>

# oh-my-hermes

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.zh.md">中文</a>
</p>

<p align="center">
  <a href="https://github.com/rlaope/oh-my-hermes"><img alt="GitHub" src="https://img.shields.io/badge/github-rlaope%2Foh--my--hermes-181717?logo=github"></a>
  <img alt="Python" src="https://img.shields.io/badge/python-3.11%2B-blue">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green">
  <a href="https://github.com/NousResearch/hermes-agent"><img alt="Hermes Agent" src="https://img.shields.io/badge/Hermes%20Agent-NousResearch-6f42c1?logo=github"></a>
  <a href="https://github.com/rlaope/oh-my-hermes"><img alt="OMH stars" src="https://img.shields.io/github/stars/rlaope/oh-my-hermes?style=flat&logo=github"></a>
  <a href="https://github.com/NousResearch/hermes-agent"><img alt="Hermes Agent stars" src="https://img.shields.io/github/stars/NousResearch/hermes-agent?style=flat&logo=github"></a>
  <a href="https://github.com/rlaope/oh-my-hermes/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/rlaope/oh-my-hermes/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/rlaope/oh-my-hermes/actions/workflows/pages.yml"><img alt="GitHub Pages" src="https://github.com/rlaope/oh-my-hermes/actions/workflows/pages.yml/badge.svg"></a>
  <a href="https://github.com/rlaope/oh-my-hermes/issues"><img alt="GitHub issues" src="https://img.shields.io/github/issues/rlaope/oh-my-hermes?logo=github"></a>
  <img alt="Status" src="https://img.shields.io/badge/status-1.0.4%20stable-blue">
</p>

<p align="center">
  <img src="assets/hermes-agent-hero.png" alt="Oh My Hermes" width="720">
</p>

<p align="center">
  <strong>只需安装一次。保留 Hermes，再加上一层更强的工作系统。</strong>
  <br>
  <em>以清晰的证据边界提供规划、研究、内容制作、编码 handoff、运维和项目记忆。</em>
</p>

<p align="center">
  <img src="assets/oh-my-hermes-agent-poster.png" alt="Oh My Hermes Agent poster" width="720">
</p>

**oh-my-hermes**（OMH）把
[Hermes Agent](https://github.com/NousResearch/hermes-agent) 中的普通请求，
转化为合适的能力、明确的下一步，以及对“已经发生”和“尚未发生”的诚实状态。
它不会取代 Hermes，也不会隐藏编码 executor，而是增强现有 Hermes 工作流。

[Website](https://rlaope.github.io/oh-my-hermes/) ·
[Documentation](docs/README.md) ·
[Installation](docs/INSTALLATION.md) ·
[Capabilities](docs/CAPABILITIES.md) ·
[Capability Impact](docs/CAPABILITY_IMPACT.md) ·
[Agent Install](INSTALL_FOR_AGENTS.md) ·
[GitHub Pages site](site/index.html)

> [!NOTE]
> OMH 保留 Hermes 作为自然语言入口，并增加具有明确证据边界的专业工作层。
>
> <p align="center">
>   <img src="assets/hermes-omh-terminal-orchestration.png" alt="Hermes Agent and OH-MY-HERMES working side by side" width="1080">
> </p>
>
> <p align="center">
>   <img src="assets/friren-agent-omh-callout.png" alt="Friren Agent explaining OMH in Art&Engine" width="720">
> </p>

## 快速开始

**安装本地命令和受管理的 skill：**

```sh
curl -fsSL https://raw.githubusercontent.com/rlaope/oh-my-hermes/main/install.sh | sh
omh setup
```

<br>

**Hermes skill tap：**

```sh
hermes skills tap add rlaope/oh-my-hermes
hermes skills install rlaope/oh-my-hermes/skills/omh-routing --yes
```

**或者向 Your AI Agent 提出请求：**

```text
Hey Agent, Install this >> https://github.com/rlaope/oh-my-hermes <<
```

<br>

**更新与健康检查：**

```sh
omh update
omh doctor
```

把 `--full` 安装收敛回 core 这类维护路径，见
[Installation](docs/INSTALLATION.md#reconciling-an-existing-full-install-back-to-core)。

<br>

## OMH 提供什么

OMH 将 **103 个**可安装的 workflow skill 组织为6个容易理解的能力族。

其中 11 个是 workflow engine - `deep-interview`, `loop`, `ralph`, `ralplan`, `research`, `team`, `ultragoal`, `ultraperf`, `ultraprocess`, `ultraqa`, `ultrawork` - 它们渲染为 `ulw-` 标签，
只看状态行就能知道正在运行哪一类 skill。其余 90 个使用 `omh-`。
两者的 canonical name 都保持不变。

| 能力族 | Hermes 可以做得更好的事情 |
| --- | --- |
| **规划与决策** | 澄清模糊目标，准备经过审查的计划和 durable goal loop。 |
| **学习与收集** | 查找来源、解释论文、检查数据并准备有依据的 brief。 |
| **资料与视觉制作** | 通过针对格式的质量 gate 制作网站、图像、文档、演示、PDF 和海报。 |
| **编码委派与交付** | 为 Codex、Claude Code、Hermes runtime 或选定 executor 准备明确的 handoff。 |
| **运维与观测** | 检查设置、服务质量、发布、事故、automation、session 和 workflow learning。 |
| **知识保留** | 构建经过审查的项目记忆，并通过 provider-neutral 边界连接外部知识系统。 |

完整 catalog、trigger、harness 和证据规则位于
[Workflow Reference](docs/WORKFLOWS.md)。

**亮点**

| 能力 | 使用方式 | 作用 |
| --- | --- | --- |
| 🧭 **澄清与规划** | `ulw-interview` · `ulw-plan` · `omh-decide` | 把模糊的请求转化为明确的目标、约束、权衡、验收标准，以及可以直接交接的计划。 |
| ⚡ **借助杠杆推进工作** | `ulw-work` · `ulw-goal` · `ulw-team` · `ulw-loop` | 从快速并行工作扩展到持久的多步骤执行，同时保持所有权、检查点和验证始终可见。 |
| 🔬 **研究与学习** | `ulw-research` · `omh-best-practice-research` · `omh-research-brief` | 在标明时效性、来源质量和尚未解决的不确定性边界的同时，查找并综合有依据的证据。 |
| 🛠️ **安全地编码与交付** | `ulw-process` · `omh-code-review` · `ulw-qa` | 准备不依赖特定 executor 的编码工作，并让 review、QA、CI 和 merge 的相关声明只依据实际观测到的证据。 |
| 🎨 **打造精致的交付物** | `omh-design-quality-gate` · `omh-materials-package` · `omh-deliverable-package` · `omh-image-cards` | 围绕内容、审美、无障碍性和渲染质量 gate，制作网站、视觉素材、报告、演示文稿、文档、PDF、海报和交付包。 |
| 🧠 **记忆与运维** | `omh-memory-new` · `omh-memory-sync` · `omh-ops-observability-card` · `omh-doctor` | 让项目记忆保持“先审查后使用”，呈现运维就绪状态，并在不臆造 provider 或系统状态的前提下给出下一步修复动作。 |
| 🔌 **在不隐藏边界的前提下连接** | `omh-toolbelt-readiness` · `omh-external-connector-readiness` · `omh-agent-board` | 在工作依赖某个工具、connector 或 agent 面之前先确认它是否真的可用，同时让 host 加载、工具使用和外部 provider 访问都能被分别观测。 |

## 面向真实工作的设计

<p align="center">
  <img src="assets/built-for-real-work-orchestration.png" alt="OMH orchestrating coding agents and creative tools" width="900">
</p>

> **OMH (Oh-My-Hermes)** — 让任何人都能像专业人士一样使用 hermes-agent。<br>
> 为你的 AI Agent 打造的强大智能工作层（harness）。

**🧭 不是命令列表，而是更聪明的路由器。** 英语、韩语、日语、中文、西班牙语、
法语、德语和印地语请求都可以在本地分类，无需翻译 API。OMH 会返回推荐能力
族、skill、owner、下一步，以及尚未形成证据的部分。

**🤝 更好的编码 handoff。** 可以包含仓库约束、已达成一致的 scope、worktree
与 session-isolation 指南、本地可用的 skill、验收标准、review 期望和
verification gate。Codex、Claude Code、Hermes 和 generic executor 都不会
成为隐藏的默认值，而是保持明确的 owner 身份。

**🎨 懂质量的制作。** Frontend、无障碍、图像、报告、演示文稿、文档、表格、
PDF、海报和共享交付包请求都会走专门的制作与 QA 流程。准备好的 brief 不会
被当作已生成或已通过视觉验证的产物来呈现。

**🔍 证据先于声明。** OMH 会区分已准备的意图、已观测的 runtime 事件和已
验证的结果。即便没有声称 executor 已执行、review 已通过、CI 已成功、部署
已完成或 PR 已 merge，handoff 依然可以处于就绪状态。

**🧠 以审查为先的项目记忆。** OMH 把项目记忆候选与已批准的记录分开管理，
只把经过审查、已准备好的上下文重新带入后续 handoff，不会声称读取或修改了
不透明的 Hermes 内部记忆。

**🔌 provider-neutral 的运维。** metric、wiki、browser、image、video 和
connector 系统都位于明确的外部 provider contract 之后。OMH 可以在不声称
连接或调用未实际使用的 provider 的情况下，验证并分析已提供的数据。

**🏛️ Hermes-native、executor-neutral 的架构。** Hermes 仍然是聊天、澄清、
规划、研究和状态展示的入口。被选定的 executor 负责具体实现，而 OMH 为这项
工作提供本地 contract、路由、记忆、质量 gate 和证据边界。

**🧱 local-first 的控制面。** OMH 的核心路由、catalog、manifest 和声明规则
都是确定性的本地表面。外部调用与 provider 访问始终是显式集成，而不是核心
内部隐藏的行为。

## 证据先于声明

| 状态 | 含义 |
| --- | --- |
| Prepared | route、plan、prompt、产物 contract 或 handoff 已准备好。 |
| Observed | wrapper 或 runtime 已记录某个操作或结果确实发生。 |
| Verified | 所需 test、review、实际页面检查或其他 gate 已通过。 |

`prepared_not_observed` 不代表执行、provider 访问、产物生成、review、CI、
deployment、merge readiness 或 merge。

## 文档

- [文档地图](docs/README.md)
- [安装与更新](docs/INSTALLATION.md)
- [产品方向与边界](docs/DIRECTION.md)
- [架构](docs/ARCHITECTURE.md)
- [能力 manifest](docs/CAPABILITIES.md)
- [Workflow reference](docs/WORKFLOWS.md)
- [角色](docs/ROLES.md)
- [应用案例](docs/APPLICATION_CASES.md)
- [发布与开发](docs/RELEASE.md)

## 开发

```sh
PYTHONPATH=tests uv run python -m unittest discover -s tests -v
uv run python -m compileall -q src tests
uv run python -m omh.cli docs workflows --check
git diff --check
```

OMH 是 [Team Art & Engineering](https://rlaope.github.io/artengine-lab/) 的
开源项目。请关注 [@rlaope](https://github.com/rlaope) 获取更新。
