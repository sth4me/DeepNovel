# 写作台设计说明

## 方向

把写作台当成**编辑的案头**，而不是一组设置表单：

- **编辑感**：项目名、步骤标题、章节标题用衬线体；正文用无衬线 UI 字体，控件退后。
- **安静**：深色/浅色只用主题 token 的层级色；高饱和色只用于主操作和状态。
- **主面板**：写作台是全局主面板（侧栏入口 + `main` key），不是会话侧栏。三栏：流程 rail / 工作区 / 流程与 AI inspector。
- **专注**：顶部可一键隐藏左右栏（Esc 退出），正文区域成为唯一焦点。

## 布局

- 左栏 222px：六步流程（项目 → 构思 → 文风 → 设定 → 大纲 → 章节），带状态、说明、完成勾。
- 中间：`max-width 1120px` 的工作区；章纲/章节采用 master-detail（左列表 + 右阅读/编辑，各自滚动）。
- 右栏 336px：流程状态 / AI；窄屏可收起或作为抽屉打开。
- 底部「下一步」栏：显示当前阻塞项并直达下一步。
- 章节页：标题 + 质检/AI 徽标 → 修订要求 → 写作动作 → 质检摘要 → 修订历史 → 局部重写栏 → 正文。质检详情默认折叠。
- 章节操作分组：写作类（按意见修订/重新生成/采纳定稿）与质检类（检测/多轮修复/单轮修复）分开。

## 设计系统

- 颜色：`--dsw-alias-bg-layer-1/2` 画布/卡片，`--dsw-alias-border-l1/l2` 分隔，`--dsw-alias-label-primary/secondary` 文本层级，`--dsw-alias-brand-primary` 主操作/选中；状态色只用于徽标与 dot。
- 字体：
  - UI：系统无衬线，11–12.5px，行高 1.6–1.7。
  - Display：`Iowan Old Style / Palatino / Songti SC / STSong / Georgia`，用于项目名、步骤标题、章节标题、AI 分数。
- 间距：4 / 8 / 12 / 16 / 20 / 24；卡片圆角 14px，输入框 8px，按钮 9px。
- 组件：rail、step intro、panel、candidate card、template card、chapter list、QA summary、issue list、selection bar、diff、toast、error panel、empty state。
- 交互：hover 轻背景；focus 品牌色柔光环；生成中显示秒数 + 取消；未保存显示提示；破坏性操作二次确认。

## 数据层

采用混合数据层：结构化数据进 SQLite，正文留在 Markdown 文件。

- **结构化数据**：项目、构思、文风、设定、关系、能力、卷与章纲、章节状态/质检/摘要、统计、运行记录、System 模板覆盖、备注，统一存 `story/project.db`（内置 `node:sqlite`，WAL）。这些数据需要事务、跨表一致和检索，散成几十个 JSON 文件时每次操作都要多次读写、互相校验成本高。
- **正文**：`draft.md`、`final.md`、`revisions/` 保持 Markdown。手稿要保持可读、可用编辑器直接改、可进 git diff，不能因为换了存储方式而变得不可读。
- 边界：正文可版本化，结构化数据可事务化与索引化；两者通过章节号关联。旧项目首次打开自动迁移，旧 JSON 留作只读存档。
- 实现细节（表结构、迁移、快照、检索、排错）见 [DATA-LAYER.md](DATA-LAYER.md)。

## 技能库

内置技法不再单独做「技法库」，而是作为**内置技能**与项目导入技能平级出现在同一技能目录。

