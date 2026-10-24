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

当前公开起点为 `0.1.0`。除非用户明确要求变更主版本或次版本，后续更新只递增第三位：

- `0.1.0` → `0.1.1`
- `0.1.1` → `0.1.2`

不要自行升级到 `0.2.0` 或 `1.0.0`。发版前同步 README 与 `docs/`。

## 3. 提交与推送

```powershell
git add -A
git commit -m "…"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

## 4. 在 profile 重新安装

profile 的依赖必须是 `github:sth4me/DeepNovel`（不是 `link:`）：

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm install
```

装完确认版本：

```powershell
(Get-Content node_modules\@sth4me\deepnovel\package.json -Raw | ConvertFrom-Json).version
```

也可以在插件管理器里点"安装/更新"，效果相同。

## 5. 生效范围

| 改动 | 生效方式 |
|---|---|
| `client.js` | 刷新页面（或禁用/启用插件） |
| `index.js` / `service.js` / `agent.js` | 重启 DSH |
| 预设提示词段（`agent.js`） | 重启后新建会话生效，已有会话下一步生效 |
| 项目数据（`story/`） | 立即生效（每次调用读文件） |

## 6. 回滚

- profile：恢复 `profiles/desktop/package.json.bak-*` 后 `pnpm install`；
- 源码：`git checkout vX.Y.Z` 切换到指定 tag。

## 7. 常见问题

- **GitHub 超时**：`pnpm install` 重试即可；开发期可临时用 `link:` 指向本地仓库，发版后切回 `github:`。
- **版本没变**：确认 `package.json` 的 version 已 bump 并推送，再安装。
- **按钮/面板没出现**：先强刷客户端；仍没有就看 `%TEMP%\novel-writer-client.log` 里的注册记录。
- **动作无反应**：看项目内 `.dsh-writing/actions.log`，每次请求的 action/resource/错误都会落盘。
