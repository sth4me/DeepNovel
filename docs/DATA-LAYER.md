# 数据层

写作项目采用**混合数据层**：结构化数据存 SQLite，正文保留 Markdown 文件。

## 为什么这样分工

- **正文是可读手稿**：`draft.md`、`final.md`、`revisions/` 保持纯文本，可以直接用编辑器打开、进 git diff、被外部工具处理，不会因为插件升级变得不可读。
- **结构化数据要事务与索引**：章纲、设定、状态、摘要、统计、运行记录之间需要跨表一致，还要按章查询和全文检索；放进 SQLite 可以事务化写入、避免为一次操作散写几十个 JSON，也便于建立 FTS 索引。
- 结果：正文可读、可版本化；结构化数据一致、可查、可迁移。

## 存储布局

```text
story/
  project.db                # 结构化数据（SQLite，WAL，唯一真源）
  prompt.json               # 项目级提示词注入（仍是文件）
  chapters/NNN/
    draft.md                # 正文草稿（Markdown）
    final.md                # 定稿（Markdown）
    revisions/              # 旧版本（Markdown）
    instruction.json        # 本章修订要求（待用，仍是文件）
.dsh-writing/
  actions.log               # 动作日志
  inspirations.json         # 灵感历史（仍是文件）
  deconstructions.json      # 拆书历史（仍是文件）
```

除此之外的结构化数据都在 `story/project.db`。新建项目时初始化只创建目录和数据库，不再写旧版 JSON 骨架。

## 表结构概览

| 表 | 内容 |
|---|---|
| `project` | 项目元数据：标题、语言、题材、logline、写作备注，以及模型/自动化/上下文配置（`extra_json`） |
| `premise` | 构思候选与已确认构思、`chosenHash` |
| `style_contract` | 文风契约字段、示例段落、`fieldsHash` |
| `style_templates` | 自定义文风模板 |
| `bible_meta` / `bible_entries` | 设定索引与条目（角色/地点/规则/势力/物品） |
| `relations` / `relation_positions` / `relations_meta` | 人物关系、关系图布局、关系状态 |
| `power` | 能力体系（整体存 JSON） |
| `volumes` / `outline_chapters` / `outline_meta` | 多卷、章纲节点、大纲状态 |
| `chapter_meta` | 章节状态、字数、正文存在性（`has_draft` / `has_final`）、inputs、最近 run、`finalStale` 等 |
| `chapter_qa` | 规则质检、AI 风格审稿、连续性检查结果 |
| `chapter_state` | 本章状态快照（outline/meta/summary/cast/time/place/hook） |
| `chapter_summary` | 自动连续性摘要 |
| `state_meta` | 状态索引更新时间 |
| `stats_events` / `stats_meta` | 写作事件统计 |
| `runs` | 每次模型调用的运行记录（kind、模型、system、输入、输出、usage） |
| `prompt_overrides` | 按任务的 System 模板覆盖 |
| `notes` | 作者备注（章节、文本、来源） |

约定：结构简单稳定的实体用列；结构复杂或字段易变的（能力体系、章节 meta/state/summary、run）整体存 JSON 列；少数实体的状态/更新时间放在 `*_meta` 小表。全文检索表单独列出：

- `fts_chapters`：章节正文标题与内容
- `fts_outline`：章纲标题与梗概
- `fts_bible`：设定名称与描述
- `fts_summaries`：摘要、人物、事件

schema 版本记录在 `PRAGMA user_version`（当前为 2）。打开旧库时按版本自动升级：v2 给 `chapter_meta` 补 `has_draft` / `has_final`（正文存在性入库），`ALTER TABLE` 与版本更新在同一个事务里完成，旧数据原样保留。

## 旧项目迁移

- 打开项目时先看 `story/project.db`；不存在但有旧版标识 `story/project.json`，判定为旧项目。
- 一次性读取旧 JSON 与正文，导入数据库，并用正文建立章节检索索引。
- **旧 JSON 保留在原处、不再读写**，作为只读存档。`data-status` 的 `legacyFiles` 表示这份存档是否还在。
- 迁移在事务中完成并 `checkpoint`；任一步失败会删除新建的 `project.db`（及 `-wal`/`-shm`）回滚，原 JSON 不受影响。
- 迁移后需要纯文件形式时，用「导出纯文件项目」。

## 快照、备份与导出