- **内置技能（14 个）**：9 张项目无关的通用技法卡片以 `craft-*` 随插件提供，另有 5 个参考库以 `ref-*`——`ref-hooks` 钩子库（章首 7 类 / 章尾 10 类）、`ref-openings` 开篇库（7 种建立方式）、`ref-reversals` 反转工具箱（7 类反转的铺垫/回收/失败）、`ref-emotional-arc` 情绪弧线（单章曲线/跨章节奏/外化清单）、`ref-quality` 章节质检清单（结构/信息/场景/语言/连载）。全部 provider `deepnovel-craft`、rank 600、source builtin；不能删除，只能按项目开关（项目 `craftDisabled`）；只在写作项目里出现（有 `story/project.db` 或 `project.json`），非写作会话不出现。内容自写（参考 MuMuAINovel / DeepWrite 思路，未大段复制），项目无关。
- **项目导入技能**：`<projectRoot>/.dsh/skills`（rank 100）、`<projectRoot>/.agents/skills`（rank 200）下的 `SKILL.md`，可删除；只对当前项目生效。
- **全局 / 插件级导入技能**：`DSH_HOME/novel-writer/library/skills/`（rank 300）下的 `SKILL.md`，可删除；所有写作项目都能用。
- **优先级**：同名冲突时 **项目 > 全局 > 内置**（rank 小者胜）；覆盖前备份——项目覆盖备份到 `.dsh-writing/backups/skills-<时间>/`，全局覆盖备份到 `DSH_HOME/novel-writer/library/backups/skills-<时间>/`。
- **范围**：助手技能只来自内置 `craft-*` + 项目导入 + 全局导入；不扫描 DSH 公共 / 系统 / 用户级技能（`<dshHome>/skills`、`<agentsHome>/skills`、`$DSH_BUNDLED_SKILL_DIR`、custom 根）；非写作项目返回空。加载入口只保留 `tool-skill`（`skill-filesystem` 已移除，项目根由 provider 按 cwd 动态提供）。
- **路由**：模型路由——AI 用 skill 工具按需加载全文，读后判断是否适合本章（题材 / 文风契约 / 节奏 / 指令），不适合不套用；技法不是本书设定、不是硬性规则。旧的「程序按任务 / 指令打分注入全文」已废弃（模型读全文判断比程序触发词更准）。
- **内容**：出处为通用写作 / 编剧理论 + 网文实践整理，自写摘要非复制（检查清单思路参考 MuMuAINovel / DeepWrite）；每张卡统一五节【适用】【通用原则】【按场景调节】【常见反例（不要这样写）】【自检】，数字多为参考值。
- **管理**：项目页「提示词与技能」卡的技能库 tab（scope 徽标 / 内置开关 / 导入（项目或全局）/ 删除 / 预览分节渲染 / 导入弹窗）；project-action `skills-list`（每项带 scope/path）/ `skill-toggle`（仅内置）/ `skill-import`（`{ path, scope? }`）/ `skill-delete`（`{ name, scope }`）/ `skill-read`（`{ name, scope? }`）。

## 提示词模板

提示词模板能力整合在项目页「提示词与技能」卡的流程提示词 tab，不单独做工作台页面。

- **目录**：`PROMPT_CATALOG` 23 条，每条带 `group`（premise / bible / outline / chapter / review / craft / data / other）与 `tags`，用于分类筛选。
- **预览**：只读 `prompt-preview { key }` 返回 `defaultText` / `currentText` / `customized` / `baseRevision` / `revision` / `variables`（从 `{{name}}` / `${name}` 提取，去重、最多 20 个）；由代码拼装的模板不执行，返回 `variablesHint`。预览不调用 LLM。
- **编辑**：覆盖仍写 `prompt_overrides` 表，编辑 / 覆盖 / 恢复默认逻辑不变；「默认已更新」判断沿用 baseHash + baseRevision。

## 提示词与技能（两层模型）

写作台把「流程提示词」与「技能」分成两层，**数据模型不合并**，但共享同一套写作规则。

- **流程提示词**（System 模板，`PROMPT_CATALOG` 23 条）：任务必用——每个生成动作按任务取对应 system；可在项目页覆盖、有版本号、可预览默认/当前与占位符；覆盖存 `prompt_overrides` 表。
- **技能**（`craft-*` / `ref-*` / 导入技能）：可选参考——模型按需用 skill 工具读取全文，读后自行判断是否适合本章；可逐项开关、导入、删除；不是硬性规则、不是本书设定。
- **为什么不合并**：流程提示词决定「这个任务怎么执行」（必须稳定、可覆盖、可审计版本）；技能是「可参考的写作方法库」（可增长、可导入、由模型判断）。合并会让必用规则与可选参考混在一起，难以保证行为稳定。
- **共享规则**：禁用词（35 个）、AI 句式、真人基准、章节质检清单（5 组）集中在 `writing-rules.js`；提示词模板、流程动作（aiFlavor 估算 / deslop）与技能卡（craft / ref）都从这里引用，避免多处手写字面量漂移。
- **管理入口**：项目页「提示词与技能」卡，双 tab——「流程提示词」与「技能库」；素材库卡独立。

## 修订学习

