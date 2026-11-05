# 验证记录

验证使用一个**临时小说项目**，不进入本仓库；本仓库只保留插件和文档。

## 插件加载

- Host 插件、Client 插件、bundle patch、预设均可安装启用。
- 写作台主面板注册为 `novel-writer-desk`；侧栏入口、`main` 面板均为 active。
- Client HMR 可在修改 `client.js` 后热替换，无需重启桌面应用。

## 项目与会话解耦

- 通过项目根直接调用 `project-state`、`project-action`、`project-chapter` 等路由；不要求 Session。
- 旧 session 路由保留兼容。
- 项目目录记忆在 localStorage，可切换项目。

## 流程

实测通过：

- 初始化项目，生成/确认构思。
- 套用/修改文风，确认契约。
- 生成/编辑/确认设定（角色、地点、规则、势力、物品）。
- 生成/重生成/编辑/确认章纲。
- 生成草稿、规则 QA、AI 风格审稿。
- 单轮/多轮修复，保留最佳版本与字数护栏，标记 `needs-review`。
- 修订历史 diff、恢复版本。
- 段落点选局部重写。
- 整章手动编辑保存，归档旧稿并清空旧 QA。
- 定稿并写状态快照。
- 连续写章、下一章。
- 章节操作条滚动固定、鼠标选段开关默认关闭（界面确认）。
- 并行任务托盘、单项取消/重试、真实阶段显示（实现完成，待 Host 重载后实际并任务复测）。
- 局部重写预览不写盘、应用后写修订、撤销恢复（预览/应用服务路径测试）。
- 质检问题段落定位、章节滚动位置记忆、快捷键（实现完成，待界面复测）。
- 章节摘要生成：服务路径测试，摘要写入 `chapter_summary` 表并同步章节状态。
- 连续性检查：临时项目验证摘要缺失、角色未入设定、伏笔逾期等确定性检查。
- 多卷：创建卷、移动章节、向第二卷生成章纲并保留第一卷。
- 项目快照：创建、列表、恢复；恢复前自动 pre-restore 备份。
- 批量写章暂停：任务托盘暂停请求 + 当前章后停止（服务路径验证）。
- 局部重写逐块接受/拒绝：前端按 diff hunk 重建文本，服务端仍只接收最终全文。
- 摘要检索：按当前章纲关键词从历史摘要中挑选相关摘要进入上下文。
- 任务排队：同资源冲突自动进入客户端队列，任务结束后自动执行；可移除排队项。
- EPUB 导出：临时项目生成合法 zip，包含 mimetype/container/content.opf/nav/ncx/各章 XHTML。
- DOCX 导出：临时项目生成 docx，python-docx 可读取；含 Heading1/Title 样式和 TOC 域。
- 章节操作去重：写作动作与质检修复只保留在固定操作条/「更多」，正文区不重复。
- 大纲生成要求：生成后 3/6 章、批量重生成、单章重生成都把输入框内容传给 prompt；prompt 将额外要求放在前面并声明优先。
- 自动大纲修复只改 outline 字段，不自动改正文；修复 prompt 同时带上用户本次额外要求。
- 能力体系：`story/project.db` 的 `power` 表可读写；章节上下文包含当前角色层级、本章变化、最近三章变化；大纲生成/审校 prompt 包含能力体系并检查无铺垫跨级。
- 能力面板：层级/角色/按章变化可编辑保存；章节页展示本章能力变化。
- 移动端：章节操作条横向滚动，避免换行挤占阅读区。
- 上下文预览与预算配置。
- 按任务模型/思考等级配置（正文 off、审稿 low、其余继承）。
- 提示词注入：项目级/全局级保存与回读，注入后 system 叠加顺序、任务过滤、JSON 修复排除（`scripts/test-prompt-injection.mjs`、`scripts/test-prompt-service.mjs`）。
- 资源级并发锁：章节按章号、大纲/设定/构思/文风分锁，无锁动作不被阻塞（`scripts/test-run-resource.mjs`）。
- Markdown / HTML 导出。
- 全局搜索、写作统计、故事时间线/伏笔概览。
- 自定义模板保存/删除/套用。
- 人物关系图：`relations` / `relation_positions` 表读写、SVG 渲染、拖拽布局保存、重置布局、导出 SVG/PNG（代码与安装包确认）。
- 伏笔时间线看板：埋设/回收汇总、未回收高亮、点章号跳大纲。
- 角色卡导入导出：导出 JSON 到剪贴板、导入覆盖、关系合并。
- 灵感模式：生成 3 条点子、用作构思方向、历史写入 `.dsh-writing/inspirations.json`。
- 章节图谱：节点/相邻衔接线/伏笔虚线渲染、导出 SVG/PNG。
- 文风示例段落：保存到契约、进入生成提示词；模板携带示例；模板导入/导出 JSON。
- System 模板：按任务覆盖 system、留空回退默认、恢复默认。
- 拆书：粘贴文本生成梗概/可复用桥段、历史写入 `.dsh-writing/deconstructions.json`。
- 运行详情：最近运行按类型筛选、查看 system/输入/输出、复制输出（项目页与会话页）。
- 数据健康：章纲未确认、缺字段、草稿未定稿、坏关系、超字数、摘要缺失、伏笔停滞；一键补摘要/确认章纲/批量定稿/清理坏关系/刷新过期定稿。
- 按卷操作：确认本卷、写本卷剩余（写前校验章纲已确认）、定稿本卷草稿。

