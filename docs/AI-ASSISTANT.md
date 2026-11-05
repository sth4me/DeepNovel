# 写作助手（能力边界）

写作台 AI 页内嵌 DSH 官方对话界面（`conversation.content` embedded）。每个项目一个隐藏会话（DSH 子代理，不出现在侧栏），复用 DSH 的模型、工具与上下文压缩。助手通过 `novel_*` 工具读写项目，能力边界如下。

## 能做什么

| 工具 | 用途 |
|---|---|
| `novel_status` | 项目初始化状态与各阶段产物 |
| `novel_init` | 初始化当前目录：创建 `story/` 目录骨架与项目数据库（`story/project.db`）；已初始化时只返回现状，不覆盖数据 |
| `novel_premise` | 构思：生成候选、确认候选、读取状态 |
| `novel_style` | 文风：模板列表、套用模板、保存自定义模板、确认契约、读取状态；`profile-build`（最近定稿统计风格指纹，只统计不改文）/ `profile-get`（读取已存指纹） |
| `novel_outline` | 章纲：`update`（**首选**——改指定 1–3 章的 title / synopsis / change / storyQuestion / promise / beats / wordBudget / `time`，`chapterId` 或 `number` 二选一，只动局部；改完自动清掉该章旧审核问题并返回 `resolvedIssues`）；`volume-plan`（进入新卷前返回 2–3 个卷目标候选，不写盘）/ `volume-select`（按 `index` 选候选或 `overrides` 修订卷目标后写盘，记录 `whyNow` / `goalRevisedAt`）/ `volume-end`（标记卷收束章：`volumeId?` / `chapterNumber?`，缺省卷末章；全卷仅一章 `volumeEnd`，置 `pendingNextVolume`）；`generate` / `regenerate`（仅连续 ≥3 章崩坏 / 整卷崩 / 用户明确要求，先说明影响范围）；`commit` / `status` / `move` / `audit` / `repair`（生成候选修复版本：`applied` / `status` / `versionId` / `diff` / `summary` / `audit` / `candidateAudit`；改进且无新增问题自动应用，否则保留候选不覆盖当前大纲）；`revisions` / `revision`（`revisionId`，看 diff 与前后 audit）/ `apply-revision` / `discard-revision`（`revisionId`，应用或丢弃候选版本）；`dismiss`（忽略问题：`ids` / `chapter` / `all=true`，写入 `dismissed`，重审不会复活）；每章可带 `change` / `storyQuestion` / `promise` / `beats` / `time` / `castUsed` / `newNamed` / `agency` / `device`；生成结果带 `castViolations`；`audit` 返回一致性 `issues`（≤30）与结构 `structureIssues`（≤10，超出截断），问题有稳定 id；**audit 后不自动 repair / regenerate**，等用户确认 |
| `novel_bible` | 设定：角色/地点/规则/势力/物品的读取、生成、编辑、删除、确认；`relations` / `relations-save` 读写人物关系与站位，`power` / `power-save` 读写境界与战力体系；`commit` 确认设定后**必须停**，等用户明确要求再生成章纲 |
| `novel_chapter` | 章节：`list`（分页）/ `read`（分块）/ `search`（定位片段）/ `draft` / `batch` / `qa` / `audit` / `style-audit` / `revision-learn`（分析草稿→定稿差异、提炼写作偏好，只返回建议、不自动写入）/ `deslop`（去 AI 味改写，可 dryRun 预览）/ `fix` / `autofix` / `revise` / `save` / `patch` / `approve` / `delete` / `delete-tail` |
| `novel_cast` | 按卷选角：`list`（某卷阵容与龙套）/ `plan`（从角色池为本卷选角：核心阵容 ≤6、具名龙套 ≤3、新增命名角色 ≤2）/ `update`（调整核心阵容，名称必须在角色池、超上限报错）；角色池是 `bible`，不是本卷阵容；龙套可命名但不得承担关键转折 |
| `novel_state` | 人物状态：`get`（某章结束时处境/欲望/恐惧/知情/关系/物品/伤势/未解冲突/接续点）/ `update`（按该章正文提取并写盘；写下一章前先 get，写完 update） |
| `novel_issues` | 待处理问题清单：`list`（`limit` 默认 20）；聚合大纲结构/一致性、字数不足、人物状态未更新、选角泄漏；每项含章节号/类型/说明/建议动作（replan / repair / audit / expand / update-state；大纲问题另含 `dismiss` 忽略）；只提示，不改任何内容；结构问题优先建议用 `novel_outline action=update` 改 1–3 章，成规模（连续 ≥3 章 / 整卷）才 generate / regenerate |
| `novel_facts` | 事实/术语库：`list` / `save` / `delete`；kind 术语/硬事实/安全/称呼，可全局或按章（`chapter`），`must` 表示生成时必须遵守 |
| `novel_constraints` | 只读约束检查：`check`（`number` / `instruction`）返回 hardRules（≤12）、conflicts（含裁决与理由）、warnings；不生成正文 |
| `novel_diagnose` | 只读诊断某章：事实/术语违规、逻辑问题（因果/时间/空间/信息差/动机/能力/设定）、连续性（error 硬 / warn 软）、文风与 AI 味（软）、故事性（全软，`story`：变化/读者问题/承诺/因果/刻意感/`endingHook`）与风格偏离（`styleDrift`，scope=all）；返回 issues（hard 全量、soft ≤10）、scores/stats 与 `suggestedAction`（repair / revise / ignore / null） |
| `novel_repair` | 定向修复：`auto` 只修 hard（最小 diff、复检、未降低则回滚，≤2 轮；soft 只提示）；`prescribe` 只返回处方（`autoFixable` / `risk`），不改正文；结构问题（角色超载/桥段重复/主角被动/承诺未推进/调性漂移）不在这里修，改用 `novel_outline` 按 replan 重规划 |
| `novel_craft` | 兼容入口：写作技法卡片列表、按任务读取、推荐（新方案用 skill 工具按需加载 `craft-*`） |
| `novel_query` | 只读查询项目数据：14 个 `kind`（见下方「查询面」） |