从「草稿 → 定稿」的差异里提炼作者自己的稳定写作偏好，整合进项目「写作要求（共享）」卡，不新增系统或数据表。

- **范围**：只分析同时存在 `draft.md` 与 `final.md` 且内容不同的章节；指定章号时只分析该章，否则按 diff 大小取最近 N 章（`count` 默认 3、上限 6）。
- **只读**：`revision-learn` 只返回 `{ summary, preferences, stats, chapters }`，不写文件 / DB；走 `runWithProgress`，可取消。
- **提示词**：`revisionLearn` 在 `PROMPT_CATALOG`（group craft）中，可覆盖；要求偏好稳定（同类修改 ≥2 次）、rule 可执行、最多 8 条、证据不足返回空。
- **写入**：结果在弹窗里勾选后，才用 `project-update` 追加到 `writingNotes`；不自动改写正文。
- **助手**：`novel_chapter action=revision-learn` 只返回建议，不写入。

## 写作工程化

把写作流程从「每次生成各自拼提示词」改造成「基础原则 + 按卷选角 + 状态驱动 + 结构分流 + 文风档案 + 字数与钩子 + 角色纪律 + token 策略」的工程化链路。

### 基础原则（doctrine）

`writing-doctrine.js` 统一提供 `WRITING_DOCTRINE` / `CAST_RULES` / `composeWritingSystem`：用户本轮要求优先；注入的上下文是方法与长期约束、**不是事实**；技能是方法不是设定；发现冲突先指出、再最小改动，不静默推翻已确认内容。写作类 system（premise / bible / outline / draft / revise / fix 等）统一前置 doctrine；助手系统提示词另有「写作基础原则」段（order 10120）。

- 建设链路：人物（处境/欲望/恐惧/缺陷/秘密/底线/行动逻辑/关系张力）→ 核心承诺与书脊 → 动态阶段（不写死走向，由冲突/选择/信息差派生）→ 小节目录 → 正文 → 角色状态。
- 负向约束：不为凑爽点/钩子硬造冲突反转；不重复同一目标/场景两次以上；不偏离类型调性；不靠巧合/降智/外部意外解决；不把结构问题当文字修；只写正式内容。

### 角色池与按卷选角

`bible_entries.meta_json`（schema v5）存角色生命周期：`status`（未登场 / 活跃 / 退场）、`firstChapter`、`importance`。bible 是**角色池**，不是本卷阵容。

- `planVolumeCast`：角色池（bible）是可用演员表，`volume.cast` 是**本卷焦点名单**而非出场白名单。焦点名单 `cast` 建议 6 人左右（最多 12）；具名配角 `extras` 建议 3 人左右（最多 8，可推动有铺垫的局部转折）；预计复用的新名字 `newCharacters` 建议 2 个左右（最多 6，必须登记）；纯功能路人用身份指代。`CAST_LIMITS = { volumeCast: 6, namedExtrasPerVolume: 3, newNamedPerVolume: 2, volumeCastMax: 12, namedExtrasMax: 8, newNamedMax: 6 }`，只在前三项作为建议、后三项作为硬上限。`cast-plan` 生成焦点名单，`cast-list` 读取，`cast-update` 调整；结果写 `volume.cast`（`name` / `roleInVolume` / `fromChapter` / `importance`）与 `volume.extras`（`name` / `roleInVolume` / `fromChapter` / `note`），助手 `novel_cast`。
- 大纲/正文只用本卷可具名角色；未登场角色不出现；正文不给路人取名（用身份指代）；未登记的命名角色 → hard 一致性问题（advice：改身份指代或先 `novel_cast` 登记）。
- **新卷焦点名单**：`planVolumeCast` 计算上一卷焦点名单与未使用角色池，但**不再强制轮换**——焦点名单可沿用上一卷，也可引入新面孔；连续多卷完全相同且无新面孔/新关系变化时只给软提示（`castWarning` 与 OUTLINE_AUDIT 的「焦点名单连续多卷」结构提示）。返回 `newFaces` / `noNewCastReason` / `castWarning`。

### 状态驱动

`CHARACTER_STATE`（`scene` + `characters[{situation, desire, fear, knowledge, relationships, items, injuries, unresolved, nextHook}]` + `summary`）存 `chapter_state` 表（JSON 列）。

