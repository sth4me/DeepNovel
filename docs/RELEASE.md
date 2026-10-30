# 发布与更新流程

固定流程：**改代码 → 本地验证 → 提交并推送 → 在 profile 重新安装 → 重启/刷新**。

不要在未推送的工作区上直接改 profile 依赖或手工拷贝文件：插件管理器更新时会回到 GitHub 上的旧版本，之前的本地修复就丢了。

## 1. 本地验证

```powershell
node --check service.js
node --check index.js
node --check client.js
node --check agent.js
node --check templates.js
node scripts/test-prompt-injection.mjs
node scripts/test-prompt-service.mjs
node scripts/test-run-resource.mjs
```

## 2. 版本号

版本遵循语义化版本；发布前同步 `package.json`、README 与 `docs/CHANGELOG.md`。


## 3. 提交与推送

```powershell
git add -A
git commit -m "…"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

## 4. 安装/更新

在插件管理器里重新安装或更新到此版本；不要手工拷贝文件覆盖安装目录。

## 5. 生效范围

| 改动 | 生效方式 |
|---|---|
| `client.js` | 刷新页面（或禁用/启用插件） |
| `index.js` / `service.js` / `agent.js` | 重启 DSH |
| 预设提示词段（`agent.js`） | 重启后新建会话生效，已有会话下一步生效 |
| 项目数据（`story/`） | 立即生效（每次调用读数据库与正文） |

## 6. 回滚

- 源码：`git checkout vX.Y.Z` 切换到指定 tag。

## 7. 常见问题

- **GitHub 超时**：重新安装或更新时重试。
- **版本没变**：确认 `package.json` 的 version 已 bump 并推送，再安装。
- **按钮/面板没出现**：先强刷客户端；仍没有就看 `%TEMP%\novel-writer-client.log` 里的注册记录。
- **动作无反应**：看项目内 `.dsh-writing/actions.log`，每次请求的 action/resource/错误都会落盘。