## 交互节奏（一次一步）

每轮只做用户明确要求的那一步，完成后停下汇报结果并给出下一步选项；不要自动进入下一阶段（构思→设定→大纲→正文→审校→修订→定稿）。只有用户明确要求「连续做完 / 批量」，或工具链式必须（如先 `read` 再 `patch`）时才继续。任何确认 / commit（构思、文风、设定、章纲、定稿）完成后必须停，不得顺手生成下一步。工具内部的自动联动（如 draft 自动更新人物状态、audit 自动清理过期项）不要重复调用或再汇报成新动作。不确定用户是否要继续时先问，不要替用户决定。

## 约束优先级

写正文前先按优先级裁决冲突（高→低）：本轮对话 / 用户显式要求（`explicit`）> 硬事实 / 术语 / 安全（`facts`）> **项目写作要求（`requirements`）** > 项目设定（`bible`）> 本章章纲（`outline`）> 文风契约（`style`）> 作者备注（`notes`）。冲突时按优先级执行并在回复里说明，不要自行折中；若是「设定 / 章纲不一致」，生成照做但提醒用户同步更新设定。写正文前可先 `novel_constraints action=check`（只读，不生成正文）；涉及新固定事实（人名 / 地名 / 称呼 / 时间 / 伤势 / 持有物）先用 `novel_facts` 保存。

项目写作要求（写作要求（共享）卡）会**自动注入**生成提示词，不需要复制 / 插入到生成框；可勾选生效阶段（设定 / 大纲 / 草稿 / 修订，修复 / 扩写 / 去 AI 味归入「修订」），**不勾选 = 全部阶段生效**，勾选后即时保存。写作要求与文风契约 / 设定 / 章纲冲突时以写作要求为准（低于硬事实与本轮显式要求）。

## 写后默认流程

写完或改完章节后：先 `novel_diagnose` 检查逻辑/连续性/事实/文风；有 hard issues（逻辑、连续性 error、事实/术语）就 `novel_repair action=auto` 自动修最小 diff，soft issues（文风/AI 味）只在回复里提示（AI 味可建议 deslop），不要为满分反复修。逻辑/设定冲突优先；repair 会复检，未降低 hard 问题会自动回滚。深度档可用 `novel_repair action=prescribe` 只拿处方、不自动改。故事性与文风偏离只诊断（`story` / `styleDrift` 全为软提示）：故事问题优先改章纲 change/storyQuestion/promise，文风偏差按指纹指标用 revise 定向调整，不要为凑冲突/钩子硬改正文。

