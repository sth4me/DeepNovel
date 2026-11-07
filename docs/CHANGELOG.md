# 更新记录

## 0.1.26

- **角色规则重构：焦点名单，不是白名单**：角色池（bible）是可用演员表，`volume.cast` 只是本卷重点写谁。已登记角色都可以具名出场，即使不在焦点名单；纯功能路人用身份指代；一次性新名字不要留在正文，预计复用的新名字才登记。`cast` / `extras` / `newCharacters` 从硬配额改为建议值（6 / 3 / 2 左右），硬上限放宽到 12 / 8 / 6；不强制每卷换阵容，连续多卷相同只给软提示。
- **未登记名字降为软提示**：角色池外的新名字不再判 hard、不再自动重试；写入 soft `structureIssues` + `castWarning`，advice 给「会复用则登记 / 一次性改身份指代 / 可保留临时名」三选一。关键转折不再按“核心/龙套”标签限制，改为检查是否有前置铺垫、动机与代价。
- **人物状态/章节上下文按角色池**：`updateChapterState` 不再只保留本卷阵容，角色池内已登记角色都会保留；正文 prompt 增加角色池名单，审核不再把“焦点名单外但已登记”误报为未登记。
- **回归测试**：`test-volume-cast` / `test-character-discipline` / `test-character-state` / `test-outline-quality-checks` / `test-writing-doctrine` / `test-volume-growth` 同步为焦点名单/软提示语义；全套 68 项通过（`test-api.mjs` 需项目路径参数，单独运行）。

## 0.1.25

- **前端状态竞态修复**：`project-state` 加载增加请求序号，迟到的旧响应不再覆盖新状态；文风页在表单有未保存修改时不再被外部 `contract.updatedAt` 重置，并提示「文风已在别处更新，你的未保存修改已保留」。解决“保存成功但界面又变回旧版”的问题。新增 `test-ui-state-guard`。
- **章纲时间锚点改为「开场 + 收束」**：`time` 仍表示本章开场，新增可选 `endDay` / `endPart`；一章可以跨时段（如暮→夜），审核不再因为 synopsis 后半段到了另一个 part 而误报。同场连续戏必须沿用上一章 `endDay/endPart`，不得因为换章就 +1 天；只有明确过夜/赶路/时间跳跃才推进 day。`normalizeChapterTime` 校验 end 不早于 start，`novel_outline action=update` 支持收束字段；大纲生成/审核提示词同步。
- **卷目标自动规划**：第一卷空目标时，先根据已确认构思的开局事件调用 `planVolume` 生成候选并采用候选 1，再生成章纲；规划失败则拒绝生成，不再空目标硬写。新卷（上一卷 `volumeEnd` 后）在内存里完成目标规划，章节生成成功后才随大纲落盘，失败不会留下空卷；卷设置新增目标章数字段，进度块不再把目标章数 0 算成每章都是卷末。新增 `test-auto-volume-goal`，扩充 `test-outline-volume`。
- **能力体系自动维护**：生成设定时若能力体系为空，自动根据构思/角色池/世界规则建立层级与角色当前层级（已有自定义不覆盖）；首次生成章纲前为空也会补建；章节草稿/修订后从正文提取明确的能力变化，追加 `chapterChanges` 并更新角色 `tierName/stage/current`，失败只返回 `powerWarning`。新增 `novel_bible action=power-generate` 与页面「重新生成能力体系」。新增 `test-power-auto`。
- **助手不再自动审稿**：移除「写完或改完章节后的默认流程」——助手按用户指令改完即停，不再自动 `novel_diagnose` / `novel_repair`；只有用户明确要求检查/审稿时才诊断，hard 先报告、是否修复由用户决定，soft 只提示。`novel_diagnose` / `novel_repair` 工具描述同步限定。项目写作要求里的审稿/修复尺度只约束生成与审稿流程，不要求助手每次改完都跑审稿。

## 0.1.24

- **修复修订/预览的 signal 未定义**：`buildRevisionPlan` 之前没有接收 `signal` 参数，但内部已使用它，导致 `revise` / 预览报 `signal is not defined`；现在 `buildRevisionPlan(agent, options, signal)`，`reviseChapter` / `previewRevision` 调用时透传。顺带修复预览中误用未定义 `number`（应为 `plan.number`）。
- **回归测试**：`test-tool-crud` 增加修订预览调用（走 `buildRevisionPlan`），确保这类未定义变量能被捕获。

## 0.1.23

- **中断/取消补齐**：`novel_diagnose` / `novel_repair` 之前没有把 `exec.signal` 传进服务，DSH 停止对它们无效；现在透传并加检查点。`callModel` 改为手动迭代 + 与 abort 竞速，provider 不响应也会立即以 `NOVEL_WRITER_CANCELLED` 退出，不再等整段生成；定稿摘要、约束语义预检也接入取消。任务坞的助手任务可直接取消（0.1.22 已接通锁控制器，本轮补齐工具侧信号）。
- **助手职责与边界**：新增「生成职责边界」与「工作范围边界」提示——大纲/正文内容由生成工具依据上下文决定，助手只给上下文、必须遵守/禁止、用户明确要求；不替生成模型设计剧情；用户主动停止=放弃当前计划，不诊断/补跑；问句只回答不调工具；只通过 `novel_*` 读写项目数据，禁止访问 DSH/插件/数据库，web 保留查资料。
- **update / delete 补齐**：`novel_premise` 增加 `update`（标题/构思/主角/题材/篇幅）与 `delete`；`novel_style` 增加 `update` / `delete` / `delete-template`；`novel_outline` 的 `update` 支持 `agency` / `device` / `castUsed` / `newNamed`，未知字段明确报错，并新增 `delete`（只删章纲，有正文需 `force`）、`volume-update`、`volume-delete`；`novel_cast` 增加 `delete` 与 `extras` 更新；新增 `novel_material`（list/save/delete）。这样修章纲字段不再需要 shell 或直接改数据库。
- **测试与文档**：新增 `test-cancel-signal`（abort 立即退出、信号透传）、`test-tool-crud`（构思/文风/章纲/素材 update/delete）、`test-assistant-generation-boundary`；同步调整 `test-assistant-rhythm`；AI-ASSISTANT 文档补工具动作与中断说明。