- draft 注入上一章状态 + 本卷阵容 + 状态驱动说明（允许偏离章纲 change、以角色选择推进）。
- 写完自动 `updateChapterState`（只记录实际发生；阵容外角色剔除并 warning）；`chapter-state` / `chapter-state-update`，助手 `novel_state`。

### 结构问题分流

`OUTLINE_AUDIT` 输出两类：`issues`（一致性）与 `structureIssues`（角色超载 / 桥段重复 / 主角被动 / 承诺未推进 / 调性漂移 / 因果薄弱 / 黄金三章）。

- 结构问题**只建议重规划**（`replan`，1–3 个范围），不进 outline repair；`repairOutlineIssues` 遇到仅结构问题时返回 `reason:'structure-only'` + `replan`。
- `diagnoseChapter` 返回 `suggestedAction`：有 hard → `repair`；仅 story 软问题 → `revise`；其余 `ignore`；无问题为 `null`。
- 章节 repair 仍只修一致性问题（熔断/回滚/尝试上限/过期清理）。
- **角色名字校验（确定性，软提示）**：生成后校验 `castUsed` / `newNamed`。角色池内已登记角色（即使不在本卷焦点名单）不算违规；只有角色池外的新名字写入 `structureIssues`（type「未登记角色」，advice 给“会复用则登记 / 一次性改身份指代 / 可保留临时名”三选一），**不自动重试、不阻塞写盘**；`castViolations` 随生成结果返回，`focusWarning` 提示“已登记但未列入焦点名单”。
- **主角主动性（弧段级）**：每 2–4 章至少一次有代价/风险的主动选择；连续 3 章以上被推着走 → `structureIssues`（主角被动，number 用连续区间起始章、message 写范围）。
- **重复诊断（无升级才算）**：同一推进手段（夜探/交涉/交易等）连续使用，第二次必须带来新信息/新代价/新阻力；连续两章同手段且无升级 → `structureIssues`（桥段重复，给范围）。纯标签相同不算；不计数、不自动重试。
- **局部修改优先**：单章或局部问题用 `novel_outline action=update` 改 1–3 章（title / synopsis / change / storyQuestion / promise / beats / wordBudget）；只有连续 ≥3 章崩坏、整卷崩或用户明确要求才 generate / regenerate，且先说明影响范围；`audit` 后不自动 repair / regenerate，等用户确认。
- **一次一步**：助手每轮只做用户明确要求的那一步，完成后停下汇报并给下一步选项；任何确认 / commit 后必须停，工具内部联动不重复调用（详见 [AI-ASSISTANT.md](AI-ASSISTANT.md)「交互节奏」）。

### 卷目标状态驱动

- **输入**：上一卷末 3 章的 `chapter_state`（场景 / 人物状态 / 未解冲突）、末章正文结尾（≤600 字）与摘要、角色池（前卷阵容 + 本卷阵容 + 活跃角色）。
- `planVolume` 生成 2–3 个差异明显的候选（`goal` 是当前局势下必须解决的开放问题；`whyNow` 由上一卷末处境/欲望/未解冲突推出；`cost` / `risk` 具体；`exitCriteria` 可判断），**不写盘**。
- `selectVolumePlan` 按 `index` 选候选或 `overrides` 修订（goal / exitCriteria / whyNow / map / title / targetChapters / powerCeiling）后写盘，记录 `whyNow` / `goalRevisedAt`。
- 生成新卷章纲时若目标 / 舞台为空：自动规划并暂用候选 1，返回 `volumeGoalCandidates` + `volumeGoalWarning`（仅兜底，不是静默决定）；用户可用 `volume-select` 改选。
- 审核的「主线停滞 / 支线挤占」只诊断，不改目标；改目标必须显式 `volume-select`。
- **卷收束**：`markVolumeEnd`（`novel_outline action=volume-end`，`volumeId?` / `chapterNumber?`，缺省卷末章）设置且**仅设置一章** `volumeEnd`（清掉其它章标记），置 `pendingNextVolume`；本卷目标达成 / 离卷条件满足时应收束，不无限续写。生成大纲时若本卷已 ≥`targetChapters + 2` 章仍未标记收束，返回 `volumeEndOverdue` + warning（用 `volume-end` 收束，或扩卷 / 调整目标）。

### 通用叙事格式规则