写正文/大纲前：先用 `novel_cast action=list` 确认本卷阵容（未选角时 `action=plan`），用 `novel_state action=get` 读上一章人物状态；正文只用本卷可具名角色（核心阵容 + 具名龙套），龙套不得承担关键转折；路人用身份指代，需要固定配角先 `novel_cast` 登记。写完用 `novel_state action=update` 更新状态。结构问题（角色超载/桥段重复/主角被动/承诺未推进/调性漂移）不要用 `novel_repair` 修，按 `novel_outline` 返回的 `replan` 重规划 1–3 章。章纲出现选角泄漏（用了名单外角色）不自动重写：只有「顶层 `newNamed` 泄漏且无章级违规」会自动重试一次，其余作为结构问题给重规划建议；主角连续 3 章以上被动（弧段级）与无升级的桥段重复也只报结构问题，不自动重试。

正文仍然可以用文件工具读写，但**推荐用 `novel_chapter action=patch`**：它受控、留备份、自动重建索引，不会绕过数据层的其他约束。

## 问题汇报（助手提醒）

每次 `novel_outline` / `novel_diagnose` / `novel_repair` / `novel_chapter` 返回后，若结果含 `issues` / `structureIssues` / `replan` / `warning`，先在回复开头用 1–3 行摘要列出（章节号 · 类型 · 建议动作），再继续正文；需要完整清单用 `novel_issues`。结构问题只提示、不自动处理；repair 的熔断/回滚/耗尽（rolledBack / exhausted）按「写后默认流程」处理。

## 大纲问题处理

- `audit` 返回问题后先把问题按范围列给用户，给 1–3 个可选处理（`update` 指定章 / 重规划某范围 / 忽略）；**不要自动 repair / regenerate**。
- `update` 修改章节后旧问题已自动清掉（返回 `resolvedIssues`），**不要立刻再 audit**；`audit` 只在用户明确要求时跑一次，不要连环重审。
- 不打算修的问题用 `novel_outline action=dismiss`（`ids` / `chapter` / `all=true`）忽略，写入 `dismissed`，之后重审同一 id 不会复活；问题 id 稳定（`level|number|type|message` 哈希）。
- 单次审核 `issues` ≤30、`structureIssues` ≤10，超出会截断（`truncated` 标记），先处理已有问题再继续。
- `repair` 返回 `applied` / `status`（improved / regressed / mixed / audit-unavailable）/ `versionId` / `diff` / `summary` / `audit` / `candidateAudit`：**改进且无新增问题自动应用**（覆盖当前大纲，audit 同步为修复后合并结果）；否则保存为**候选版本**、当前大纲不被覆盖（`audit` = 与当前大纲一致；`candidateAudit` = 候选修复后的 audit）。`generate` 的自动修复返回同一语义（`finalAudit = repair.audit`）。
- `applied=true` 时列出修复章节与问题数 X→Y 继续；`applied=false` 时说明候选 `versionId`、问题 X→Y、新增 N 条，让用户选择 `apply-revision` / `discard-revision` / 按 `diff` 用 `update` 改，**不要立刻重复 repair**。版本存储 `story/plot/revisions/`（保留最近 20 个），`action=revisions` 列表、`action=revision`（`revisionId`）看 diff 与前后 audit；日志里的 `lastRepair` 记录 `status` / `applied` / `versionId` / `issuesBefore` / `issuesAfter` / `newIssues` / `attemptedCount` / `runId`。

## 卷目标与叙事格式