## 0.1.22

- **任务坞不再遮挡 AI 对话按钮**：任务坞从视口右下角移到写作台左下角（`.nw-app` 内绝对定位），默认收起为小条、展开向上生长；窄屏改为左侧底部 `bottom:76px` 并限制高度，避开宿主右下角 AI 浮钮。此前只调层级、位置未动，所以仍然遮挡。
- **助手任务可手动取消**：`project-cancel` 现在按「项目 + 资源」中止所有 owner（含助手 `agent:*`），锁记录 `projectRoot`、`activeLocks` 返回项目根；助手工具把 `exec.signal` 与锁 controller 信号合并后执行，取消能传到服务循环与模型调用；任务坞的助手任务行新增「取消」按钮，「全部取消」覆盖助手任务，移除旧的「可在 AI 页停止」提示。新增 `test-task-cancel`（按资源/全部取消、不误伤其它项目、UI 布局断言）。

## 0.1.21

- **写作基础原则（doctrine）**：新增 `writing-doctrine.js`（`WRITING_DOCTRINE` / `CAST_RULES` / `composeWritingSystem`），借鉴 DeepWrite / MuMuAINovel 的提示词工程结构——用户本轮要求优先；注入上下文=方法与长期约束、不是事实；技能=方法、素材=参考，不自动成为本书设定；发现冲突先指出再最小改动；建设链路为「约束与人物 → 核心承诺与故事书脊 → 动态阶段（不写死走向）→ 小节目录 → 正文 → 角色状态」；负向约束（不为凑爽点硬造冲突、不重复同一目标/场景、不偏离类型调性、不靠巧合/降智、不把结构问题当文字修、只写正式内容）。所有写作类 system（构思/设定/大纲/正文/修订/扩写）统一前置 doctrine，助手系统提示词新增「写作基础原则」段。
- **角色池与按卷选角（schema v5）**：`bible_entries` 增加 `meta_json`（角色生命周期：`status` 未登场/活跃/退场、`firstChapter`、`importance`）；bible 是角色池，不是本卷阵容。新增 `planVolumeCast` 按卷选角：核心阵容 `cast` ≤6（承担主线与关键转折）+ 具名龙套 `extras` ≤3（需登记、可反复出现、不得承担关键转折）+ 无名背景不限（身份指代）+ 每卷新增具名角色 ≤2 且必须登记；`CAST_LIMITS = { volumeCast: 6, namedExtrasPerVolume: 3, newNamedPerVolume: 2 }`（当前固定，未开放项目页配置）。大纲与正文只使用「阵容 + 龙套」内的具名角色；新增 `cast-list` / `cast-plan` / `cast-update` 与助手工具 `novel_cast`，结果写 `volume.cast` / `volume.extras`。
- **状态驱动**：新增 `CHARACTER_STATE` 提示词与 `chapter_state` 人物状态快照（scene / characters：处境、欲望、恐惧、知情、关系、物品、伤势、未解冲突、接续点 / summary）；正文生成注入上一章状态与本卷阵容，允许按角色性格与当前局势偏离章纲的 `change`；写完自动更新状态（失败不阻塞，返回 `stateWarning`）；新增 `chapter-state` / `chapter-state-update` 与助手工具 `novel_state`。
- **结构问题分流**：大纲审核输出 `issues`（一致性）+ `structureIssues`（角色超载 / 桥段重复 / 主角被动 / 承诺未推进 / 调性漂移 / 因果薄弱 / 黄金三章 / 未登记角色）；结构问题只给 `replan`（按章号聚合 1–3 个重规划范围），`structure-only` 不调用修复模型、不进入 `outline-repair`；章节诊断新增 `suggestedAction`（repair / revise / ignore）。大纲审核按 ≤12 章分块，单块失败记 `chunkErrors`、不阻塞其它块。
- **修复循环收敛与过期清理**：`outline-repair` 修复后强制复检，问题变多/不降/复检失败即回滚快照；同一问题指纹累计尝试 ≥2 次标记 `exhausted`；单次最多 6 章；写 `.dsh-writing/repair.log`；生成大纲内最多 1 轮自动修复。审核问题引用已删除章节时自动清理（`stale-audit`，不调模型），删除章节/卷后同步清理。
- **文风模板升级**：9 个内置文风模板改为专业档案（叙述视角 / 句法节奏 / 对白 / 描写与感官 / 情绪呈现 / 用词 / 节奏 / 章节形态 / 2 段原创风格锚点 / 5 条自检 / 3–5 条反例），锚点随文风契约进入章节提示词；`STYLE_CONTRACT` 按维度要求可执行字段，`STYLE_AUDIT` 输出 8 维评分与建议。
- **字数、黄金三章与钩子**：正文目标取 `style.chapterWords` / 章纲 `wordBudget`（默认 3000），下限 80%；不足自动扩写（最多 2 次，不改变情节/顺序/关系/结局、不新增命名角色），返回 `wordCount` / `wordTarget` / `expanded` / `wordCountWarning`；大纲审核增加黄金三章判定（第 1 章欲望/麻烦+具体钩子、第 2 章冲突/承诺升级、第 3 章小胜利/阶段兑现）；故事审校增加 `endingHook`（类型/强度/新问题），第 1 章弱钩子报 soft。
- **角色纪律**：正文只能使用本卷可具名角色（阵容+龙套）；路人/摊贩/护院/伙计一律不给姓名、用身份指代；需要固定配角先登记；「未登记角色」映射为 hard 一致性问题（advice：改身份指代或先 `novel_cast` 登记）。
- **选角校验与质量检查（修订版，诊断优先）**：章纲生成后确定性校验 `castUsed` / `newNamed`，章级泄漏不自动重生成，违规写 `structureIssues` 并进 replan，仅「顶层 `newNamed` 泄漏且无章级违规」重试一次；主角主动性按弧段诊断（每 2–4 章至少一次有代价的主动选择，连续 3 章以上被动 → 结构问题，给范围）；桥段重复按「无升级才算」诊断（不计数、不自动重试）。
- **token 策略**：模型调用默认不传 `maxTokens`（使用模型最大值），不再设 budgetCap、不再因预算不足加倍重试；仅显式参数或项目 `automation.maxTokens` 可限制。
- **问题聚合与处理闭环**：新增 `issuesSummary`（纯本地、不调模型）聚合大纲审核一致性问题/结构问题（含 replan 范围）/过期问题、章节字数不足（<80%）、人物状态未更新，统一为 `items{source,severity,chapter,type,message,actions}`；`project-action issues-list` 与 `project-state.issues`；助手工具 `novel_issues`（只提示不修改），系统提示词要求每次大纲/诊断/修复/章节工具返回后，在回复开头用 1–3 行摘要列出待处理项；大纲页「待处理（N）」紧凑卡片（最多 3 条 + 一键动作，超过用 modal 看全部），章节页仅当前章显示字数/状态内联提示与动作按钮。
- **大纲问题清理**：`novel_outline action=update` 修改章纲后自动清除该章旧审核问题（返回 `resolvedIssues`）；审核问题增加稳定 `id` 与 `dismissed` 记录，`outline-dismiss` / `novel_outline action=dismiss` 可按 id / 章号 / 全部忽略，重审不会复活已忽略问题；单次审核输出上限 issues ≤30、structureIssues ≤10（超出截断并 warning）；助手与客户端均有「忽略」入口。
- **助手交互节奏**：新增「一次一步」系统提示词（order 10090）——每轮只做用户明确要求的一步，完成后停下汇报可选项；不自动进入下一阶段（构思→设定→大纲→正文→审校→修订→定稿）；仅用户明确要求连续/批量或工具链式必须（如 read→patch）才继续；任何确认/commit 后必须停；工具内部联动不重复调用。`novel_outline` 新增 `action=update`（chapterId/number + title/synopsis/change/storyQuestion/promise/beats/wordBudget），大纲局部问题优先改 1–3 章，只有连续 ≥3 章结构问题/整卷崩/用户明确要求才 generate/regenerate；`novel_bible` commit 后停，`novel_issues` 建议优先 update。
- **大纲推进（上下文优先级，不新增路线图数据）**：大纲生成 user prompt 把「本卷目标 + 本章位置/剩余章数」提到最高优先级块（纯本地按卷目标/目标章数与章号计算），明确「由角色与局势推进、允许转场/跳时间、同一目标/地点连续 >2 章无新信息视为停滞、不得用遇新人/新事件替代主线、支线须写被迫或主动选择且 2 章内脱身、目标事件必须真实发生」；【上一章落点】改为「承接≠原地续写」；OUTLINE_AUDIT 增加「主线停滞」「支线挤占」「非叙事标记/场记式开头」。
- **卷目标状态驱动**：`planVolume` 注入上一卷末 3 章 `chapter_state`、末章正文结尾/摘要、未解冲突与角色池，输出 2–3 个候选卷目标（`goal/whyNow/cost/risk/exitCriteria`，goal 为当前局势下必须解决的开放问题、不是事件顺序）；默认只返回候选不写盘，`selectVolumePlan` / `volume-select` 选定或显式修订并记录 `whyNow/goalRevisedAt`；新卷自动兜底选候选 1 时明确 warning。
- **通用叙事格式规则**：去掉特例式「禁止 D1/D2」，统一为「synopsis 必须是叙事句，不得用场记式/编号式/标签式标记表示时间或场景（字母+数字、DayN、时间码、方括号场景标签、『时间，地点。』清单式开头）」；审核按通用特征检测，不点名具体代号。
- **章纲隐藏时间锚点**：章纲新增可选 `time{day, part, spanDays, mode}`（day 相对本卷开场、0 起，可 null；mode linear/flashback/parallel），只存章纲 JSON、不写进 synopsis、不展示给读者；大纲生成注入最近 8 章时间线、上一章锚点与硬事实/期限换算，要求线性章 day 不倒退、flashback/parallel 不参与线性；审核据此报「时间线冲突」（相邻 linear 章 day 倒退、同日 part 倒退、synopsis 与锚点矛盾），无锚点不误报；`novel_outline action=update` 支持修正 `time`。
- **卷收束与新卷角色轮换**：大纲 prompt 改为「分卷收束硬规则」——本章真正达成卷目标/离卷条件时必须输出 `volumeEnd:true`（全卷唯一，未达成不标）；无收束且本卷章数 ≥ target+2 时返回 `volumeEndOverdue` 警告，不自动标；新增 `outline-volume-end` / `novel_outline action=volume-end` 显式收束（默认末章，设且仅设一章）。`planVolumeCast` 注入上一卷阵容与未使用角色池，要求新卷阵容与上一卷有可感知差异（至少 1 个上一卷没进阵容的角色：优先未使用池，其次新增 ≤2；或 `noNewCastReason` 说明），返回 `newFaces/noNewCastReason/castWarning`；OUTLINE_AUDIT 增加「阵容未更新」结构问题。
- **项目写作要求**：删除「插入项目要求 / 复制要求」两个按钮（要求本就会自动注入，复制进生成框会造成重复稀释）；写作要求块前置到生成 prompt 的任务/额外要求之后、构思/文风/故事背景之前，并标明「用户长期设定，优先级高于文风契约/设定/章纲」与冲突规则；约束优先级调整为 `explicit > facts > requirements > bible > outline > style > notes`；写作要求卡增加未保存提示与失焦自动保存；勾选阶段扩展为「设定 / 大纲 / 草稿 / 修订（含修复/扩写/去AI味）」，勾选即时保存；`fix/expand/deslop` 统一映射到修订阶段，扩写提示词补写作要求与硬约束。
- **大纲修复回滚诊断一致性**：`repairOutlineIssues` 入口保存 `auditBefore`；回滚（regressed / audit-unavailable）时恢复大纲并**写回修复前 audit**，附 `lastRepair{reason,rolledBack,attempted,attemptedCount,newIssues,issuesBefore/After,runId}`，不再让审核文件停留在修复后版本；成功时合并「范围外旧问题 + 范围内新结果」；`outlineGenerate` 自动流程改用 `finalAudit = repair.audit`，修复成功/回滚后不再被修复前旧 audit 覆盖，返回 `audit` 供助手直接定位；助手在 rolledBack 时按返回 audit 给出 update/重规划建议，不再盲目重复 repair。
- **大纲修复版本化（替代回滚）**：`outline-repair` 不再因复检变差而直接回滚丢弃结果，改为在 `story/plot/revisions/` 保存版本（保留最近 20 个），含 before/after、逐章 diff、前后 audit、问题变化与原因。**仅「问题数下降且无新增问题」自动应用**；变差/混合/审核不可用时保留候选、不覆盖当前大纲，audit 始终与当前生效大纲一致。新增 `novel_outline action=revisions/revision/apply-revision/discard-revision` 与对应 project-action；repair 返回 `applied/status/versionId/diff/summary/audit/candidateAudit`；助手在 candidate 时提示 versionId、问题 X→Y、新增 N，并让用户选择应用/丢弃/按 diff 用 update 手动改，不再反复 repair；客户端 toast 同步改为「已自动应用 / 已保存候选」。
- **测试与文档**：新增 `test-writing-doctrine`、`test-volume-cast`、`test-character-state`、`test-structure-audit`、`test-word-budget`、`test-character-discipline`、`test-outline-quality-checks`、`test-outline-repair-guard`、`test-issues`、`test-assistant-rhythm`、`test-outline-dismiss`、`test-outline-prompt`、`test-volume-goal`、`test-chapter-time`、`test-volume-growth`、`test-writing-notes`、`test-writing-notes-tasks`、`test-outline-repair-audit`、`test-outline-repairs` 等；README 与 DESIGN / AI-ASSISTANT / DATA-LAYER / STORY-LAYOUT / UI / CUSTOMIZATION / VERIFICATION / CONTEXT 同步。

