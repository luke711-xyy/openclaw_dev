# openclaw_dev

这是一个用于公开分发 `openclaw-session-branch-ui` skill 的仓库。

它把之前做好的 **Session Branch UI 完整功能版** 整理成了可复用的 AgentSkill，方便在新的 OpenClaw 环境中快速安装、复现和二次修改。

英文说明见 [`README.md`](README.md)。

## 这个 skill 能做什么

`openclaw-session-branch-ui` 提供一套完整的 OpenClaw 分支会话管理方案，包含：

- 本地 Web UI，用于管理命名分支和现有会话
- 通过 Gateway RPC 获取会话列表、历史消息、发送消息、停止运行
- 后台启停/状态检查脚本
- Gateway 启动时自动拉起 UI 的 hook
- 监听 Gateway 生命周期的 watcher
- 对 Gateway CLI 混入日志时的 JSON 解析兼容处理

## 仓库结构

- `skills/openclaw-session-branch-ui/`：skill 源码目录
- `dist/openclaw-session-branch-ui.skill`：打包后的 skill 文件，可直接分发

## skill 内包含的内容

在 `skills/openclaw-session-branch-ui/` 中，主要包括：

- `SKILL.md`：skill 说明与使用流程
- `scripts/install_session_branch_ui.py`：安装脚本
- `references/architecture.md`：架构说明
- `references/windows.md`：Windows 使用说明
- `references/macos.md`：macOS 使用说明
- `assets/session-branch-ui-template/`：完整 UI 模板
- `assets/session-branch-ui-hook/`：Gateway 启动 hook 模板

## 平台支持

当前支持：

- Windows 原生 OpenClaw
- macOS OpenClaw

## 使用方式

### 方式一：直接使用打包产物

使用仓库中的：

- `dist/openclaw-session-branch-ui.skill`

### 方式二：直接使用源码目录

直接使用：

- `skills/openclaw-session-branch-ui/`

## 安装流程（源码方式）

```bash
python scripts/install_session_branch_ui.py
```

如果目标环境使用自定义状态目录或 workspace：

```bash
python scripts/install_session_branch_ui.py --state-dir <state-dir> --workspace <workspace> --force
```

如果希望按 macOS 提示输出后续命令：

```bash
python scripts/install_session_branch_ui.py --platform macos
```

## 安装后验证

先重启 Gateway：

```bash
openclaw gateway restart
```

### Windows

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\session-branch-ui\scripts\status.ps1
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4317/api/sessions
```

### macOS

```bash
bash ./session-branch-ui/scripts/status.sh
curl http://127.0.0.1:4317/api/sessions
```

## 为 skills 平台发布做的整理

目前仓库已经具备较好的公开分发结构：

- 仓库根目录使用英文 README
- 中文 README 单独保留
- skill 源码结构保持简洁
- 平台差异说明拆到 `references/`
- 打包产物已放入 `dist/`

## 后续还可以继续做

- 补 UI 截图或 GIF
- 建 GitHub Release 并挂 `.skill`
- 补 Linux / WSL2 版本
- 再对 skill 元数据做一次面向平台检索优化