- **卷目标（状态驱动）**：进入新卷前先 `novel_outline action=volume-plan`（`volumeId`）——返回 2–3 个候选卷目标（`title` / `map` / `goal` / `whyNow` / `cost` / `risk` / `exitCriteria` / `targetChapters` / `powerCeiling`），**不写盘**；候选由上一卷末 3 章的 `chapter_state`、末章正文结尾与摘要、未解冲突、角色池推导。用户选定或修订后 `action=volume-select`（`volumeId` + `index` 或 `overrides`；`overrides` 可改 goal / exitCriteria / whyNow / map / title / targetChapters / powerCeiling）才写盘，并记录 `whyNow` / `goalRevisedAt`。**不要直接生成新卷章纲，也不要静默替用户决定目标**；生成时若卷目标为空，插件会暂用候选 1 并给 warning（仅兜底），助手应提示用户可用 `volume-select` 改选。
- 主线停滞 / 支线挤占只由审核诊断，不改卷目标；要改目标必须 `volume-select`。
- **通用叙事格式规则**：`synopsis` 必须写成叙事句，不得用场记式 / 编号式 / 标签式标记表示时间或场景（字母+数字代号、`DayN`、时间码、方括号场景标签、以「时间，地点。」开头的清单式写法）；时间/场景要融进叙事（次日 / 三日后 / 入夜等）。审核对违规报 `issues` type「非叙事标记」或「场记式开头」（一致性 warn）。
- **时间锚点（隐藏字段）**：`novel_outline action=update` 的 `fields.time` 可选 `{ day（相对本卷开场第几天，0 起；未知 null）, part（晨 / 日 / 暮 / 夜）, spanDays（0–30）, mode（linear / flashback / parallel） }`；`time` 只存章纲 JSON，**不写进 synopsis，也不在回复/正文里展示**。`linear` 章 `day` 必须递增（同日 `part` 按晨→日→暮→夜）；`flashback` / `parallel` 不参与线性顺序。审核报「时间线冲突」时用 `update` 改 `time` 或 `synopsis`，**不要写日期代号/时间码**；生成大纲会注入最近 8 章时间线、上一章 `time` 锚点与硬事实/期限换算（day）。
- **卷收束**：本卷目标达成 / 离卷条件满足时用 `novel_outline action=volume-end`（`volumeId?` / `chapterNumber?`，缺省卷末章）标记收束——全卷**只有一个** `volumeEnd` 章，置 `pendingNextVolume`；不要无限续写。生成大纲时若本卷已 ≥`targetChapters + 2` 章仍未标记收束，会返回 `volumeEndOverdue` + warning（用 `volume-end` 收束，或扩卷 / 调整目标）。
- **新卷流程**：`volume-plan` 定目标 → `cast-plan` 定阵容（与上一卷**有差异**：至少 1 个上一卷没进阵容的角色，优先从未使用角色池 `unusedPool` 选，其次 `newCharacters` ≤2；确属同一批人则写 `noNewCastReason` 说明）→ 再 `generate` 章纲。`planVolumeCast` 返回 `newFaces` / `noNewCastReason` / `castWarning`；阵容与上一卷完全相同且无新面孔时 warning「阵容未更新」，`OUTLINE_AUDIT` 的 `structureIssues` 也有「阵容未更新」类型。

## 碎片化改正文：`novel_chapter action=patch`

参数：`number`（章号）、`target`（`draft` 或 `final`，默认 `draft`）、`find`（要替换的原文片段）、`replace`（新片段）、`all`（是否替换全部出现，默认 false）、`note`（写进 run 记录的备注）。

行为：

- 只做字符串替换，**不调用模型**：不消耗 token，也不受模型输出长度/内容审查限制，适合模型输出被中断时继续推进。
- `find` 必须唯一；出现多次时要么加 `all=true`，要么提供更长的上下文让片段唯一。
- 替换前把原全文备份到 `story/chapters/<章号>/revisions/manual-<时间>.md`。
- 更新章节 meta：`status` 置为 `manual`、重算 `wordCount`；改的是 `final` 时置 `finalStale = true`。
- 正文变了，旧质检失效：清空该章 `qa` / `style-qa`；自动重建该章 FTS 索引。
- 返回 `{ number, target, replaced, wordCount, revisionPath, staleFinal }`。

典型用法：`search` 定位精确片段（或 `read` 分块拿原文）→ 每次 `patch` 改一小段 → 需要时再 `audit` / `approve`。

## 整章操作的边界

- `draft`：生成整章草稿（调用模型）。
- `revise`：按意见整章修订（调用模型）。
- `save`：整章替换，`text` 必须是完整正文；不调用模型。
- `approve`：采纳为定稿。
- `patch` 不是「新建正文」：该章还没有草稿时先 `draft`；也没有 `patch` 之外的整章改写捷径。

## 外部能力

预设里已挂载 skill 与 MCP 客户端，助手可以按需加载额外能力。

### skill

- 加载入口只保留 `tool-skill`（`skill-filesystem` 已从预设移除）；助手通过 skill 工具按需加载全文，新增/改名/删除技能不需要重启。
- 助手技能来源有三类，按 rank 从小到大优先：
  - **内置技能（共 14 个）**：9 张技法卡片以 `craft-*`、5 个参考库以 `ref-*`（`ref-hooks` 钩子库、`ref-openings` 开篇库、`ref-reversals` 反转工具箱、`ref-emotional-arc` 情绪弧线、`ref-quality` 章节质检清单）随插件提供（provider `deepnovel-craft`，rank 600，source builtin）；**不能删除，只能按项目开关**；只在写作项目里出现（cwd 有 `story/project.db` 或 `story/project.json`），非写作会话不出现。`craft-*` 与 `ref-*` 同样走模型路由、同样可逐项开关。
  - **项目导入技能**：`<projectRoot>/.dsh/skills`（rank 100）、`<projectRoot>/.agents/skills`（rank 200）下的 `SKILL.md`，可删除；只对当前项目生效。
  - **全局 / 插件级导入技能**：`DSH_HOME/novel-writer/library/skills/`（rank 300）下的 `SKILL.md`，可删除；所有写作项目都能用。