- 概述 / 章纲类输出（`synopsis`）必须是叙事句；不得用场记式 / 编号式 / 标签式标记表示时间或场景（字母+数字代号、`DayN`、时间码、方括号场景标签、以「时间，地点。」开头的清单式写法）。
- 时间与场景要融进叙事（次日 / 三日后 / 入夜等）；审核对违规报 `issues` type「非叙事标记」或「场记式开头」（一致性 warn），advice 改为把时间/场景写进叙事句。

### 字数与黄金三章

- draft 目标 = `style.chapterWords` 或 `chapter.wordBudget`（默认 3000），下限 80%；不足自动扩写（最多 2 次，`expandChapterText` 不改情节 / 不新增命名角色），返回 `wordCount` / `wordTarget` / `expanded` / `wordCountWarning`。
- 大纲审核含黄金三章：ch1 给出主角欲望或麻烦并以具体钩子收尾；ch2 冲突/承诺升级；ch3 出现一次小胜利或阶段兑现（纯铺垫、送信传话不算）。
- 故事审校含 `endingHook`（type：动作/决定/信息/问题/留白/无；strength 0–1；newQuestion）；第 1 章弱钩子或强度 <0.3 报 soft。

### 角色纪律

正文只能使用本卷阵容内的具名角色；路人/次要人物一律不给名、用身份指代；需要固定配角先登记；未登记命名角色 → hard 一致性问题，advice「改身份指代或先 novel_cast 登记」。

### 文风模板档案

9 个内置模板升级为专业档案：`narrative` / `syntax` / `dialogue` / `description` / `emotion` / `chapterShape{opening,middle,ending}` / `anchors`（2 段原创锚点）/ `selfCheck` / `forbidden`；`formatStyleFields` 渲染新维度，锚点进入章节 prompt；`STYLE_CONTRACT` / `STYLE_AUDIT` 同步新维度。

### token 策略

默认不向模型传 `maxTokens`（用提供商/模型最大值）；只有显式参数或项目 `automation.maxTokens` 可限制；不设 budgetCap、不做预算加倍重试；大纲审核按 ≤12 章分块（质量/超时原因，与预算无关）。

## 约束引擎

生成正文前把各层要求按优先级裁决成一份「硬约束」，同一份内容在提示词开头完整给出、结尾再复述一次，避免提示词自相矛盾。

- **优先级**（高→低）：`explicit`（本轮对话 / 显式指令）> `facts`（硬事实 / 术语 / 安全 / 称呼）> **`requirements`（项目写作要求）** > `bible`（设定）> `outline`（本章章纲）> `style`（文风契约）> `notes`（作者备注）。项目写作要求自动注入生成提示词（统一 `WRITING_NOTES_TITLE` 前置 + 冲突规则），不需要用户复制/插入；阶段勾选（设定 / 大纲 / 草稿 / 修订）在 `writingNotesFor(project, stage)` 过滤，`fix` / `expand` / `deslop` / `qa-fix` / `autofix` 映射到 `revise`，不勾选 = 全部阶段生效。
- **HARD_RULES 缺口**：`constraints.hardRules` 目前只收结构化来源（显式指令里的视角/时态/句长/对话比例线索、facts 的硬事实/安全/称呼、术语 canonical、章纲 synopsis 的「本章必须发生」）；写作要求/备注/风格描述属内容型要求，整段注入提示词文本并按优先级裁决，但**不会转成逐条 hardRules**——因此写作要求里的具体禁令靠「统一注入块 + requirements 层级」生效，而不是结构化硬规则。
- **结构化冲突**：视角 / 时态 / 句长 / 对话比例与文风契约冲突；术语 / 称呼写法；章纲要求人物死亡但设定记录存活；章纲要求回收但伏笔台账已完成。前两类按优先级自动裁决（记录 conflicts）；后两类不静默覆盖，生成照做并用 warning 提示同步更新设定 / 台账。
- **可选语义预检**：LLM 检查规则间矛盾（失败降级为仅结构化检测，不阻塞生成）。
- **硬约束**：≤12 条；`renderConstraints` 开头完整 + 结尾紧凑复述（内容一致、不新增规则；保留全量上下文，不瘦身）。
- **事实包**：`facts` 表（schema v4）存术语 / 硬事实 / 安全 / 称呼，全局或按章；生成前进硬约束，生成后 `validateAgainstFacts` 可查违规（只报告、不自动改）。
- **入口**：`novel_constraints action=check`（只读检查）、`novel_facts`（list / save / delete）；project-action `facts-list` / `fact-save` / `fact-delete`，锁资源 `facts`。

