# 模式 D · 审查答复辅助 · 总则

## 定位

可选、默认关闭。显式触发后进入：

1. **案例脱敏入库**（历史通知书/答复 → Obs 笔记；向量可选）  
2. **审查文档自动答复草稿**（检索 + 手册；同点多策略相对分，分差+保范围门槛选定后直接出稿；事后摘要；可换策略另存新稿）  
3. **实务书 → 经验手册**（本地文件预读门槛 → 外挂 book-to-skill 蒸馏 → `oa/playbooks/`；不进案例检索）

**不**替代专利代理签字与正式递交；产出为草稿。

## 禁止

- 未脱敏入库含客户名、电话、未公开核心参数的原文  
- 无检索命中（或未说明库为空）就长篇「糊弄」意见陈述  
- 修改超原申请记载范围却不标注风险  
- 无人审确认即将草稿当作已递交文件  
- 将 API Key 写入仓库或在回复中回显完整密钥  
- 用书的 URL 下载/蒸馏；跳过预读把无关材料写入 `oa/playbooks/`（用户强烈要求除外）  
- 把经验手册混入 `cases/history` 或案例向量，并当作 `case_id` 引用  
- 把相对分写成授权率/授权概率；或无门槛地按稳妥分最高一路写稿（隐形永远缩权）

## 配置（对话交互 · 向量可选）

**必须 `Read`** `prompts/oa/configure_embedding.md`，按问答收集后写文件：

1. `python tools/oa/config.py recommend`  
2. 问用户：跳过 / 推荐智谱 / 其他预设 / 自定义（URL+模型+维度+Key）  
3. 用户提供后：  
   - `config.py skip-vector`，或  
   - `config.py set --preset … --api-key …`（自定义则带 `--base-url --model --dimensions`）  
4. **设置后必须自检**：`set` 默认含 `selftest`；也可 `config.py selftest`  
5. 自检通过且需重建时，人确认后 `rebuild_vectors.py --confirm`  
6. 向量超时/失败：检索回退标签（`tags_fallback`），流程不中断  

配置：`{Documents}/patent-disclosure-skill/oa/embedding.config.yaml`  
密钥：同目录 `embedding.secrets.yaml`（仅本机）

## 草稿交付（事后摘要，不中断）

写完草稿后用简短摘要交代各条主策略、同点相对分（非授权率）与换策略迭代方式，**不要**停下来等勾选再写稿。须让用户看见本稿是内部草稿、复核后才能递交。

用户说换策略（如「按修改权利要求再出一稿」）→ 另存新时间戳草稿，保留旧稿。