- 冲突优先级：**项目 > 全局 > 内置**（rank 小者胜）；同名导入覆盖时先备份——项目覆盖备份到 `.dsh-writing/backups/skills-<时间>/`，全局覆盖备份到 `DSH_HOME/novel-writer/library/backups/skills-<时间>/`；列表里 `overridesBuiltin` 标出覆盖内置的技能。
- **不扫描** DSH 公共 / 系统 / 用户级技能：`<dshHome>/skills`、`<agentsHome>/skills`、`$DSH_BUNDLED_SKILL_DIR`、custom 根一律不出现；非写作项目 cwd 返回空。
- 为什么不用 `skill-filesystem`：它的 `includeDefaultRoots` 无法只保留项目根，`customSkillDirs` 又在加载时 resolve 成绝对路径、不能随项目变化；因此由我们自己的 provider 按 `lookup.cwd` 动态提供项目根（等价于 `includeDefaultRoots: false` + 显式项目根），也顺带避免引入公共 / 用户级技能。
- 格式：`<name>/SKILL.md` 或 `<name>.md`，带 YAML frontmatter，`name` / `description` 必填。
- 模型路由：助手读全文后自行判断是否适合本章（题材、文风契约、节奏、当前指令）；不适合就不套用，并简要说明。**技法不是本书设定，也不是硬性规则**。
- 不再由程序自动注入：旧方案「按任务 / 指令程序打分、把卡片全文注入提示词」已废弃；改为模型按需加载后判断（模型读了全文，比程序触发词更准）。`novel_craft` 工具保留兼容（list / read / recommend）。
- 管理接口（项目页「提示词与技能」> 技能库 tab）：`skills-list`（每项带 `scope` = builtin / project / global 与 `path`）、`skill-toggle`（仅内置，写项目 `craftDisabled`）、`skill-import`（`{ path, scope? }`，`scope` 默认 project、可选 global；目录包 / 扁平；同名覆盖前备份）、`skill-delete`（`{ name, scope }`，仅导入）、`skill-read`（`{ name, scope? }`；内置带判断提示）。

- 技能与「流程提示词」是两层：技能是**可选参考**（模型按需读取、自行判断适配性、可开关/导入/删除）；流程提示词（System 模板）是**任务必用**、可覆盖、有版本、可预览；两者数据模型不合并，见 [DESIGN.md](DESIGN.md) 的「提示词与技能（两层模型）」。

### MCP

- 预设里有默认关闭的示例 `mcp-example`（`@deepseek-ai/dsh-mcp-client`），在 `cordis.patch.yml` 里。
- 启用：把该条目 `disabled` 改为 `false`，填 `serverName` / `transport` / `url`（HTTP），或 stdio 的 `command` / `args` / `env` / `cwd`；每个服务器一个条目。
- 工具名格式 `mcp__<serverName>__<tool>`，助手与写作台按普通工具调用。
- 注意：服务器无响应会拖慢启动；不用的条目保持 disabled。

## 去 AI 味

审查与改写两侧都覆盖 AI 味。

### 审查（style-audit / 统一审校）

- `novel_chapter action=style-audit` 与统一审校（`chapterReview`）会显式检测 AI 指纹，输出 `aiFlavor`：
  - `level`：`轻` / `中` / `重`（score ≥80 轻、60–79 中、<60 重）；
  - `score`：0–100，越高越像人写；
  - `markers`：`[{ type: '禁用词|句式|结构|节奏', quote, word? }]`，最多 20 条。
- 检查清单：35 个一级禁用词（仿佛/一丝/缓缓/微微/眼中闪过/嘴角勾起/说道/感到…）、AI 句式（「，带着…」「像XX一样」「XX说道」、排比）、结构指纹（章末总结升华、段落均匀、抽象情绪直述、解释过度）、真人基准对照。
- 同时仍会报 `issues` / `styleIssues`（category 含 `AI味`）。

### 改写（deslop）