## 0.1.20

- **约束引擎**：新增七层优先级（本轮对话/显式指令 > 硬事实/术语/安全 > 设定 > 章纲 > 文风契约 > 写作要求 > 备注）；生成前做结构化冲突检测（人称/时态、句长、对话比例、称呼/术语、章纲 vs 设定状态、伏笔状态）与可选语义预检，冲突按优先级裁决、不交给模型折中；`HARD_RULES`（≤12 条）在提示词开头完整 + 结尾复述双注入；不删原有上下文块、不做 token 瘦身。
- **事实包**：数据层 schema v4 新增 `facts` 表（术语/硬事实/安全/称呼，全局或按章，must 表示生成时必须遵守）；生成前注入硬约束，生成后 `validateAgainstFacts` 可查违规；project-action `facts-list` / `fact-save` / `fact-delete`，锁资源 `facts`。
- **助手工具**：新增 `novel_facts`（list/save/delete）与 `novel_constraints`（check：hardRules/conflicts/warnings，只读不生成）；系统提示词补充「约束优先级」段（explicit 最高、不折中、设定/章纲冲突提示同步）。
- **诊断与定向修复**：新增 `novel_diagnose`（facts 违规、逻辑/因果/时间/空间/信息差/动机/能力/设定、连续性、文风/AI 味，hard/soft 分级）与 `novel_repair`（auto 只修 hard 的最小 diff、唯一匹配、备份、复检、不降或新增 >2 回滚、≤2 轮；prescribe 只出处方）；soft 指标按阈值放行、只提示；提示词 `logicAudit` / `fixIssues` 可覆盖。
- **故事性（诊断式，不强制）**：章纲新增可选 `change` / `storyQuestion` / `promise` / `beats`（beats 仅为可选脚手架）；新增 `storyAudit` 检测「无变化 / 因果断裂 / 承诺未推进 / 为冲突而冲突 / 降智 / 巧合解决」，全部 soft、只诊断不硬改；允许安静章节，不要求每场冲突或章末钩子；`novel_diagnose` 支持 `scope: all|logic|story`。
- **风格指纹**：从最近定稿章节统计平均句长、短句比例、对话占比、段落句数、修饰密度、高频词 Top10（`story/style/profile.json`）；生成时在文风契约后注入数字摘要（参考、不覆盖契约），诊断时报告 `styleDrift`（soft）；`novel_style profile-build/profile-get`。
- **修复空卷**：生成当前卷不再提前创建空卷（只记 `pendingNextVolume`）；真正生成下一卷（起始章进入新卷）时才创建并挂章节；写盘前清理末尾遗留空卷；`volume-create` 显式建卷不受影响。
- **简化**：删除旧技法卡 `craft-card-*` 接口与用户自定义技法卡读写；`novel_craft` 仅兼容列出内置技法，自定义统一用导入技能；约束/事实/诊断逻辑各收拢到一处。
- **打包**：`package.json` 的 `files` 补入 `constraints.js`、`style-profile.js`，`npm pack` 包含全部运行模块。