## 诊断与修复

写完 / 改完章节后的默认链路：先诊断、再只对硬问题做最小修复，软指标按阈值放行，不追求满分。

- **诊断**（`diagnoseChapter`）：合并三路结果——facts 规则违规（hard）、`logicAudit` 逻辑审查（因果/时间/空间/信息差/动机/能力/设定，hard）、章节审校（continuity error→hard、warn→软；styleIssue/AI 味→软）。每条 issue 有稳定 id（按 type+quote 哈希）、`level`（hard/soft）、`source`（facts/logic/continuity/style/aiFlavor）；返回 `scores` 与 `stats`。
- **修复**（`repairChapter`）：
  - `mode=auto` 只修 hard：按 issue 生成最小 diff patches，`from` 必须逐字且唯一匹配，否则记入 `skipped`；写前备份 `revisions/repair-r<轮>-<时间>.md`；每轮后复检 facts + logic；hard 不降或新增 >2 条则回滚；最多 2 轮。
  - `mode=prescribe` 只返回处方（每条含 `autoFixable` / `risk`），不改正文。
  - soft 问题只返回 `softHints`（AI 味/文风建议 `chapter-deslop`），不自动修改。
- **入口**：project-action `chapter-diagnose` / `chapter-repair`；助手 `novel_diagnose`（只读）/ `novel_repair`（auto / prescribe）；锁 `chapter:<n>`；提示词 `logicAudit` / `fixIssues`（group review）可覆盖。
- **原则**：逻辑/连续性/事实优先；软指标（文风分、AI 味）按阈值放行，不为满分反复修。

## 问题聚合与处理闭环

大纲与章节的「待处理问题」聚合为一个本地视图，客户端在项目状态里拿到，助手用 `novel_issues` 读取；只提示、不自动处理。

- **来源（纯本地计算，不调模型）**：`outline-audit.json` 的 `issues`（一致性问题/软提示）、`structureIssues`（经 `buildStructureReplan` 归并为 replan 范围）、`staleCount`（过期清理提示）；章节字数低于目标 80%；`chapter_state` 缺失/为空。
- **统一 item**：`id` / `source` / `severity`（error/warn/info）/ `chapter` / `type` / `message`（≤300 字）/ `actions`。
- **问题生命周期**：每条问题有稳定 id（`level|number|type|message` 哈希，即 fingerprint）；`update` 改章节后自动消解该章旧问题（返回 `resolvedIssues`）；`dismiss` 按 `ids` / `chapter` / `all=true` 移除并记入 `dismissed`（≤200，重审同 id 不复活）；审核输出 `issues` ≤30 / `structureIssues` ≤10，超出截断并标记 `truncated`；`novel_issues` 的大纲问题 actions 含 `dismiss`。
- **actions**：`replan`（带 `fromChapter` / `toChapter`，预填批量重生成范围）、`repair`（outline repair）、`audit`（重新审核）、`expand`（重新生成该章正文）、`update-state`（重算人物状态）、`dismiss`（忽略问题，`ids` / `chapter` / `all`）。
- **修复版本化**：`repairOutlineIssues` 先快照 `outlineBefore` / `auditBefore`，修复后复检并按结果分类——**improved**（问题数下降且无新增）：自动应用，写回 outline 与合并后的 audit，存 `status:'applied'` / `autoApplied:true` 版本；**regressed / mixed / audit-unavailable**：当前 outline 与 audit 恢复为修复前一致状态，修复结果存为 `status:'candidate'` 候选版本（含 `outlineBefore` / `outlineAfter` / `auditBefore` / `auditAfter` / `diff` / `summary` / `issuesBefore` / `issuesAfter` / `newIssues` / `fixedIssues`）。版本存 `story/plot/revisions/<id>.json` + `index.json`（保留最近 20 个），`diff` 记录章节/字段改动，`apply-revision` 把 `outlineAfter` 与 `auditAfter` 写回当前并标 applied，`discard-revision` 标 discarded。`outlineGenerate` 自动修复后 `finalAudit = repair.audit`，不被修复前旧 audit 覆盖。
- **排序与上限**：severity（error→warn→info）再按章号；每类上限 8 条（字数/状态各 8；结构 replan 由 `buildStructureReplan` 最多 3 条）；`limit` 默认 20、上限 100，返回 `{ count, items, generatedAt }`。
- **出口**：`project-state.issues`（客户端「待处理」卡片与章节内联提示）、`issues-list`（项目动作，带 `limit`）、助手 `novel_issues`（只读清单，不自动修改）。