## 数据层

- 旧项目自动迁移：只有旧版 JSON 的项目首次打开时生成 `story/project.db`，数据完整；旧 JSON 保留为只读存档（`data-status` 的 `legacyFiles = true`）。
- 迁移失败回滚：导入中途报错时删除新建数据库（含 `-wal`/`-shm`），原 JSON 不受影响。
- 新项目初始化只创建目录与数据库，不再写旧版 JSON 骨架。
- FTS 检索：中文 ≥3 字走 FTS5（trigram）+ `bm25` 排序 + `snippet` 命中片段（`[[...]]` 标记）；1–2 字回退 `LIKE`；结果带类型并可跳到章节/大纲/设定。
- `reindex` 重建索引：外部改过正文 Markdown 后（正常由章节监听自动增量重建）可手动重建全部索引。
- `data-status`：返回库体积、WAL 体积、FTS 行数、章节数、schema 版本、`legacyFiles`；`project-state` 带 `dataLayer` 字段。
- `export-file-project`：导出 JSON 镜像 + 正文到 `exports/file-project-<时间>/`。
- 快照/恢复：快照前 checkpoint 且快照内含数据库；恢复后数据库自动重开。
- 事务回滚：多步写入失败整体回滚（`BEGIN IMMEDIATE`），不留半写状态。
- `project-state` 在数百章项目上为毫秒级响应。
- 写作助手 `novel_query` 只读查询（`kind` 白名单），不开放裸 SQL。
- schema v2 升级：旧 v1 库打开时自动给 `chapter_meta` 补 `has_draft` / `has_final` 并置 `user_version = 2`，数据不丢。
- 正文存在性入库：`has_draft` / `has_final` 随写入与监听更新；项目状态与章节目录不再递归扫目录（300 章项目仍为毫秒级）。
- 章节监听：Electron 生产运行时 `fs.watch(recursive)`，其它环境 5 秒轮询 + 800ms 去抖；两种模式都触发该章索引重建、字数校正与正文存在性刷新。
- 并发写：两个独立进程同时写不同章节安全；同一章并发写为「最后写入者生效」；`SQLITE_BUSY` / `SQLITE_LOCKED` 有界重试。
- 纯文件项目导入：先备份到 `.dsh-writing/backups/import-<时间>/`，再覆盖 + 迁移 + 重建索引；与导出互逆，失败恢复备份。