- `novel_chapter action=deslop`，或章节页「去 AI 味」按钮：先 `dryRun: true` 预览，再应用。
- 只改表达不改剧情：剧情、人物、信息、伏笔、段落顺序不动；修订前把原文备份到 `revisions/deslop-<时间>.md`。
- 长度护栏：改写后字数须在原文字数 ±30% 内，否则放弃写入；写回失败会恢复原文（失败不落盘）。
- 应用后：meta 置 `manual`、重算字数；改 final 时置 `finalStale`；清空旧 qa / style-qa；自动重建 FTS 索引。
- 返回：`{ number, target, changed, changes, beforeAiFlavor, afterAiFlavor, wordCount, revisionPath }`（`dryRun` 时多带 `text`、无 `revisionPath`）。
- 参数：`number`、`target`（默认 final 存在则 final，否则 draft）、`dryRun`、`instruction`。

### 提示词

- 写作 / 修订 / 修复的提示词会直接拼入内置去 AI 味规则（固定规则，不依赖技法卡片注入）；`deslop` 任务另有自己的 system 模板（PROMPT_CATALOG 可覆盖）。
- System 模板里新增 `deslop` 条目（PROMPT_CATALOG，可在项目页覆盖）。

参考思路借鉴 MuMuAINovel 的 story-deslop（禁用词表 / 三遍法 / 真人基准）与 DeepWrite 的文风技能结构（必须贯彻 / 绝对禁止 / 按场景调节 + 试写校验）；实现与文案为本项目自写。

## 数据层规则

- 结构化数据在 SQLite（`story/project.db`），旧 `story/*.json` 只是**只读存档**。
- 改大纲 / 设定 / 文风 / 构思 / 章纲分别用 `novel_outline` / `novel_bible` / `novel_style` / `novel_premise`；核对数据用 `novel_query`。
- **不要用文件工具改 `story/*.json` 或数据库文件**：旧 JSON 已不参与读写，改库文件会绕过事务与索引。
- 系统提示词里的 `deepnovel:data-layer-rules` 段会向助手说明这些规则。

## 关系与能力读写

- `novel_bible action=relations` / `power` 读取；`relations-save` 保存关系与站位，`power-save` 保存境界与战力体系。
- 用于助手自查修复：坏关系（引用不存在的角色）、境界 / 战力矛盾（无铺垫跨级、层级倒挂）。
- 写入校验：关系按角色名校验，未知角色、自环、重复会被丢弃；`positions` 只保留已知角色与数值坐标；power 的 `tiers` 按 order 排序、`chapterChanges` 规范化。
- 写操作与界面共用同一套资源锁（`bible`）；资源忙时工具直接返回「资源忙」而不执行，避免与界面同时改设定/关系。

## 查询面：`novel_query`

只读，不开放裸 SQL；14 个 kind 都支持 `keyword` / `limit`（章节类用 `number` / `limit` / `keyword`）。

| kind | 返回要点 |
|---|---|
| `chapter` | 带 `number` 时返回单章 `chapter` / `meta` / `qa` / `styleQa` / `continuity` / `summary`、`hasDraft` / `hasFinal` / `wordCount`，正文预览 ≤600 字；不带 number 时按 keyword 列章节（默认 30 条，带 `total` / `truncated` / `nextOffset`，梗概 ≤200 字） |
| `outline` | 默认只回卷列表 + `chapterCount`；`expand=chapters` 才展开章节明细（默认 20，可按 `volumeId` / `fromNumber` / `toNumber`，带 `truncated` / `nextNumber`） |
| `bible` | 设定状态与五类条目 |
| `state` | 已定稿章节的状态快照 |
| `summary` | 章节摘要（可按 keyword 过滤摘要 / 人物） |
| `stats` | 写作统计 |
| `runs` | 最近运行记录 |
| `relations` | `{ status, relations: [{ from, to, type, note }], positions }`，支持 keyword |
| `power` | `{ status, system, tiers, characters, changes }`；`changes` 按章号倒序，支持 keyword |
| `inspirations` | `{ items }`，默认 10 条，每条想法截断 ≤200 字 |
| `deconstructions` | 默认 `{ items: [{ title, createdAt, summary(≤300), counts }] }`，不返回全文；用 `entryId`（title 或 createdAt）或 `number`（第 N 条）取单条全文 |
| `prompt-overrides` | 只回自定义过的提示词：key、版本、`preview`（≤120 字） |
| `premise-chat` | 构思对话消息（内容 ≤400 字）与批次（带 `candidateCount`） |
| `materials` | 素材库：keyword 匹配标题 / 内容 / 标签，limit 默认 20，`content` 截断 400 字 |