## 故事性（诊断式）

故事性问题只诊断、不强制，不要求每章都有冲突/反转/钩子。

- **章纲字段**：每章可选 `change`（本章不可逆变化）、`storyQuestion`（读者想知道什么）、`promise`（推进/兑现的承诺）、`beats`（可选脚手架，不要求每章填）。`OUTLINE` 提示词要求生成这些字段，并明确允许安静章节：不为凑条目硬造冲突/反转/钩子，变化必须由人物动机与信息差推出。
- **诊断**：`STORY_AUDIT_SYSTEM_PROMPT`（group review，可覆盖）输出 `changeHappened` / `questionProgress` / `promiseProgress` / `newQuestion` / `causalChain` / `contrived` / `issues`（无变化 | 因果断裂 | 承诺未推进 | 为冲突而冲突 | 降智 | 巧合解决）。`diagnoseChapter` 增加 `story` 维度（全部 soft、source `story`）与 `scope: all|logic|story`；`logicOnly` 不跑故事；`outlineAudit` 对缺字段给软提示；`repair` 不自动改 story（prescribe `autoFixable:false` / `risk:high`，建议调章纲）。
- **理由**：把「故事是否成立」作为诊断信号，而不是硬性结构模板——强制每章冲突/钩子会催生为冲突而冲突、降智与巧合解决。

## 风格指纹

轻量、纯规则（不调 LLM）的作者风格统计，用于「参考 + 偏离诊断」，不覆盖文风契约。

- **指标**：平均句长、短句比例、对话占比、段落平均句数、修饰/比喻密度（估算）、高频词 Top10。
- **构建**：`buildStyleProfile` 取最近 10 个定稿（`count` 1–30）→ `story/style/profile.json`；`getStyleProfile` 读取。
- **注入**：draft / revise / fix 在文风契约后注入【风格指纹（参考，不覆盖文风契约）】。
- **偏离诊断**：`compareStyleProfile` 按偏差给 low / medium / high（比值 >35% medium、>60% high；对话占比绝对差 >0.15 / 0.25）；`diagnoseChapter` 在 `scope=all` 时增加 `styleDrift`（soft、source `styleProfile`）。
- **入口**：project-action `style-profile-build` / `style-profile-get`；助手 `novel_style action=profile-build|profile-get`；系统提示词 10156（偏差只诊断、契约优先、用 revise 带指标）。

## 参考

`docs/RESEARCH.md` 汇总 novelWriter、Manuskript 等开源工具的结构视图、专注模式、导出、写作统计等做法。项目已吸收专注模式、导出、统计/目标、质检摘要与自动化配置。

## 收尾视觉与适配（v1.8）

- 阅读优先：章节正文使用 14px / 1.95 行高、740px 阅读列，卡片内居中；上一章/下一章可直接切换。
- 段落：点第一段再点另一段选范围；选中后底部固定浮动条「已选 X–Y 段 / 重写选中段落 / 取消」，长距离选择不需要滚回顶部。
- 手动编辑：章节页「编辑正文」进入整章 textarea，保存按钮在编辑区顶部；Ctrl/Cmd+S 保存，旧稿归档，旧质检清空。
- 密度：卡片 16/18px 内边距、14px 间距、16px 圆角；按钮 30px 高、统一 hover 位移；输入 34px 高。
- 层级：顶部栏更轻，步骤标题 24px，正文与辅助文字分开；状态徽标保持小尺寸。
- 响应式：
  - >1180px：三栏完整；
  - ≤1180px：右侧面板默认收起，可用「面板」打开为抽屉；
  - ≤1000px：隐藏“下一步”长文案；
  - ≤900px：显示移动步骤下拉；≤860px 隐藏左侧 rail，工作区改为单列。
- 交互：切换步骤平滑回顶、切换章节重置阅读滚动、专注模式（Esc 退出）、大纲卡片/表格/编辑切换、全局搜索、HTML 导出。
- 仍需注意：窄屏下编辑表单的字段密度、模型分配表格的横向空间、长章节的滚动锚点。