## 写作助手

- `novel_chapter action=patch`：只替换片段、不调用模型；写 `revisions/manual-<时间>.md` 备份；meta 置 `status=manual` 并重算字数；改 `final` 置 `finalStale`；清空旧 QA；自动重建 FTS（服务路径测试）。
- 工具错误包装：所有 `novel_*` 工具抛错返回 `{ ok:false, tool, error, hint }`，助手不因单次错误中断。
- 系统提示词：`deepnovel:data-layer-rules` 与 `deepnovel:interruption-recovery` 两段注册在 novel-writer 预设作用域。
- 外部直接改正文：监听触发索引/字数/正文存在性刷新，并把该章标 `manual`、`final` 改动置 `finalStale`（健康页提示定稿待更新）。
- `novel_init` 创建 `story/` 与 `story/project.db`；`novel_chapter action=read` 返回 `hasDraft` / `hasFinal` / `wordCount`。
- `novel_query` 扩展 kind：relations / power 支持 keyword，power 的 changes 按章倒序；inspirations 默认 10 条；deconstructions 默认只回 summary（≤300）+ 字段计数，`entryId` / `number` 取单条全文；prompt-overrides 只回 preview（≤120）；premise-chat 消息 ≤400、batches 带 `candidateCount`。
- `novel_bible action=relations-save` / `power-save` 读写往返：关系按角色名校验（丢弃未知角色、自环、重复），`positions` 规范化；power 的 `tiers` 按 order 排序、`chapterChanges` 规范化；界面侧同类写入走 `bible` 资源锁。
- 工具输出预算（字符预算，不是 token 预算）：`novel_chapter list` 支持 `limit` / `offset` / `volumeId` / `status`（默认 30，返回 `total` / `truncated` / `nextOffset`）；`read` 支持 `maxChars`（默认 6000）/ `range` / `part`，draft/final 各带 `text` / `start` / `end` / `truncated` / `nextRange`，revisions 只回数量 + 前 3 个文件名；`action=search` 默认 5 条，返回命中 `index` 与前后 80 字 `context`；`novel_query` outline 默认只回卷列表（`expand=chapters` 才展开，默认 20，可按 `volumeId` / `fromNumber` / `toNumber`），`kind=chapter` 无 number 默认 30；所有截断都带 `truncated` 与 `next*`；典型输出均在 8192 字符以内（实测 list≈6.3k、read≈6.4k、outline≈2.5k、search≈0.9k），裁剪器保留 DSH 默认 8192/4096/1024，DeepNovel 不再自定义。
- 压缩跟随 DSH 默认：预设未配置 `compaction-basic`，使用 DSH 默认 `thresholdRatio 0.8` / `retainRatio 0.16` / `headroomTokens 65536`；DeepNovel 不覆盖。
- 对话压缩：自动压缩由 `compaction-basic` 的 `auto: true`（DSH 默认、预设不覆盖）在 step 边界按 80% 压力触发；AI 页「压缩上下文」手动按钮返回三种结果（成功 `{ compacted:true, items, tokens, message }`、少于 6 条消息 `{ compacted:false, message:'对话还太短…' }`、无历史/生成中返回可读错误）；压缩后对话可继续，不创建侧栏会话、不影响项目数据（实测：无历史→友好错误；新对话 4 条消息→太短；≥6 条才真正压缩）。
- 统一锁：助手工具按 action 映射 acquire/release（owner `agent:<sessionId>`），锁记录 `projectRoot`，资源忙时返回 `{ ok:false, error:'资源忙：…', hint }` 且不执行；`chapter-delete` + `removeOutline` 占 `chapter:batch`、导出占 `project:export`、快照/恢复占 `project`，全局资源与任何锁互斥、跨 owner 可见；`project-state` 带 `activeLocks`（含 projectRoot），`project-runs` 返回 `{ runs, locks }`；`project-cancel` 按项目+资源中止所有 owner（含助手），助手工具合并 `exec.signal` 与锁 controller 信号；界面任务坞显示助手占用并提供「取消」，`test-task-cancel` 覆盖按资源取消/全部取消/不误伤其它项目。
- skill：预设只保留 `tool-skill`（`skill-filesystem` 已移除）；技能来源只有内置 `craft-*` 与项目导入 `<projectRoot>/.dsh/skills`、`.agents/skills`，格式 `<name>/SKILL.md` 或 `<name>.md` + YAML frontmatter（name/description 必填）；新增/改名/删除无需重启。
- MCP：预设内 `mcp-example` 默认 disabled；改 `disabled: false` 并填 `serverName` / `transport` / `url`（或 stdio 的 `command` / `args` / `env` / `cwd`）后启用，工具名 `mcp__<serverName>__<tool>`；无响应的服务器会拖慢启动。
- AI 味审查：`style-audit` 与统一审校输出 `aiFlavor: { level: 轻|中|重, score: 0-100, markers: [{ type: 禁用词|句式|结构|节奏, quote, word? }] }`，按 35 个一级禁用词 / AI 句式 / 结构指纹 / 真人基准检查；模型结构不合法时用启发式（禁用词密度）兜底。
- deslop 改写：`novel_chapter action=deslop` / 章节页「去 AI 味」；`dryRun` 预览不落盘；应用写 `revisions/deslop-<时间>.md`、字数 ±30% 校验、失败恢复原文、清旧 QA、重建索引，返回 `changes` / `beforeAiFlavor` / `afterAiFlavor`；写作/修订/修复提示词注入 deslop 技法规则，PROMPT_CATALOG 有可覆盖的 `deslop` 条目。
- 技能库：三类来源——内置 `craft-*`（provider `deepnovel-craft`、rank 600、不可删、按项目开关、仅写作项目）、项目导入（`<projectRoot>/.dsh/skills` 100 / `.agents/skills` 200）、全局导入（`DSH_HOME/novel-writer/library/skills` 300，跨写作项目可用）；同名优先级 项目 > 全局 > 内置，覆盖前备份（项目 `.dsh-writing/backups/skills-<时间>/`、全局 `DSH_HOME/novel-writer/library/backups/skills-<时间>/`）；`skills-list` 每项带 scope / path，`skill-delete` / `skill-read` 带 scope，`skill-toggle` 仅内置写 `craftDisabled`；用户级 / 公共技能（`<dshHome>/skills`、`<agentsHome>/skills`、bundled、custom 根）不出现，非写作项目返回空；`skill-read` 内置正文带「判断是否适合本章」提示。
- 内置参考库：`ref-hooks` / `ref-openings` / `ref-reversals` / `ref-emotional-arc` / `ref-quality` 与 9 张 craft 同为内置技能（provider `deepnovel-craft`、rank 600、source builtin、不可删），技能库共 14 个内置；`skill-read ref-*` 返回正文（带「判断是否适合本章」提示）；`skill-toggle` 对 ref 生效并可恢复；`craftDisabled` 存技能名，兼容旧的裸 craft id。
- 模型路由：不再程序注入技法全文（旧 `craftCardsFor` 注入已废弃），系统提示词 10152 写明「技法不是本书设定、不是硬性规则」；AI 用 skill 工具按需加载并自行判断适用性。