## 0.1.19

- **修复安装缺模块**：`package.json` 的 `files` 白名单补上 `writing-rules.js` 与 `builtin-skills.js`（0.1.17/0.1.18 从 npm 安装时这两个模块未被打包，导致启动报缺失）。`npm pack` 现已包含全部运行模块。

## 0.1.18

- **修订学习**：项目页「写作要求（共享）」卡新增「从修订学习」——分析草稿→定稿差异（最近 3/5/6 章或指定章号），提炼稳定写作偏好（同类修改 ≥2 次、规则可执行、最多 8 条），勾选后追加到写作要求；只读分析、不自动改写正文、不新增数据表。提示词 `revisionLearn` 可覆盖；助手 `novel_chapter action=revision-learn` 只返回建议。
- **界面精简与信息架构**：删除已停用的旧技法卡组件（`CraftLibraryCard`）及其接口调用；项目页按「项目 / 概览 / 写作配置 / 运行与数据」分组重排，长页面更易扫读；**章节/文章的多行（批量）操作全部保留**，仅让批量按钮区在窄屏自动换行。

## 0.1.17

- **提示词与技能整合优化**：两层语义保持分离——「流程提示词」（System 模板：任务必用、可覆盖、有版本、可预览）与「技能」（`craft-*` / `ref-*` / 导入：可选参考、模型按需读取并判断适配性、可开关/导入/删除），数据模型不合并；管理入口合并为项目页「提示词与技能」双 tab 卡（素材库仍独立）。
- **规则单一来源**：新增 `writing-rules.js`，集中维护 35 个 AI 禁用词、AI 句式、真人写作基准、章节质检清单与去 AI 味规则文本；流程提示词、`craft-deslop` / `ref-quality` 技能与 AI 味估算全部引用同一来源，消除原先三份重复拷贝与漂移风险。

