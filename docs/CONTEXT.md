# 写作上下文管理

## 原则

写作不是聊天：上下文不应该是一段不断增长的对话历史，而应该是**当前写作任务需要的“故事事实”**。

这些来源从 `story/project.db` 的表与正文 Markdown 读取；组装顺序不变。

写作台按以下顺序组装每次生成：

1. **故事背景**：logline、题材、钩子、主角、核心冲突、边界。
2. **文风契约**：视角、时态、句长、段落、对话占比、比喻密度、叙述声音、用词偏好、意象、感官侧重、对白写法、节奏、三档规则（必须贯彻 / 绝对禁止 / 按场景调节）、禁用词与禁用句式、适用题材、章节标题风格、额外要求；契约里的 2–3 段示例段落作为「文风示例」一起进入提示词。契约按可读文本（非 JSON）注入生成与审校提示词。
3. **相关设定**：与本章角色/地点/物品匹配的 Bible 条目；规则始终带上；角色不匹配时回退到前几个。
4. **人物关系**：与本章出场人物相关的关系（最多 12 条），来自 `story/project.db` 的 `relations` 表。
5. **连续性**：最近 N 章的状态（时间/地点/剧情梗概/人物）+ 上一章结尾片段。
6. **未回收伏笔**：按“截至本章”的埋/收状态计算，而不是全书最终状态。
7. **时间线**：最近若干章的时间/地点/标题。
8. **章节摘要历史**：最近 8 章的自动摘要；另按当前章纲关键词从更早摘要中检索最多 4 条相关摘要。
9. **当前章纲 + 当前正文**（修订时）。
10. **作者备注**：历史备注，最多最近 3 条。
11. **技能库**：内置技法作为内置技能（`craft-*`），由 AI 按需用 skill 工具读取全文并自行判断是否适用；不再按任务自动注入。

不会自动带：全部历史章节、聊天记录、无关的候选构思、未选中的文风模板、全部设定条目、全部技能正文。

## 预算

项目 → 上下文预算 可调：

| 配置 | 默认 | 作用 |
|---|---|---|
| `recentStateChapters` | 1 | 带最近几章状态 |
| `maxTailChars` | 1200 | 上一章结尾最多多少字 |
| `maxBibleCharacters` | 12 | 相关角色上限（上限 20） |
| `maxRules` | 6 | 规则上限 |
| `maxForeshadow` | 8 | 未回收伏笔上限 |
| `maxTimeline` | 5 | 时间线章数 |
| `includeForeshadowing` | true | 是否带伏笔 |

## 按任务取上下文

| 任务 | 上下文 |
|---|---|
| 构思 | 无前文（只基于项目） |
| 设定 | 已确认构思 + 文风 + 已有章纲 |
| 章纲 | 构思 + 文风 + 设定（角色最多 20 个 / 规则 10 条 / 地点 10 个） + 相邻章摘要 |
| 正文草稿 | 完整写作上下文 + 当前章纲 + 上一章结尾 |
| 正文修订 | 完整写作上下文 + 当前章纲 + 当前正文（局部重写只带选中段落） |
| 质检修复 | 当前章纲 + 当前正文 + 质检问题 |
| 风格审稿 | 文风契约 + 当前正文 |
| 章节摘要 | 本章正文；定稿时自动生成并写入 `chapter_summary` 表 |
| 连续性检查 | 前文摘要、当前章纲、设定；先做确定性检查，可再触发 AI 检查 |

## 可观测

- 章节页「上下文」按钮会显示本次生成实际会带上的内容、字符数、估算 token 数和各段计数。
- 每次草稿/修订的 run 记录会记录 `context.meta`。
- 「最近运行」可查看每次调用的 system、输入与输出（项目页与会话页）。
- `GET /novel-writer/context?projectRoot=&number=` 返回完整预览。

## 数据文件

结构化数据都在 `story/project.db`，正文是 Markdown 文件；数据层见 [DATA-LAYER.md](DATA-LAYER.md)。

| 来源 | 作用 |
|---|---|
| `story/project.db` · `project` | 项目元数据与模型/上下文/自动化配置 |
| `story/project.db` · `premise` | 构思候选与已确认构思 |
| `story/project.db` · `style_contract` / `style_templates` | 文风契约（含 `samples` 示例段落）与自定义模板 |
| `story/project.db` · `bible_entries` / `relations` / `relation_positions` | 设定与人物关系（含关系图布局） |
| `story/project.db` · `power` | 能力体系 |
| `story/project.db` · `volumes` / `outline_chapters` | 多卷与章纲 |
| `story/project.db` · `chapter_summary` / `chapter_state` | 章节摘要与状态快照 |
| `story/project.db` · `prompt_overrides` | 按任务的 System 模板覆盖（v2 结构 `{version:2, overrides:{key:{text,baseHash,baseRevision}}}`，留空用默认；兼容旧版纯字符串） |
| `story/project.db` · `runs` | 运行记录（system/输入/输出/usage） |
| `story/chapters/NNN/draft.md` / `final.md` / `revisions/` | 正文与旧稿（Markdown） |
| `story/prompt.json` | 项目级提示词注入 |
| `DSH_HOME/novel-writer/library/characters/*.json` | 跨项目角色库（全局，不属于单个项目） |
| `DSH_HOME/novel-writer/library/craft/*.json` | 旧版自定义技法卡片（`novel_craft` 兼容；推荐改用导入技能） |
| `.dsh-writing/inspirations.json` | 灵感历史（最近 20 条） |
| `.dsh-writing/deconstructions.json` | 拆书历史（最近 10 条；每条含 units/settings/relations/techniques/pacing 与 stages） |

## 长期连载

- 已定稿章节通过状态快照提供连续性，而不是重读全文。
- 章节越长，优先用状态 + 结尾 + 伏笔，而不是把整章塞进上下文。
- 需要局部改时用段落范围重写，避免整章重发。
- 后续可加“角色出场索引 / 场景摘要 / 章节摘要自动生成”，进一步降低长书上下文成本。