- 提示词模板：`PROMPT_CATALOG` 23 条均带 `group`（premise/bible/outline/chapter/review/craft/data/other）与 `tags`；只读 `prompt-preview` 返回 `defaultText` / `currentText` / `customized` / `baseRevision` / `revision` / `variables`（`{{name}}` / `${name}` 去重、≤20），函数拼装模板返回 `variablesHint`；覆盖后 `currentText` 为覆盖文本且 `customized = true`，恢复默认后回到 `defaultText`；预览不调用模型、不改提示词。
- 素材库：schema v3 新增 `materials` 表（v2→v3 事务内升级、旧数据保留）；类型 片段/资料/桥段/引用/其他，`tags` ≤10、`title` 缺省取首行 ≤120；`materials-list` / `material-save` / `material-delete` 走 `materials` 资源锁；`novel_query kind=materials`（keyword 匹配标题/内容/标签、limit 默认 20、content 截断 400）；导出纯文件项目含 `story/materials.json`，快照含 `project.db` 自然包含。
- 提示词与技能：规则集中在 `writing-rules.js`（35 禁用词 / AI 句式 / 真人基准 / 5 组质检 / deslop 规则），templates / service / craft / builtin-skills 全部引用、无重复字面量；流程提示词（PROMPT_CATALOG）与技能（`craft-*` / `ref-*` / 导入）数据模型独立、不合并；项目页「提示词与技能」卡双 tab（流程提示词 / 技能库）替代原两张卡，素材库卡独立；技能正文与流程提示词共享同一规则来源。

