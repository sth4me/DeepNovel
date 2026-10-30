# 项目数据布局

`story/` 是写作项目的数据目录，由用户在写作台选择的项目目录决定。**它不属于插件仓库**，`.gitignore` 已忽略；用户可以在自己的小说仓库里自行版本化。

结构化数据在 `story/project.db`（SQLite），正文是 Markdown 文件。混合方案与原因见 [DATA-LAYER.md](DATA-LAYER.md)。

```text
story/
  project.db                # 结构化数据（SQLite，WAL，唯一真源）
  prompt.json               # 项目级提示词注入（文件）
  chapters/
    001/
      draft.md              # 当前草稿
      final.md              # 定稿（approve 后）
      instruction.json      # 本章修订要求（待用）
      revisions/            # 草稿/修订/修复/手动版本（Markdown）
.deepnovel-snapshots/       # 项目快照（手动创建）
.deepnovel-backup/          # 解除初始化/恢复前的自动备份
exports/                    # 导出的 md/html/epub/docx（不属于插件仓库）
.dsh-writing/
  actions.log               # 动作日志
  inspirations.json         # 灵感历史（最近 20 条）
  deconstructions.json      # 拆书历史（最近 10 条，含分区与阶段状态）
```

其余结构化数据（项目、构思、文风、设定、关系、能力、章纲、章节状态/质检/摘要、统计、运行记录、System 模板覆盖、备注）都在 `project.db` 的表里，见下表与 [DATA-LAYER.md](DATA-LAYER.md)。

旧项目迁移后，原有 JSON（`story/project.json`、`premise.json`、`style/contract.json`、`bible/index.json`、`bible/relations.json`、`prompts/system.json`、`plot/outline.json`、`state/index.json`、`stats.json`、`chapters/NNN/meta.json` 等）保留在原处作为**只读存档**，插件不再读写；`data-status` 的 `legacyFiles` 会标出它们还在。

跨项目资产（不在项目目录里，全局共享）：

```text
$DSH_HOME/novel-writer/library/
  characters/*.json         # 角色库
  craft/*.json              # 旧版自定义技法卡片（novel_craft 兼容；推荐改用导入技能）
```

## project（`project` 表）

项目元数据、模型/自动化/上下文配置存在 `project` 表。等价 JSON（「导出纯文件项目」会写成 `story/project.json`）：

```json
{
  "schemaVersion": 1,
  "layoutVersion": 1,
  "title": "未命名",
  "language": "zh",
  "presetId": "novel-writer",
  "models": {
    "draft": { "provider": "deepseek-account", "model": "deepseek-flash", "reasoningEffort": "off" }
  },
  "automation": {
    "autoAudit": false,
    "autoFix": false,
    "fixRounds": 2,
    "stylePassScore": 60,
    "batchCount": 3,
    "targetWords": 0
  },
  "context": {
    "recentStateChapters": 1,
    "maxTailChars": 1200,
    "maxBibleCharacters": 6,
    "maxRules": 6,
    "maxForeshadow": 8,
    "maxTimeline": 5,
    "includeForeshadowing": true
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```

## 构思（`premise` 表）

`status` 为 `candidate | confirmed`；`chosen` 保存已确认候选，`chosenHash` 供下游判断 stale。

## 文风（`style_contract` / `style_templates` 表）

`style_contract` 存 `status`、`templateId`、`fields`、`fieldsHash`、`samples`；自定义模板在 `style_templates` 表。

## 设定（`bible_entries` 表）

条目按分类存 `bible_entries`（角色、地点、规则、势力、物品），确认状态与更新时间在 `bible_meta`。角色条目字段：`id / name / role / description / traits / goal`。

## 人物关系（`relations` / `relation_positions` / `relations_meta` 表）

```json
{
  "status": "confirmed",
  "relations": [{ "from": "角色A", "to": "角色B", "type": "敌对", "note": "" }],
  "positions": { "角色A": { "x": 380, "y": 260 } },
  "updatedAt": "..."
}
```

- `relations` 去重、最多 200 条；`from/to` 必须是角色条目中存在的名字，否则保存时会被丢弃。
- `positions` 是关系图拖拽后的布局，按角色名存 x/y，存在 `relation_positions`；「重置布局」清空。
- 章节生成时按本章 `cast` 筛出相关关系进入上下文（最多 12 条）。

## System 模板覆盖（`prompt_overrides` 表）

```json
{
  "premise": "",
  "bible": "",
  "outline": "",
  "draft": "",
  "revise": "",
  "fix": ""
}
```

- 每项为字符串，留空/缺失即使用内置默认。
- 覆盖只替换基础 system；任务附加规则仍由插件拼接。

## 大纲（`volumes` / `outline_chapters` / `outline_meta` 表）

`volumes` 存卷；`outline_chapters` 每个章纲节点包含：

`id / number / status / title / synopsis / wordBudget / inputs / generatedAt / confirmedAt`。

`synopsis` 是唯一的内容字段。大纲整体的状态与更新时间在 `outline_meta`。

## 章节（`chapters/NNN/` + `chapter_*` 表）

- `draft.md`：当前可编辑稿。
- `final.md`：定稿。
- `revisions/`：所有旧版本（Markdown）。
- `instruction.json`：本章修订要求，修订成功后清除。
- 章节状态与字数在 `chapter_meta`（`status`：`drafted / revised / manual / needs-review / approved`、字数、最近 run、inputs）。
- 质检结果在 `chapter_qa`（旧版 `qa.json` / `style-qa.json` 已迁入该表）；手动编辑会清空。
- 自动连续性摘要在 `chapter_summary`，定稿时生成，可补全。

## 状态（`chapter_state` / `state_meta` 表）

`state_meta` 是已定稿章节索引；`chapter_state` 保存本章 outline/meta/summary/cast/time/place/hook。

## 写安全

- 结构化写入走 SQLite 事务（`BEGIN IMMEDIATE`，失败回滚）；多窗口冲突由 WAL 与 `busy_timeout` 兜底。
- 正文写入走 DSH 文件服务，项目根模式使用 `workspace-write` policy。
- 旧稿先归档到 `revisions/`，不静默覆盖。
- 数据库文件不提交 git；需要版本化时提交正文 Markdown。