## 0.1.16

- **参考内容库（内置技能）**：新增 5 个内置参考技能 `ref-hooks`（钩子库：章首 7 类/章尾 10 类）、`ref-openings`（开篇库：7 种建立方式 + 适用题材 + 反例）、`ref-reversals`（反转工具箱：7 类反转的铺垫/回收/常见失败）、`ref-emotional-arc`（情绪弧线：单章曲线/跨章节奏/外化清单）、`ref-quality`（章节质检清单：结构/信息/场景/语言/连载）；与 9 张技法卡同属内置技能（不可删除、按项目开关），AI 按需读取并判断适配性。内容自写（参考 MuMuAINovel / DeepWrite 思路，未大段复制）。
- **提示词模板分类与预览**：System 模板按阶段分组（构思/设定/大纲/正文/审校/技法/数据/其他），每条可预览默认/当前生效文本、覆盖状态、版本与 `{{name}}` / `${name}` 占位符（只读，不调模型）；不新建页面，整合进现有 System 模板卡。
- **素材库**：新增 `materials` 表（schema v3，旧库自动升级）与项目页「素材库」卡——参考片段/资料/桥段/引用，按类型与标签管理，可增删改查；导出纯文件项目写 `story/materials.json`；助手通过 `novel_query kind=materials` 按需查询，不自动注入提示词。

## 0.1.15