- 修订学习：`revision-learn`（project-action / `novel_chapter action=revision-learn`）只分析同时有 draft+final 且内容不同的章节（指定章号或按 diff 取最近 N 章，`count` 默认 3 上限 6），返回 `{ summary, preferences, stats, chapters }`；偏好需稳定（同类 ≥2 次）、rule 可执行、≤8 条；只读不写文件/DB、可取消；UI「从修订学习」弹窗勾选后经 `project-update` 追加到 `writingNotes`，不自动改写正文；没有可学习修订时报错「需要同时存在草稿与定稿且内容不同」；提示词 `revisionLearn`（group craft）可覆盖。

- 约束引擎 / 事实包：七层优先级 explicit > facts > bible > outline > style > requirements > notes；结构化冲突覆盖视角/时态/句长/对话比例、术语/称呼、章纲 vs 设定存活、章纲回收 vs 伏笔已完成；语义预检失败降级；hardRules ≤12，开头完整 + 结尾复述双注入（不瘦身）；`facts` 表 schema v4（kind 术语/硬事实/安全/称呼、全局或按章）、生成后 `validateAgainstFacts` 可查违规；助手 `novel_facts`（list/save/delete）与 `novel_constraints`（check，仅返回 hardRules/conflicts/warnings）、project-action `facts-list`/`fact-save`/`fact-delete`、锁 `facts`；旧 `craft-card-*` 接口与自定义技法卡已移除，`novel_craft` 仅列出内置技法。

- 诊断与修复：`diagnoseChapter` 合并 facts 违规（hard）/ logicAudit 逻辑问题（hard）/ 审校 continuity（error→hard、warn→soft）与 styleIssue/AI 味（soft），issue 有稳定 id + level + source，返回 scores/stats；`repairChapter` auto 只修 hard、最小 diff `from` 唯一匹配否则 skipped、写前备份 `revisions/repair-r<轮>-<时间>.md`、复检 facts+logic、hard 不降或新增 >2 回滚、最多 2 轮；prescribe 只返回处方（autoFixable/risk）不改文件；soft 只回 softHints；`chapter-diagnose` / `chapter-repair` 与助手 `novel_diagnose` / `novel_repair`、锁 `chapter:<n>`；提示词 logicAudit/fixIssues（group review）可覆盖。

- 故事性 / 风格指纹：章纲 `change`/`storyQuestion`/`promise`/`beats` 可生成与保留（可选、可留空）；OUTLINE 提示词允许安静章节、不硬造冲突/钩子；`storyAudit`（group review 可覆盖）判定 changeHappened/questionProgress/promiseProgress/causalChain/contrived/issues；`diagnoseChapter` story 全 soft（source story）、`scope: all|logic|story`、`logicOnly` 不跑、`styleDrift` 仅 `scope=all`（soft、source styleProfile）；`repair` 不自动改 story（prescribe `autoFixable:false` / `risk:high`）；风格指纹纯规则统计 6 项指标、`compareStyleProfile` 偏差 low/medium/high（>35% medium、>60% high；对话绝对差 >0.15/0.25）、`buildStyleProfile` 最近 10 定稿写 `story/style/profile.json`、draft/revise/fix 在文风契约后注入【风格指纹】；project-action `style-profile-build`/`style-profile-get` 与 `novel_style` profile-build/profile-get。

