# 模型与思考等级

写作台不另建模型配置，直接读取当前 DSH 的模型目录与默认选择：

- `llm.listProviders()` / `llm.listModels()`：可用 provider 与模型。
- `agentDefaultModel.currentSelection()`：DSH 当前默认模型与思考等级。
- `llm.resolveModelInfo()`：每个模型支持的思考等级（off/low/high/max）。

## 任务映射

| 任务 | 内部 key | 默认思考 |
|---|---|---|
| 构思 | `premise` | 继承 DSH |
| 设定 | `bible` | 继承 DSH |
| 章纲 | `outline` | **自动 low** |
| 正文草稿 | `draft` | **自动 off（不支持则 low）** |
| 正文修订 | `revise` | **自动 off/low** |
| 质检修复 | `fix` | **自动 off/low** |
| 风格审稿 | `audit` | **自动 low** |
| 讨论 | `discussion` | 继承 DSH |
| 章节摘要 | `summary` | 继承 DSH |
| 连续性检查 | `continuity` | 继承 DSH |

优先级：

1. 项目里对该任务显式配置的 `provider/model/reasoningEffort`；
2. 未配置模型时继承 DSH 当前选择；
3. 正文类任务即使继承默认，也会把 high/max 降到 off/low；章纲与风格审稿默认 low。

## 思考等级怎么选

- **章纲 / 结构任务**：用 `low`，兼顾结构逻辑与稳定性。思考太高时推理可能占满输出、导致正文为空；插件检测到空正文会自动切到 `off/low` 重试，再按原参数重试一次。
- **正文**：用 `off/low`。文风靠文风契约、提示词注入、审稿与修复来约束，**降低思考不会修正文风**；高思考只会更慢、更贵，也更容易"只思考不落笔"。
- **审稿**：`low` 足够；审稿只输出问题清单，不需要长推理。
- **空正文诊断**：报错会区分「输出被截断」「只返回了思考内容」「空响应」三种情况，并写一条 `model.empty` 运行记录（含 usage 与实际请求），可在 `.dsh-writing/runs/` 查看。

## 配置位置

- 写作台 → 项目 → 模型分配：每行选择 provider/model 与思考等级，可“继承默认”。
- 项目 JSON：`story/project.json` 的 `models`，结构：
  ```json
  {
    "draft": { "provider": "deepseek-account", "model": "deepseek-flash", "reasoningEffort": "off" },
    "audit": { "provider": "deepseek-official", "model": "deepseek-v4-pro", "reasoningEffort": "low" }
  }
  ```
- 章节页在修订要求下方显示当前正文模型与思考等级；若为 medium/high 会提示改为 off/low。

## 接口

- `GET /novel-writer/models`：provider、模型、每个模型的 reasoning efforts、DSH 默认选择。
- `GET /novel-writer/model-info?provider=&model=`：单模型能力。
- 项目状态的 `effectiveModels`：每个任务最终解析结果，用于 UI 显示。

## 运行详情

- 每次模型调用在 `.dsh-writing/runs/` 记录运行信息（kind、model、usage、system、输入消息、输出）。
- 写作台「最近运行」可按类型（大纲/章节/文风/设定/构思/讨论/拆书）筛选；点「查看」显示该次实际使用的 system、输入与输出，并支持复制输出。
- 会话版写作台同样支持查看运行详情。
- 排查注入是否生效、JSON 被截断、风格偏离时，优先看这里。

## 注意

- 正文生成/修订/修复不建议使用 high/max：会显著增加延迟和 token，且正文质量收益有限。
- 如果模型不支持 off/low，会自动回退到支持的最低档或不传 reasoningEffort。
- 修改模型配置后立即生效，不需要重启。