- **写作助手接入外部能力**：预设挂载 skill（项目级 `.dsh/skills/`、`.agents/skills/`、用户级 `DSH_HOME/skills`，格式 `<name>/SKILL.md` 或 `<name>.md`），助手按需加载；同时预留 MCP 接入位（默认关闭，填服务器配置后可用 `mcp__<serverName>__<tool>`）。
- **去 AI 味**：文风审查显式识别 AI 指纹（一级禁用词、AI 句式、章末升华、段落均匀、抽象情绪直述等），输出 `aiFlavor` 等级/分数/命中标记；新增「去 AI 味」改写（章节页按钮或 `novel_chapter action=deslop`：只改表达不改剧情、先预览后应用、修订备份、长度 ±30% 校验、清过期质检、重建索引）；写作/修订提示词自动注入去 AI 味规则（技法卡片）。
- **AI 页新增「压缩上下文」入口**：等价 DSH 的 `/compact`（内嵌对话 UI 不提示命令），对写作台隐藏子代理执行压缩，提示已压缩条数与 tokens；对话太短时提示暂不需要压缩，会话生成中提示稍后再试。自动压缩仍由 DSH `compaction-basic` 默认开启（约 80% 压力触发），两者互不影响。
- **写作助手支持碎片化改正文**：新增 `novel_chapter action=patch`（number/target/find/replace/all/note），只替换正文片段、不调用模型、自动写修订备份、更新章节状态与字数、清过期质检、重建检索索引；模型输出受限或被服务端审查中断时可小步修改，不必整章重生成。
- **工具报错不再中断对话**：所有小说工具出错改为返回 `{ ok:false, error, hint }` 并给出下一步建议；系统提示词补「数据层规则」与「中断恢复策略」（被拦截时不要反复重试同一段生成，连续两次被拦截提示换模型或拆小改动）。
- **助手查询面补齐**：`novel_query` 扩到 13 类（章节/章纲/设定/状态/摘要/统计/运行记录/人物关系/能力体系/灵感/拆书/提示词覆盖/构思对话），支持 keyword/limit，拆书默认只回摘要+计数、需要时按条取全文；`novel_bible` 增加关系与能力体系的读写 action，助手可自查修复坏关系与境界/战力矛盾。
- **助手上下文预算**：工具输出不再全量返回——章节列表支持分页/过滤（默认 30 条、带 total/nextOffset），正文读取支持 `maxChars`/`range` 分块（默认 6000 字符、带 truncated/nextRange），新增 `novel_chapter action=search` 在 patch 前定位原文；章纲查询默认只回卷列表，按需展开（默认 20 条）。预算按字符而非 token（目的是结果完整可读，不是省 token），工具输出控制在 DSH 默认裁剪线（8192 字符）以内；会话压缩沿用 DSH 默认比例（约 80% 触发、保留 16% 原文尾部），不覆盖。
- **助手与界面共用资源锁**：写作助手工具现在占用与界面相同的资源锁（章节/批量章节/大纲/设定/文风/构思/全项目），资源忙时返回结构化提示且不执行；修复「删章重排只锁单章」「导出/快照/恢复不与写互斥」等粒度问题；界面任务托盘显示「写作助手 · 第 N 章」等占用，冲突按钮自动禁用并提示。
- **外部改正文后自动标记**：写作助手/编辑器直接改 `draft.md`/`final.md` 后，自动重建索引与字数，并把该章标记为手动修改（定稿改动标为待复核，健康页提示）。
- **数据层切换为混合方案**：结构化数据（项目/构思/文风/设定/关系/能力/卷与章纲/章节状态与摘要/统计/运行记录/提示词覆盖）改存 `story/project.db`（SQLite，DSH 内置 `node:sqlite`，WAL + 外键 + 事务）；正文仍保留 Markdown 文件（`chapters/NNN/draft.md`、`final.md`、`revisions/`），可读、可 git、可外部编辑。
- **旧项目自动迁移**：打开「有 `story/project.json`、无 `project.db`」的旧项目时一次性导入（逐文件容错、整体事务、失败回滚），旧 JSON 保留为只读存档。
- **页面数据大幅提速**：300 章项目 `project-state` 从约 2 秒降到 10–20 毫秒；写作台打开、自动刷新、切页不再卡。
- **中文全文检索**：FTS5（trigram）索引正文/章纲/设定/摘要，3 字以上带命中片段高亮与 bm25 排序，1–2 字用 LIKE 兜底；搜索结果按类型（章节/章纲/设定/摘要）显示并可点击跳转。
- **外部改正文自动同步**：写作助手或外部编辑器直接改 `draft.md`/`final.md` 后，自动重建该章检索索引并校正字数（Electron 用 `fs.watch`，其它环境轮询兜底，均带 800ms 去抖），搜索与数据健康不会落后。
- **正文存在性入库（schema v2）**：`chapter_meta` 记录 `has_draft`/`has_final`，旧库自动 `ALTER TABLE` 升级；300 章项目冷启动不再递归扫描章节目录（冷启动 16ms、稳态 8–10ms）。
- **多窗口并发**：WAL + `busy_timeout` + busy/locked 有界重试；两个独立进程同时写不同章节已验证安全，同一章并发为「最后写入者生效」；导入与所有写动作互斥。
- **纯文件项目互逆**：支持「导入纯文件项目」（先自动备份 `story/` 到 `.dsh-writing/backups/import-<stamp>/`，再覆盖 + 迁移 + 重建索引，失败自动恢复）。
- **多步写操作事务化**：删除章节（含中间章删除重排）、批量定稿等改为事务提交，中途失败回滚、不留半套数据；大批量操作后自动 checkpoint WAL。
- 项目页新增「数据层」卡片：数据库与 WAL 体积、索引条数、schema 版本，可「重建检索索引」「导出 / 导入纯文件项目」。
- 快照/恢复改为先 checkpoint WAL 再复制，恢复后自动重开数据库；写作助手新增只读 `novel_query` 工具用于核对数据。
- **写作技法改为内置技能（与导入技能平级）**：9 张通用技法卡片（场景推进 / 对白 / 节奏 / 情绪外化 / 伏笔 / 打斗 / 开篇 / 转场 / 去 AI 味）以 `craft-*` 内置技能形式进入技能目录，随插件提供、**不可删除、可按项目开关**；导入技能分项目级（`<projectRoot>/.dsh/skills`、`.agents/skills`，可删除）与全局/插件级（`DSH_HOME/novel-writer/library/skills/`，跨写作项目可用、可删除），优先级 项目 > 全局 > 内置，同名覆盖先备份。助手**只使用内置 + 项目/全局导入技能，不加载 DSH 公共 / 系统 / 用户级技能**（预设已移除 `skill-filesystem`，由内置 provider 按项目 cwd 动态提供）。**不再由程序按任务打分自动注入**，改由 AI 按需用 skill 工具读取全文，并自行判断是否适合本章（题材/文风契约/节奏/指令），不适合就不套用。项目页「技能库」可预览、开关内置、导入（项目/全局）/删除导入技能；`novel_craft` 工具保留兼容。
- 拆书升级为三阶段流水线：结构编年（分段单元与剧情功能）、人物与设定（角色/地点/规则/势力/物品/关系）、技法与钩子（可复用桥段、写法、节奏观察）；单阶段失败不影响其余结果，结果按分区展示并标出失败阶段，历史记录也保留阶段状态。
- 新增跨项目角色库：设定页角色卡可「存入库」，其他项目在「角色库」区块一键导入或合并（同名合并、写入设定走设定锁）；库存放在 `DSH_HOME/novel-writer/library/characters/`，不进项目目录。
- System 模板支持版本化：内置提示词带 `revision`，用户覆盖记录所基于的版本；插件升级默认后提示「默认已更新」，未真正改过的覆盖自动跟进新版，改过的保留并可一键「改用新版默认」。
- 内置文风模板重做：9 个模板（快节奏网文 / 文学向 / 悬疑冷硬 / 轻松日常 / 古风仙侠 / 古风言情 / 冷硬江湖 / 科幻硬核 / 都市现实），每个模板从「几个字段 + 一句要求」升级为结构化字段（叙述声音、用词偏好、意象、感官侧重、对白写法、节奏）+ 三档可执行规则（必须贯彻 / 绝对禁止 / 按场景调节）+ 禁用词与禁用句式 + 适用/不适用题材 + 2–3 段示例段落；规则写成可判定条目，不再用空泛形容词。
- 文风契约改为可读文本注入生成与审校提示词（原先塞 JSON），并新增「违反契约」审校项；文风页按分组编辑字段，模板卡片显示分组、题材标签与示例段数量。
- 移除「讨论」功能：讨论面板、讨论路由、讨论提示词、讨论应用历史与讨论结果写入的「待用修订要求」全部删除；写作台 AI 页的内嵌对话已覆盖讨论与改稿场景。
- 移除旧的「小说助手」悬浮面板及其 Host 后端（已被写作台 AI 页取代）。
- 写作台 AI 页：章节数据维护工具补齐，支持删除章节、删除中间章纲并让后续章号前移、把章纲移到别的卷；遇到章节挂错卷、章号重复或缺口时自行修复，不再要求用户指挥。
- 写作台 AI 页：对话内嵌视图补上「对话 / 轨迹」切换，点工具卡片的「查看」后可切回对话。
- 写作台 AI 页：对话子代理启用上下文压缩（compaction、命令压缩、工具结果裁剪）。
- 写作台：写作助手改完文件后自动刷新页面数据（大纲、卷、章节、正文），不用切走再切回来；Host 侧改为监听项目 `story/` 目录，长篇项目也几乎零开销，正文内容改动同样能感知；刷新按钮显示同步状态（`…` / `✓`），切回前台时立即补一次同步。
- 修复写作台顶部栏与主题下拉被右侧面板遮挡。