- 写作工程化：写作类 system 前置 `WRITING_DOCTRINE` + `CAST_RULES`（doctrine 注入），助手系统提示词含「写作基础原则」；`planVolumeCast` 阵容 ≤6（+ 具名龙套 ≤3）、每卷新增命名角色 ≤2 且登记，写 `volume.cast` / `volume.extras`，未登记命名角色报 hard（advice：改身份指代或先 `novel_cast` 登记）；draft 注入上一章 `chapter_state` + 本卷阵容，写完自动 `updateChapterState`（阵容外角色剔除并 warning），`chapter-state` / `chapter-state-update` 与 `novel_state`；大纲审核 `structureIssues` 只给 `replan`（`repairOutlineIssues` 返回 `reason:'structure-only'`），`diagnoseChapter` 返回 `suggestedAction`，结构问题不进章节 repair；黄金三章与 `endingHook`（第 1 章弱钩子报 soft）；字数目标（style.chapterWords/chapter.wordBudget，默认 3000）、下限 80%、不足自动扩写最多 2 次（不改情节/不新增命名角色），返回 `wordCount` / `wordTarget` / `expanded` / `wordCountWarning`；默认不传 `maxTokens`（仅显式参数或 `automation.maxTokens` 限制，无 budgetCap/不加倍重试），大纲审核按 ≤12 章分块。
- 角色纪律：正文只允许本卷阵容具名角色；路人/次要人物用身份指代；未登记命名角色 → hard 一致性问题（advice「改身份指代，或先用 novel_cast 登记」）。

- 角色三层与质量检查：`CAST_LIMITS` 6/3/2；`planVolumeCast` 返回 cast / extras / newCharacters 并写 `volume.cast` / `volume.extras`（龙套须在池内、不与阵容重名、超 3 人截断并 warning）；`updateVolumeCast` 校验池内/重名/上限；`checkOutlineCastLeaks` 确定性校验 `castUsed` / `newNamed`（空格/大小写归一），仅在「顶层 `newNamed` 泄漏且无章级违规」时重试一次，违规写 `structureIssues`（未登记角色）并进 replan，不自动重生成；`castViolations` 随生成返回；OUTLINE_AUDIT 输出主角被动（连续 ≥3 章、给范围）与桥段重复（无升级）结构问题；client 大纲页显示「阵容 N/6 · 龙套 M/3」与结构问题面板。

- 问题交互：`issuesSummary` 纯本地聚合（不调模型）outline-audit 的 issues / structureIssues（经 buildStructureReplan 归并）/ staleCount、章节字数 <80%、chapter_state 缺失；item 含 id/source/severity/chapter/type/message/actions；动作 replan（带 fromChapter/toChapter）/ repair / audit / expand / update-state；每类上限 8（结构 replan 最多 3）、severity+章号排序、`limit` 默认 20 上限 100，返回 `{ count, items, generatedAt }`；出口 `project-state.issues`、`issues-list`、助手 `novel_issues`（只读）；客户端大纲页「待处理（N）」卡（≤3 条 + 查看全部弹窗 + 主按钮动作）与章节页当前章内联提示；助手在 outline/diagnose/repair/chapter 返回后 1–3 行摘要提醒。