长文本刻意截断：需要详情时先看摘要，再用 `entryId` / `number` 取单条，避免一次把大段内容塞进上下文。

## 上下文预算

工具输出不再全量返回，长内容分页/分块。这里的预算是**字符预算，不是 token 预算**：目的是保证单次工具结果完整可读、不把大对象塞进上下文，而不是省 token。

模型输出默认**不限制 maxTokens**（不传该参数，用提供商/模型的最大值）；只有显式参数或项目 `automation.maxTokens` 才会限制，没有 budgetCap 预算封顶与「超限自动加倍」重试。大纲审核按 ≤12 章分块（为控制单次输出质量与超时，与预算无关）。

- `novel_chapter action=list`：`limit`（默认 30，上限 200）、`offset`、`volumeId`、`status`；返回 `{ total, offset, limit, chapters[], truncated, nextOffset }`，每条摘要截断 80 字。
- `novel_chapter action=read`：`maxChars`（默认 6000）、`range`（`{ start, end }`，优先于 maxChars）、`part`（`draft` / `final` / `both`）；`draft` / `final` 各带 `{ text, start, end, truncated, nextRange }`；`revisions` 只回数量 + 前 3 个文件名。
- `novel_chapter action=search`：在某章正文里找片段（默认 5 条），返回命中 `index` 与前后 80 字 `context`；`patch` 前先用它定位精确原文，避免整章读入。
- `novel_query`：`outline` 默认只回卷列表 + `chapterCount`，`expand=chapters` 才展开（默认 20 条）；`kind=chapter` 不带 number 默认 30 条。
- 所有截断结果都带 `truncated` 和 `next*`（`nextOffset` / `nextRange` / `nextNumber`），这是给助手判断数据完整性、决定是否继续翻页/续读用的。
- 典型调用都在 DSH 默认的工具结果裁剪线以内（实测 list 默认约 6.3k 字符、read 默认约 6.4k、outline 展开约 2.5k、search 约 0.9k，均低于 8192）；正常使用不会触发裁剪。裁剪器保留 DSH 默认的 8192 / 4096 / 1024 作为极端兜底，DeepNovel 不再自定义。

## 压缩

对话变长时有两套压缩入口：自动（DSH 默认）与手动（AI 页按钮）。

### 自动压缩

- 由 DSH 内置的 `compaction-basic` 负责，`auto: true` 是 DSH 默认；预设里已挂载，不覆盖。
- 在每个 step 边界按模型请求压力触发：`thresholdRatio = 0.8`（约 80% 时压缩），保留约 16% 原文尾部（`retainRatio = 0.16`），`headroomTokens` 默认 65536。
- 写作台的隐藏子代理（`agentPreset: novel-writer`）同样生效，不需要任何操作。
- 需要调整只能在预设里给 `compaction-basic` 写 config（`thresholdRatio` / `retainRatio` / `headroomTokens`），DSH 没有对应的 UI 设置项。

### 手动压缩

- AI 页工具栏「压缩上下文」按钮（在「新对话」左侧），等价 DSH 的 `/compact`；内嵌对话界面不提示斜杠命令，所以做成按钮。
- 点击后弹出确认框，调用 project-action `conversation-compact`，对隐藏子代理执行 `compactNow`。
- 返回三种结果：
  - 成功：`{ compacted: true, items, tokens, message: '已压缩 N 条历史（约 M tokens）' }`；
  - 消息太少（少于 6 条）：`{ compacted: false, message: '对话还太短（N 条消息），暂不需要压缩' }`；
  - 没有对话历史 / 会话正在生成：返回可读错误（「还没有对话历史，先在 AI 页发送一条消息」/「会话正在生成或已有压缩任务，请稍后再试」）。
- 不会创建 DSH 侧栏会话：仍是隐藏父会话下的 continuable 子代理；只改对话历史，不动项目数据。
- 子代理回合结束、不在内存时，会先 resume 并挂载 `novel-writer` 预设再压缩。

「字符截断」和「压缩摘要」是两回事：压缩是会话级摘要（历史消息被摘要、保留尾部原文）；工具输出的分页/分块与 `truncated` 是单次结果层面的，不影响会话历史。

## 读取路径对照