## 0.1.14

- 写作台「AI」页改为内嵌 DSH 官方对话界面：每个小说项目一个隐藏父会话 + continuable 子代理，会话不出现在侧栏；复用 DSH 的模型、工具、审批与上下文压缩。
- 打开写作台或重启 DSH 后自动恢复隐藏父会话，对话可继续；对话内容持久化，重启后历史仍在。
- 新增「新对话」与「摘要接力」：可重建对话以使用当前默认模型/思考等级；可先让模型把上一段对话压成摘要，确认或编辑后注入新对话继续。
- AI 页按写作台场景收敛 UI：隐藏权限下拉、附件上传与「在新对话中分支」，输入框提示改为写作助手文案，输入框与统计带跟随主题层级色。
- 修复写作台顶部栏与主题下拉被右侧面板遮挡。
- 移除旧的 assistant live.json / agentLoop 创建尝试（不再使用）。

## 0.1.13

- 小说助手增强阅读能力：上下文带上分卷信息、完整角色设定、文风契约；指令提到“第N章”时自动读该章正文，另附最近两章开头供讨论；明确要求不编造未提供的内容。


## 0.1.12

- 小说助手支持思考内容：捕获各提供方的思考流（reasoning/thinking），存运行账本并在对话里以“思考”折叠展示；系统提示要求中文思考与回复。
- 思考捕获对 DeepSeek 与其他模型通用，不影响正文生成。