- 大纲问题清理：稳定 id（`level|number|type|message` 哈希，fingerprint）；`normalizeOutlineAudit` 补 id / 去重 / 过滤 `dismissed` / 截断（`issues` ≤30、`structureIssues` ≤10，`truncated` 标记）；`dismissOutlineIssues` 支持 `ids` / `chapter` / `all=true`，写入 `dismissed`（≤200）、返回 `{ removed, dismissedTotal }`，无定位报错；`update` 写盘后自动 dismiss 该章旧问题并返回 `resolvedIssues`；audit 重审不复活已忽略项；`novel_outline action=dismiss`（enum 含 dismiss）与 `novel_issues` 大纲问题 actions 含 `dismiss`；客户端待处理卡 / 弹窗「忽略」→ `outline-dismiss` 后刷新；`scripts/test-outline-dismiss.mjs` 覆盖 id / 去重 / 截断 / 三种定位 / 重审不复活 / update 自动清理 / action 与 enum、客户端静态断言；全套 54 项测试通过。

- 卷目标 / 叙事格式：`scripts/test-volume-goal.mjs` 与 `scripts/test-outline-prompt.mjs` 更新——`planVolume` 注入上一卷末 3 章 `chapter_state`、末章结尾与摘要、未解冲突、角色池，返回 2–3 个候选（`goal` / `whyNow` / `exitCriteria` 必填，含 cost/risk/targetChapters/powerCeiling）且**不写盘**；`selectVolumePlan` 支持 `index` / `overrides`（goal / exitCriteria / whyNow / map / title / targetChapters / powerCeiling）写盘并记录 `whyNow` / `goalRevisedAt`；新卷生成时目标为空自动暂用候选 1 并返回 `volumeGoalWarning`（兜底不静默）；OUTLINE / VOLUME_PLAN 提示词含通用叙事格式规则（synopsis 叙事句、禁场记式/编号式/标签式、时间场景融进叙事），OUTLINE_AUDIT 报「非叙事标记 / 场记式开头」；全套 55 项测试通过。

- 章纲时间锚点：`normalizeChapterTime` 合法/非法（`day` 0–3650 或 null、`part` 四值、`spanDays` 0–30、`mode` 三值；非法整体丢弃为 null）；`update` 的 `fields.time`（`null` 删除锚点、非法报错）；大纲生成 prompt 注入最近 8 章时间线、上一章 `time` 锚点、硬事实/期限换算（`parseDeadlineDay` → day）；OUTLINE / OUTLINE_AUDIT 提示词含时间锚点规则与「时间线冲突」判定（linear 章 day 递增、同日 part 顺序、flashback/parallel 不参与、synopsis 与 time 矛盾；`time` 只写 JSON 不进 synopsis）；audit 输入带各章 `time` 锚点；`scripts/test-chapter-time.mjs` 覆盖 prompt 注入 / normalize / update / audit 规则 / 工具字段；全套 56 项测试通过。

- 卷收束 / 阵容轮换：`markVolumeEnd`（`volume-end`，volumeId? / chapterNumber? 缺省卷末章）保证**全卷仅一章** `volumeEnd`（清掉其它标记）并置 `pendingNextVolume`；生成时 `volumeEnded` 与 `volumeEndOverdue`（无收束且章数 ≥ targetChapters+2 → warning）；`planVolumeCast` 注入上一卷阵容与 `unusedPool`，要求至少 1 个不同角色（优先 unusedPool，其次 newCharacters ≤2，否则 `noNewCastReason`），返回 `newFaces` / `noNewCastReason` / `castWarning`，与上一卷完全相同且无新面孔 → 「阵容未更新」warning；OUTLINE_AUDIT 的 structureIssues 含「阵容未更新」；`novel_outline` enum 含 volume-end；`scripts/test-volume-growth.mjs` 覆盖 volumeEnd 规则 / overdue / mark 唯一 / 轮换 warning / newFaces / audit 类型 / action 与 enum；全套 57 项测试通过。

