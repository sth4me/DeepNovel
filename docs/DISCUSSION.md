# 讨论结果与“一键应用”

## 结果结构

讨论回复现在要求模型输出 JSON：

```json
{
  "reply": "给用户看的完整回答",
  "conclusion": "一句话结论",
  "suggestions": ["具体改法"],
  "todos": ["可执行动作"],
  "risks": ["风险或注意"],
  "actions": [
    { "type": "chapter-instruction", "instruction": "把开头改成…", "reason": "…" }
  ]
}
```

`actions` 是**可直接落盘的修改**，不是新的待办列表：

- 章节讨论：`chapter-instruction`，写入本章修订要求。
- 章纲讨论：`outline-update`，只允许 title/synopsis/wordBudget。
- 设定讨论：`bible-update`，只允许 name/role/description。
- 文风讨论：`style-update`，只允许文风契约字段。
- 构思讨论：`premise-candidate-update`，只改当前候选/已选构思字段。
- 模型没有明确可落盘修改时，`actions` 必须为空；面板会显示「应用这些修改」。
- 点击应用会先弹确认框，展示字段的「当前值 → 新值」或章节修订要求，确认后才写盘。
- 应用成功后可「撤销应用」，从 `.dsh-writing/discussion-applies/` 的备份恢复受影响文件。
- 项目页「讨论应用历史」列出最近 20 次应用，可逐条撤销。

`reply` 是主体文本；其余字段用于面板展示和后续应用。解析失败时退化为纯文本回复，不阻塞讨论。

## 两种可应用结果

### 用作修订要求（章节讨论）

- 只对 `chapter-<n>` 类型显示。
- 把 `conclusion`（没有则用 `reply`）写入：
  `story/chapters/<pad>/instruction.json`
- 章节页打开该章时自动填入「本章/修订要求」，可直接点「按意见修订」。
- 修订成功后自动清除该 instruction，避免下次重复带入。

### 保存为备注

- 任意带结构化结果的讨论都可保存。
- 写入：`.dsh-writing/notes/<topicId>.json`
- 备注会作为「作者备注（来自讨论结论）」进入该章后续的写作上下文（最多最近 3 条）。
- 不会自动改设定/章纲/正文。

## 上下文

- 讨论对象内容仍只带节选，避免把整章塞进讨论。
- 但 `chapter-<n>` 讨论会自动追加本章章纲、相关人物/地点/规则、最近章节状态、未回收伏笔和当前正文节选。
- 因此模型可以对照大纲与设定回答，而不是只根据一段摘录猜。

## 流式输出

- `/novel-writer/discussion-stream` 用 SSE 推送模型原文。
- 前端只提取 `"reply"` 字段的增量文本，边生成边显示；结束后再解析完整 JSON 展示结论/建议/待办/风险。
- 生成中可「停止」；停止或失败后可「重试上一条」。
- 回复完成后可展开「查看本次注入的上下文」。
- Host 尚未重载时，客户端会自动回退到非流式 `/discussion`。

## 其他

- 复制：把回复复制到剪贴板。
- 讨论线程持久化在 `.dsh-writing/discussions/<topicId>.json`；重新点讨论会继续原线程。
- 线程历史只带最近 6 条消息（每条截 800 字），避免讨论本身变成无限上下文。
