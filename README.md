# DeepNovel

DSH 长篇小说写作插件。文档是唯一事实来源，主创 Agent 在对话里写作；AI 写盘先出 diff 再由用户确认，手动编辑自动保存。

## 结构

```text
deepnovel.json          项目索引（薄字段）
world/                  世界观文档
characters/             人物文档
plot/
  book.md               全书主线
  volumes/              卷
  arcs/                 剧情点
  chapters/             章卡
manuscript/             正文
continuity/             连续性账本与章节摘要
references/             原作/前作/研究资料副本与索引
revisions/              修订与写提案
```

- `deepnovel.json` 只保存标题、阶段、指向关系、顺序和文风；
- 设定、人物、剧情、章卡、正文都是 Markdown；
- 连续性和时间线是结构化 JSON 账本；
- 不再用批量 JSON 字段生成整章/整卷。

## 写作方式

主创 Agent 只暴露一组通用工具：

- `novel_project`：查看/初始化项目；
- `novel_read`：按对象读取文档；
- `novel_search`：按原文检索；
- `novel_reference`：检索/读取项目资料库中的原作、前作和研究资料；
- `novel_create`：生成“元数据 + 正文”的原子创建提案；
- `novel_write`：对已有文档生成写提案，确认后应用；
- `novel_stage`：查看当前阶段提示；
- `novel_route`：按任务类型查看或设置执行模型与思考档；
- `novel_task`：在对话里查看队列、提交带文件作用域的后台任务、取消任务；
- `novel_count`：按章/卷/全书统计净字数、字符数、行数、段落和引号数，并对照章卡目标；
- `novel_continuity`：读取/提交连续性。

Agent 先读项目地图和相关文档，再写作；不会把整本书塞进上下文。

## 写作台

可选写作台，可通过组件行开关：

- 左：项目 / 构思 / 文风 / 设定 / 大纲 / 章节；
- 中：对应页面或 Markdown 编辑区；
- 右：修改提案和 diff。

写作台的 AI 按钮会找到项目 Workspace，创建正常 DSH 写作会话并自动发送任务；不会另建隐藏助手。聊天仍在主会话里进行。

## 安装

DSH 插件管理器安装 `@sth4me/deepnovel`。主 bundle 会同时提供宿主 API 和写作 Agent；写作台是独立的可选 UI 行，可以在插件管理中关闭。

## 项目初始化

在会话里让 Agent 初始化，或直接创建项目目录并调用：

```json
{ "action": "init", "title": "书名", "language": "zh" }
```

工具要求项目目录里有 `deepnovel.json`；没有时先初始化。

## 边界

写作台的 HTTP API 只监听回环地址，只服务本机；不会上传小说内容。用户数据目录（`story/`、`manuscript/`、`world/` 等）不应提交到插件仓库。
