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
- 统一锁：助手工具按 action 映射 acquire/release（owner `agent:<sessionId>`），资源忙时返回 `{ ok:false, error:'资源忙：…', hint }` 且不执行；`chapter-delete` + `removeOutline` 占 `chapter:batch`、导出占 `project:export`、快照/恢复占 `project`，全局资源与任何锁互斥、跨 owner 可见；`project-state` 带 `activeLocks`，`project-runs` 返回 `{ runs, locks }`；界面任务托盘显示助手占用且冲突按钮禁用。
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
```
