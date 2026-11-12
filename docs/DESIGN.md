# 设计

## 目标

把写作插件从“按阶段生成 JSON 字段”改为“对话写作 + 文档状态 + 工具检索”。

旧链路的问题：

- 每层提示词要求填大量字段；
- 字段齐全但内容模板化；
- 构思、卷计划、章纲、正文各自生成，语义不连续；
- 代价/风险等字段被模型理解成固定损失，写成流水账。

新链路：

```text
主创 Agent
  → 读项目地图
  → 按需读文档/检索
  → 在对话里写作
  → 生成写提案
  → 用户确认 diff
  → 写入 Markdown
  → 提交连续性账本
```

## 数据分层

### 索引层

`deepnovel.json` 只放：

- 标题、题材、语言、写作要求；
- 文风配置；
- 世界观/人物/卷/剧情点/章卡的 id、标题、顺序、归属；
- 连续性和摘要路径。

不把正文、章纲、人物小传放进索引。

### 创作层

Markdown 文件：

- `plot/book.md`
- `plot/volumes/<id>.md`
- `plot/arcs/<id>.md`
- `plot/chapters/<id>.md`
- `manuscript/<id>.md`
- `world/<id>.md`
- `characters/<id>.md`

Agent 和用户编辑的都是这些文件。

### 状态层

`continuity/ledger.json` 保存：

- facts：已确认事实；
- knowledge：谁知道什么；
- foreshadow：伏笔埋设/回收；
- timeline：时间线；
- handoffs：下一章交接。

每章摘要写到 `continuity/summaries/<chapterId>.md`。

## 写入模型

1. `novel_write action=propose` 计算新旧内容 hash 和 diff，生成提案；
2. 提案写到 `revisions/proposals/<id>.json`；
3. `novel_write action=apply` 要求 `confirm: true`；
4. 应用前校验当前正文 hash 没变，避免覆盖用户或另一个 Agent 的修改；
5. 应用后旧内容进 `revisions/`。

## Agent 上下文

- 项目地图常驻（小）；
- 当前对象按需读；
- 最近三章摘要；
- 连续性账本裁剪后进入；
- 不把整本正文塞进系统提示词。

长对话走偏时，状态由文档和账本恢复，而不是靠聊天历史。

## 阶段

阶段由项目实际产物推导，不是硬流程：

```text
setup → world → character → plot → manuscript → continuity
```

阶段只给建议，不阻止跨阶段读取或写作。

## 不再包含

- 批量构思候选 JSON 生成；
- 卷计划 beats/slots 强制生成；
- 章纲大量字段填写；
- 自动审核/自动修复；
- 按阶段生成的固定 UI 工作流。
