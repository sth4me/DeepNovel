# 项目数据布局

`story/` 是写作项目的数据目录，由用户在写作台选择的项目目录决定。**它不属于插件仓库**，`.gitignore` 已忽略；用户可以在自己的小说仓库里自行版本化。

```text
story/
  project.json              # 项目元数据、模型/自动化/上下文配置
  premise.json              # 构思候选与已确认构思
  style/
    contract.json           # 文风契约
    templates/              # 自定义模板 user-*.json
  bible/
    index.json              # 角色/地点/规则/势力/物品
    relations.json          # 人物关系 + 关系图布局
  plot/
    outline.json            # 多卷章纲（volumes[]）
  prompts/
    system.json             # System 模板覆盖（按任务，留空=默认）
  chapters/
    001/
      meta.json             # 状态、字数、最近 run、inputs、summary、finalStale
      summary.json          # 自动连续性摘要（定稿时生成，可补全）
      draft.md              # 当前草稿
      final.md              # 定稿（approve 后）
      qa.json               # 规则质检
      style-qa.json         # AI 风格审稿
      instruction.json      # 讨论“用作修订要求”的待用指令
      revisions/            # 草稿/修订/修复/手动版本
  state/
    index.json              # 已定稿章节索引
    001.json                # 本章状态快照
  stats.json                # 写作事件统计
.deepnovel-snapshots/       # 项目快照（手动创建）
.deepnovel-backup/          # 解除初始化/恢复前的自动备份
exports/                    # 导出的 md/html/epub/docx（不属于插件仓库）
.dsh-writing/
  runs/<runId>.json         # 运行记录
  discussions/<topicId>.json# 讨论线程
  notes/<topicId>.json      # 讨论保存的备注
  inspirations.json         # 灵感历史（最近 20 条）
  deconstructions.json      # 拆书历史（最近 10 条）
```

## project.json

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

## premise.json

`status` 为 `candidate | confirmed`；`chosen` 保存已确认候选，`chosenHash` 供下游判断 stale。

## style/contract.json

`status`、`templateId`、`fields`、`fieldsHash`、`samples`；自定义模板在 `style/templates/user-*.json`。

## bible/index.json

```json
{
  "status": "confirmed",
  "characters": [{ "id": "C#01", "name": "", "role": "", "description": "", "traits": ["..."], "goal": "" }],
  "locations": [],
  "rules": [],
  "factions": [],
  "items": [],
  "updatedAt": "...",
  "confirmedAt": "..."
}
```

## bible/relations.json

```json
{
  "status": "confirmed",
  "relations": [{ "from": "角色A", "to": "角色B", "type": "敌对", "note": "" }],
  "positions": { "角色A": { "x": 380, "y": 260 } },
  "updatedAt": "..."
}
```

- `relations` 去重、最多 200 条；`from/to` 必须是 `characters` 中存在的名字，否则保存时会被丢弃。
- `positions` 是关系图拖拽后的布局，按角色名存 x/y；「重置布局」清空。
- 章节生成时按本章 `cast` 筛出相关关系进入上下文（最多 12 条）。

## prompts/system.json

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

## plot/outline.json

`volumes[0].chapters[]`，每个章纲节点包含：

`id / number / status / title / synopsis / wordBudget / inputs / generatedAt / confirmedAt`。

`synopsis` 是唯一的内容字段。

## chapters/NNN

- `meta.json`：`status`（`drafted / revised / manual / needs-review / approved`）、字数、最近 run、inputs。
- `draft.md`：当前可编辑稿。
- `final.md`：定稿。
- `qa.json` / `style-qa.json`：质检结果；手动编辑会清空。
- `instruction.json`：讨论写入的待用修订要求，修订成功后清除。
- `revisions/`：所有旧版本。

## state

`state/index.json` 是已定稿章节索引；`state/NNN.json` 保存本章 outline/meta/summary/cast/time/place/hook。

## 写安全

- 写入走 DSH 文件服务，项目根模式使用 `workspace-write` policy。
- 旧稿先归档到 `revisions/`，不静默覆盖。
- JSON 写入自动创建父目录；版本冲突会重试。