- 项目写作要求：`scripts/test-writing-notes.mjs` / `test-writing-notes-tasks.mjs` / `test-constraints.mjs` 断言——`CONSTRAINT_PRIORITY = ['explicit','facts','requirements','bible','outline','style','notes']`；写作要求统一块（`WRITING_NOTES_TITLE` + 冲突规则）在所有生成 prompt 前置且只出现一次；requirements 高于 style/bible/outline、低于 explicit/facts；阶段映射 `fix`/`expand`/`deslop`/`qa-fix`/`autofix` → `revise`（只勾草稿时扩写/修复不命中；不勾选 = 全部阶段）；expand prompt 注入写作要求 + 硬约束；客户端写作要求卡无「插入项目要求 / 复制要求」按钮、含自动注入文案与「未保存」徽标、勾选/取消即时保存；全套 59 项测试通过。

- 大纲修复版本化：`scripts/test-outline-repairs.mjs`——improved（问题数下降且无新增）自动应用并写回 outline/audit、存 `status:'applied'` 版本；regressed / mixed / audit-unavailable 保持当前 outline 与 audit 一致、修复结果存 `status:'candidate'` 版本（含 outlineBefore/After、auditBefore/After、diff、summary、issuesBefore/After、newIssues）；`apply-revision` / `discard-revision` 按 revisionId 应用或丢弃；版本目录 `story/plot/revisions/` 与 index 保留最近 20 个；`novel_outline` enum 含 revisions/revision/apply-revision/discard-revision；10157 文案含 applied 语义（true 列修复章与 X→Y；false 说明候选 versionId、X→Y、新增 N，让用户选 apply/discard/按 diff update，不立刻重复 repair）；客户端 toast 区分「已自动应用」与「已保存为候选」且无回滚文案；`scripts/test-outline-repair-audit.mjs` 覆盖回滚/成功 audit 一致性；全套 61 项测试通过。

- 中断与 CRUD：`scripts/test-cancel-signal.mjs` 验证 abort 后 `callModel` 在毫秒级以 `NOVEL_WRITER_CANCELLED` 退出、`novel_diagnose`/`novel_repair` 透传 `exec.signal`、用户中断=放弃计划与工作范围提示；`scripts/test-tool-crud.mjs` 验证构思 `update/delete`、文风 `update/delete`、章纲只删章纲并重排、素材 save/update/delete，以及 `novel_outline` / `novel_cast` / `novel_material` 的新动作声明；全套 65 项测试通过（`test-api.mjs` 需项目路径参数，单独运行）。

## 错误处理

- 空输出且 `max-tokens` 自动加倍预算重试。
- JSON 解析失败走修复调用；原始输出写 run 记录。
- 风格审稿失败降级为启发式结果，不阻塞页面。
- 修复输出字数异常拒绝写盘。
- 修复分数变差时回滚最佳版本。
- 请求可取消；批量写章失败即停并保留已完成章节。

## 尚未验证/限制

- 提示词注入在运行中的 DSH 里尚未端到端实测：预设段挂载（`ctx.systemPrompt.section`）需要重载插件后才能确认 fiber 状态。
- 真实长篇（数十章）下的上下文成本与节奏。
- 窄屏/移动端的完整交互。
- PDF 直接导出（当前 HTML 打印为 PDF）。
- 正文内角色名点击跳转设定。
- 浏览器自动化视觉回归。
- 0.9.54–0.9.85 新增功能（关系图拖拽、伏笔看板、角色卡、灵感、拆书、图谱、文风示例、System 模板、运行详情、数据健康、按卷批量操作）目前只做了代码/测试/安装包验证，**未在真实 UI 逐项点击验证**。

## 开发检查

```powershell
node --check service.js
node --check index.js
node --check client.js
node --check agent.js
node scripts/test-prompt-injection.mjs
node scripts/test-prompt-service.mjs
node scripts/test-run-resource.mjs
node scripts/test-health.mjs
node scripts/test-relations.mjs
node scripts/test-context-relations.mjs
node scripts/test-foreshadow.mjs
node scripts/test-writing-notes.mjs
node scripts/test-writing-notes-tasks.mjs
node scripts/test-constraints.mjs
```
