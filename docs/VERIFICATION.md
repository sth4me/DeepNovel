# 验证

## 语法

```bash
node --check index.js
node --check agent.js
for f in writing/*.js ui/client.js; do node --check "$f"; done
```

## 测试

```bash
node scripts/test-writing-core.mjs
node scripts/test-writing-tools.mjs
node scripts/test-writing-host.mjs
node scripts/test-client-split.mjs
node scripts/test-task-dispatch.mjs
```

覆盖：

- 索引/文档创建、读写、提案、hash 校验；
- 工具层：项目、读、搜、创建、写提案、连续性；
- 宿主 HTTP API 和 Agent 工具注册；
- UI 包边界与最小面板注册；
- 项目 Workspace 查找、正常会话创建、任务自动发送。

## 手工验证

1. 用系统目录选择器打开项目，或新建项目；
2. 点「开始开书」，确认打开正常写作会话并自动发送任务；
3. 在对话里完成方向确认；AI 创建设定/人物/卷/章卡提案；
4. 在对话或写作台确认 diff 后应用；
5. 打开章节写正文，生成 diff 并应用；
6. 提交连续性；
7. 重开项目，确认页面与文档仍在；
8. 拒绝一个创建提案，确认没有留下空对象。
