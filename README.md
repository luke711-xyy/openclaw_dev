# openclaw_dev

这是一个用于公开分发 `openclaw-session-branch-ui` skill 的仓库。

它把我之前做的 **Session Branch UI 完整功能版** 整理成了可复用的 AgentSkill，方便在新的 OpenClaw 环境中快速安装、复现和二次修改。

## 这个 skill 能做什么

`openclaw-session-branch-ui` 提供一套完整的 Windows 原生 OpenClaw 分支会话管理方案，包含：

- 本地 Web UI，用于管理命名分支和现有会话
- 通过 Gateway RPC 获取会话列表、历史消息、发送消息、停止运行
- 后台 PowerShell 启停脚本
- Gateway 启动时自动拉起 UI 的 hook
- 监听 Gateway 生命周期的 watcher
- 对 Gateway CLI 混入日志时的 JSON 解析兼容处理

## 仓库结构

- `skills/openclaw-session-branch-ui/`：skill 源码目录
- `dist/openclaw-session-branch-ui.skill`：打包后的 skill 文件，可直接分发

## skill 内包含的内容

在 `skills/openclaw-session-branch-ui/` 中，主要包括：

- `SKILL.md`：skill 说明与使用流程
- `scripts/install_session_branch_ui.py`：一键安装脚本
- `references/architecture.md`：架构说明
- `assets/session-branch-ui-template/`：完整的 UI 模板
- `assets/session-branch-ui-hook/`：Gateway 启动 hook 模板

## 使用方式

### 方式一：直接使用打包产物

使用仓库中的：

- `dist/openclaw-session-branch-ui.skill`

### 方式二：直接使用源码目录

直接使用：

- `skills/openclaw-session-branch-ui/`

## 安装流程（源码方式）

在目标 OpenClaw 环境中执行：

```bash
python scripts/install_session_branch_ui.py
```

如果目标环境使用自定义状态目录或 workspace：

```bash
python scripts/install_session_branch_ui.py --state-dir <state-dir> --workspace <workspace> --force
```

## 安装后验证

```powershell
openclaw gateway restart
powershell -NoProfile -ExecutionPolicy Bypass -File .\session-branch-ui\scripts\status.ps1
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4317/api/sessions
```

## 适用场景

适合以下需求：

- 想在一个 OpenClaw agent 下维护多个命名分支会话
- 想用一个本地网页快速切换会话、查看历史、发送消息
- 想把这套分支 UI 流程封装成 skill，方便迁移和复用
- 想在 Windows 原生 OpenClaw 环境里使用一套完整的 Session Branch UI 方案

## 说明

当前这份 skill 主要面向 **Windows 原生 OpenClaw** 场景。
如果后续需要，我还可以继续补：

- macOS 适配版本
- WSL2 / Linux 适配版本
- 更通用的 hook / watcher 安装逻辑
- 发布到 skills 平台所需的进一步整理