## 0.1.11

- 小说助手界面重做：更大面板（默认 540px/76vh，可展开到 960px/88vh）、多行输入框（Enter 发送、Shift+Enter 换行）、消息区自适应撑满、计划动作分行显示。


## 0.1.10

- 小说助手增强：变更计划显示改前/改后，执行后显示已改处数并可一键撤销（自动备份章纲/设定/正文）。
- 助手支持正文编辑：按指令改写指定章正文（自动备份旧稿）。
- 助手支持生成联动：可直接在对话里生成大纲。


## 0.1.9

- 新增小说助手对话窗口：右下角浮窗，可讨论、提意见、让它改章；讨论不动文件，改章先给变更计划再执行。
- 助手直接读写本小说项目（章纲/设定/写作要求），只限当前项目；对话线程存在 story/assistant/thread.json。



## 0.1.8

- 推进讨论流程：澄清 / 提案 / 逐项确认 / 执行；支持关联目标、本线程自动确认与上下文隔离。
- 提示词目录扩展到全部内置 system 提示词，支持单条保存、恢复默认、导出/导入。
- 正文草稿、修订和修复不再固定 9000/5000 输出上限，改为由模型实际上限截断。
- 分卷增加舞台计划：可生成/自动补全地图、卷目标、战力天花板和离卷条件。
- 当前卷最后一章标记阶段收束后，下一次生成自动进入下一卷。
- 大纲页禁用提示改为准确列出未确认的阶段，不再笼统写“构思与文风”。

## 0.1.7

- 章纲 synopsis 改为结构化写法：写清时间/地点、谁要做什么、起因与冲突推进、结果、结尾状态、下一章钩子；文风契约与 notes 只约束正文，不再把 synopsis 写成半文半白。
- 分卷按“阶段收束”标记：模型在阶段收束章标 `volumeEnd`，服务端据此自动开启下一卷；不再按章数硬性分卷，章数只作参考。
- 章节/大纲列表在切换时自动把当前章滚动到可视区中间，不再回到列表顶部；跨页跳转时把工作台滚到视口。
- 大纲生成支持缺章自动补齐：先整批重试一次，仍缺则按缺失章逐章补生成。
- 模型调用不再改动用户设置的思考等级；输出预算按模型默认上限给足（不再用公式压缩），截断时保持原思考等级加倍重试。
- 模型调用附带稳定的 sessionId，兼容 opencode / opencode-go 等需要会话头的提供方。
- 新增 `scripts/backfill-synopsis.mjs`：把旧版章纲字段总结为 synopsis（默认预览，`--apply` 写盘并备份）。

## 0.1.6

- 提示词目录支持单条保存、恢复默认、默认/覆盖状态、hash 与导出/导入。
- 设定生成拆分为“只生成角色”和“只生成世界”，保留另一部分已有条目。
- 大纲新增“从正文反推章纲”，按正文写 synopsis，不新增正文没有的事件。
- 章节顶部操作栏改为多行完整展示，不再折叠为“更多”。

## 0.1.5

- 构思卡改为 `title + premise`：标题与 2–4 句话核心故事分开，不再使用 logline/开场事件。
- 构思生成前先从对话提炼稳定意图摘要，再交给候选生成；不再逐字执行最后一句话。
- 构思候选移除 hook/audience/boundaries/risks/conflict/antagonist/ending 等附加字段，也不再兼容旧字段。
- 文风“保存为模板”改为保存当前编辑中的字段与示例；自定义模板列表与套用恢复正常。
- 修复大纲与正文互跳时的焦点闪烁：按章跳转时固定到对应章节，不再被旧选中值覆盖。

## 0.1.4

- 删除未使用的旧版大纲/章节面板与旧字段编辑代码。
- 文档不再保留旧章纲字段兼容说明。

## 0.1.3

- 不再兼容旧章纲字段：只保留 title/synopsis/wordBudget，更新接口也只接受这三个字段。
- 上下文、角色索引、摘要回退、审校与状态快照全部改用 synopsis，不再读取旧的 goal/conflict/turn/outcome/hook。
- 生成章纲时强制带上一章的计划梗概、已写摘要和正文结尾，要求下一章从该落点继续。

## 0.1.2

- 章纲讨论允许修改的字段同步为 title/synopsis/wordBudget。
- 文档同步单字段章纲结构。
- 章纲卡片不再显示旧的时间元信息。

## 0.1.1

- 章纲除序号、标题、字数外只保留一个内容字段 `synopsis`，用于描述本章实际发生什么。
- 章纲提示词要求每章梗概结尾落在下一章可直接承接的具体状态；生成下一章时带上上一章的计划梗概、已写摘要和正文结尾。
- 移除章纲必填的 hook/beats/cast/place/time/目标/冲突/转折/结果字段；旧章纲继续兼容读取。
- 文风模板去掉剧情结构关键词，只保留语感、句长、对白、意象与节奏描述。

## 0.1.0

- 公开仓库重置为 0.1.0，清理历史版本记录。
- 保留当前写作台能力：构思对话、分卷章纲、正文写作、审校修复、上下文管理、任务队列、项目快照与导出。
- 章纲以剧情梗概为核心，不再强制拆分目标/冲突/转折/结果。
- 构思对话区分讨论与生成，讨论不会自动覆盖候选。
- 通用提示词不内置特定题材的禁止项或套路清单。





