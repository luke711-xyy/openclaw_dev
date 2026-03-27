# OpenClaw Session Branch UI

一个可复用的 OpenClaw Skill：安装后会在本机启动一个浏览器 UI，用来在同一个 agent 下管理多个命名分支会话。

它适合这样的场景：

- 一个 agent 下长期维护多个 branch / 任务线
- 想在浏览器里查看、切换、搜索、发送消息
- 想把这套能力稳定安装到别的电脑上
- 希望 Gateway 重启后自动拉起 UI

## 当前版本重点

本版已经包含最近修复过的稳定性问题：

- `chat.send` 缺少 `operator.write` scope 时，自动 fallback 到本地 transcript 写入
- fallback 发送后，`history-delta` 可以立即看到新 user message
- assistant 回复会继续同步进 `history-delta`
- assistant 没有正文但存在 `errorMessage` 时，会把错误内容显式展示到历史里，而不是静默丢失

## 主要能力

- 创建/重命名/删除命名分支
- 浏览 Gateway 当前可见 sessions
- 懒加载历史消息
- 搜索历史消息
- 发送消息 / 中止当前运行
- 合并当前 transcript 与同 session 的 `.jsonl.bak.*`，尽量保留 compact 前后的历史可见性
- 通过 Gateway hook 自动启动 UI，并在 Gateway 退出后自动停止 watcher

## 目录结构

- `SKILL.md`：给 agent 用的安装/使用说明
- `scripts/install_session_branch_ui.py`：跨平台安装脚本
- `assets/session-branch-ui-template/`：实际安装到目标机器的 UI 模板
- `assets/session-branch-ui-hook/`：Gateway 启动 hook
- `references/`：平台与架构说明

## 在别的电脑安装

### 方案 A：从 GitHub 克隆后安装

```bash
git clone https://github.com/luke711-xyy/openclaw_dev.git
cd openclaw_dev/skills/openclaw-session-branch-ui
python scripts/install_session_branch_ui.py
```

自定义 OpenClaw 路径：

```bash
python scripts/install_session_branch_ui.py --state-dir ~/.openclaw --workspace ~/.openclaw/workspace --force
```

先 dry-run：

```bash
python scripts/install_session_branch_ui.py --dry-run
```

### 方案 B：从本地 skill 包安装

本仓库的 `dist/openclaw-session-branch-ui.skill` 会生成可分发安装包。
安装后进入 skill 目录，再运行：

```bash
python scripts/install_session_branch_ui.py
```

## 安装后验证

重启 Gateway：

```bash
openclaw gateway restart
```

打开：

```text
http://127.0.0.1:4317
```

验证 API：

```bash
curl http://127.0.0.1:4317/api/health
curl http://127.0.0.1:4317/api/sessions
```

如果返回 JSON，说明 UI 已经起来了。

## 手动控制

### Windows

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\session-branch-ui\scripts\start.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\session-branch-ui\scripts\status.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\session-branch-ui\scripts\stop.ps1
```

### macOS / Linux

```bash
bash ./session-branch-ui/scripts/start.sh
bash ./session-branch-ui/scripts/status.sh
bash ./session-branch-ui/scripts/stop.sh
```

## 注意事项

- 最完整的历史恢复依赖本机 OpenClaw state/session 文件
- 纯远程 Gateway 场景下，历史完整性不如本机部署
- 如果模型侧限流或报错，UI 现在会尽量把 assistant 错误态直接显示出来，避免看起来像“没回复”

## 排障

- 页面能打开但历史不全：检查目标机器的 `~/.openclaw/agents/<agent>/sessions/`
- UI 没自动起来：重启 Gateway，并检查 `session-branch-ui/logs/`
- 发送成功但无 assistant 正文：检查是否出现模型报错/限流信息