- 项目快照（`.deepnovel-snapshots/<时间>/`）复制 `story/` 与 `.dsh-writing/`。复制前先 `checkpoint`，把 WAL 合入 `project.db` 主文件，避免快照缺少未落盘的改动。
- 恢复快照：先 `checkpoint` 并关闭缓存连接，再替换 `story/`；恢复后下次访问自动重新打开数据库。
- 解除初始化把 `story/`、`.dsh-writing/` 整体移到 `.deepnovel-backup/`。
- 导出 Markdown / HTML / EPUB / DOCX 不受影响，仍按章读取正文与数据库。
- 「导出纯文件项目」把结构化数据导出成旧版 JSON 镜像（`story/*.json`、章节 `meta/qa/summary.json`）并复制正文，写到 `exports/file-project-<时间>/`，用于备份、迁移或人工检查。
- 「导入纯文件项目」与导出互逆：选择一个纯文件项目目录（含 `story/`），先把当前 `story/` 备份到 `.dsh-writing/backups/import-<时间>/`，再覆盖、迁移（源里没有 `project.db` 时）并重建索引；中途失败自动恢复备份。导入与所有写动作互斥。

## 检索

- 全局搜索走 FTS5，`trigram` 分词。
- 中文查询 ≥3 字走 FTS：`bm25` 排序，`snippet` 返回命中片段，命中词用 `[[...]]` 标记，界面高亮显示。
- 1–2 字查询走 `LIKE` 兜底（trigram 不索引更短片段），同样返回 `[[...]]` 标记的上下文片段。
- 覆盖章节正文、章纲、设定、摘要；结果带类型，点击跳到对应页面（章节 / 大纲 / 设定）。
- 「重建索引」：正常外部改正文会由章节监听自动增量重建该章索引；如果监听不可用、改的是历史遗留文件或怀疑索引不一致，执行 `reindex` 重建全部索引。结构化数据仍以数据库为准。

## 章节监听

正文是文件，写作助手或外部编辑器可能直接改 `story/chapters/<章号>/draft.md` / `final.md`，插件要感知并同步：重建该章检索索引、校正字数、刷新正文存在性。

- **Electron 生产运行时**：用 `fs.watch(recursive)` 监听 `story/chapters/`，从事件路径解析章号。
- **其它环境**（开发 / 测试，或 watch 创建失败时）：每 5 秒轮询一次，比较 `draft.md` / `final.md` 的 mtime:size 签名兜底。
- 两种模式统一走 800ms 去抖：连续写入只处理一次；最近 500ms 内的自身写入会被抑制，避免自己写完又触发一轮。
- 删除/重命名章节目录时临时关闭监听（Windows 下递归 watch 会因目录消失误报），操作完成后恢复。

## 性能

- 正文存在性（`has_draft` / `has_final`）入库后，项目状态与章节目录不再逐章递归扫描 `story/chapters/`；300 章项目冷启动与稳态刷新都是毫秒级。
- 监听只处理变化的章节，不触发全库重建；需要重建全部索引时手动执行 `reindex`。

## 并发与一致性

- 单项目一个 SQLite 连接（服务端按项目缓存），`journal_mode=WAL`：读不挡写；`synchronous=NORMAL`，`foreign_keys=ON`。
- `busy_timeout=5000`，另加有界重试（默认 3 次、100ms 起指数退避，只对 `SQLITE_BUSY` / `SQLITE_LOCKED`）：多窗口/多进程短时写冲突自动等待重试，不把偶发冲突抛给用户。
- 多步写入用 `BEGIN IMMEDIATE` 事务，失败整体回滚，不留半写状态。
- 已验证两个独立进程同时写不同章节安全；同一章并发写按「最后写入者生效」，不会损坏数据库。
- 导入纯文件项目、删除/重排章节等整体性操作仍建议串行：界面层为导入分配独立资源并让它与所有写动作互斥，避免与正在进行的生成互相覆盖。

## 排错

- 看 `data-status`：库体积、WAL 体积、FTS 行数、章节数、schema 版本、是否还有旧版存档。
- 索引不新：执行 `reindex`。
- 数据库损坏：保留 `story/chapters/` 正文；如果还留着旧 JSON 存档，删掉 `story/project.db*` 后重新打开项目触发迁移；旧 JSON 已删除时，从快照或备份恢复。
- 不要把 `story/project.db`、`-wal`、`-shm` 提交进 git；需要版本化时只提交正文 Markdown。
- 写作助手排查数据用只读工具 `novel_query`（`kind` 白名单：chapter / outline / bible / state / summary / stats / runs），不要直接改库文件。
- 导入失败或想回退：导入前会自动备份到 `.dsh-writing/backups/import-<时间>/`，界面卡片显示「上次导入备份」路径；失败时插件已自动恢复，手动回退可用该备份覆盖 `story/`。

## 接口

- `project-state` 返回 `dataLayer` 字段（引擎、库体积、WAL 体积、FTS 行数、章节数、schema 版本、`legacyFiles`）。
- 四个 project-action：`data-status`、`reindex`、`export-file-project`、`import-file-project`（参数 `path`，绝对路径）。

## 相关

- 目录布局与各表对应的数据结构：[STORY-LAYOUT.md](STORY-LAYOUT.md)。
- 创作流程与数据分层：[WORKFLOW.md](WORKFLOW.md)。