| 数据 | 位置 | 推荐读取方式 |
|---|---|---|
| 大纲 / 设定 / 关系 / 能力 / 文风 / 构思 / 状态 / 统计 / 运行记录 / 提示词覆盖 / 构思对话 | SQLite（`story/project.db`） | `novel_query`，或对应 `novel_*` 工具 |
| 章节正文（`draft.md` / `final.md` / `revisions/`） | `story/chapters/<章号>/` Markdown | 文件工具可读；改正文推荐 `novel_chapter action=patch` |
| 灵感历史 / 拆书历史 | `.dsh-writing/inspirations.json`、`.dsh-writing/deconstructions.json` | 文件工具可读，推荐 `novel_query`（`kind=inspirations` / `deconstructions`） |
| 旧版 `story/*.json` | 迁移后保留 | 只读存档，**改了不生效**，不要修改 |

## 为什么用工具查询而不是读全量 JSON

- 章纲、设定、拆书记录体积大，直接读文件容易一次塞满上下文；旧 JSON 又已经不是真源。
- `novel_query` 按 kind 只返回必要字段并截断长文本；不够时再按 `entryId` / `number` 取单条，或由插件侧补一个新的 kind。
- 需要精确核对时用 `novel_query`，不要用文件工具读数据库文件。

## 并发与锁

助手工具与界面共用同一套资源锁（Host 仲裁），不会互相覆盖：

- 资源粒度：`chapter:<章号>`、`chapter:batch`、`outline`、`bible`、`style`、`premise`、`project`、`project:import`、`project:export`。
- 资源忙时工具不执行，直接返回 `{ ok: false, tool, error: '资源忙：…', hint }`；助手应稍后重试或换一个不冲突的动作，不要重复调用。
- 批量/全项目动作占用更粗的锁：`chapter-delete` + `removeOutline=true` 会重排后续章号，占 `chapter:batch`；导出占 `project:export`；快照/恢复/导入占 `project` / `project:import`。
- 全局资源（`project`、`project:import`、`project:export`）与任何其它锁互斥；锁跨窗口、跨 owner 可见。
- 界面通过 `project-state` 的 `activeLocks` 与 `project-runs` 的 `{ runs, locks }` 展示当前占用。

## 助手与界面互相可见

- 界面任务托盘会显示助手占用，例如「写作助手 · 第 N 章」「写作助手 · 批量章节」；这类条目没有取消按钮，可在 AI 页停止对话。
- 被助手占用的资源，界面上相关按钮会禁用并提示「写作助手正在处理该资源」。
- 反过来，界面任务进行中时，助手对同一资源的写操作会收到「资源忙」错误；等界面任务结束再重试即可。

## 工具报错与中断恢复

- 所有 `novel_*` 工具抛错时会统一返回 `{ ok: false, tool, error, hint }`，`hint` 给出下一步建议（例如先 `read` 确认、换用 `all=true`、先初始化）。助手据此继续推进，不会因为一次工具错误卡死。
- 模型输出被服务端中断（内容审查 / 超时）时：**不要整章重新生成，也不要重复同一调用**。改用 `read` → `patch` 小步推进，每次只改一小段。
- 同一任务连续两次被中断时，助手应明确告诉用户：当前模型的输出被服务端拦截，建议换用不审查的模型或把改动拆得更小。这里只是如实描述限制，不承诺绕过审查。
- 系统提示词里的 `deepnovel:interruption-recovery` 段会向助手说明这套恢复策略。

## 外部直接改正文的影响

写作助手或外部编辑器直接改 `story/chapters/<章号>/draft.md` / `final.md` 后：

- 章节监听会自动重建该章检索索引、校正字数、刷新正文存在性；
- 该章 meta 会被标为 `manual`；如果改的是 `final`，置 `finalStale = true`；
- 数据健康页会提示「定稿落后于草稿」，可执行「刷新过期定稿」重新对齐。

监听细节见 [DATA-LAYER.md](DATA-LAYER.md)。

## 读取与初始化

- `novel_init` 创建 `story/` 与 `story/project.db`；已初始化时只返回现状，不覆盖已有数据。
- `novel_chapter action=read` 返回 `draft` / `final` / `qa` / `summary` / `revisions`、`outlineChanged`，以及 `hasDraft` / `hasFinal` / `wordCount`，助手据此判断能否 `patch` 或需要先 `draft`。

## 相关

- 数据层与表结构：[DATA-LAYER.md](DATA-LAYER.md)
- 写作台 UI（AI 页）：[UI.md](UI.md)
- 模型与思考等级：[MODELS.md](MODELS.md)
