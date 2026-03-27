# openclaw_dev

这是现在用于公开分发 `openclaw-session-branch-ui` skill 的主仓库。

它把完整的 **Session Branch UI** 整理成了可复用的 AgentSkill，方便在新的 OpenClaw 环境中快速安装、复现和继续迭代。

之前单独的 `openclaw-session-branch-ui` 仓库已经归档，避免后续混淆。

英文说明见 [`README.md`](README.md)。

## 这个 skill 能做什么

`openclaw-session-branch-ui` 提供一套完整的 OpenClaw 分支会话管理方案，包含：

- 本地 Web UI，用于管理命名分支和现有会话
- 更早消息懒加载
- 按关键词或时间戳搜索消息
- user / assistant 消息一键复制
- 通过 Gateway websocket RPC 获取会话列表、历史消息、发送消息、停止运行
- 后台启停/状态检查脚本
- Gateway 启动时自动拉起 UI 的 hook
- 监听 Gateway 生命周期的 watcher
- 对 compact 后历史的恢复支持：会合并同会话的 `.jsonl.bak.*` 备份历史
- 当 Gateway RPC 缺少 `operator.write` 时，自动 fallback 到本地 transcript 写入
- fallback 发送后，`history-delta` 仍能正常刷新
- 新建 branch 第一次发送时自动 bootstrap 本地 session
- assistant 只有 `errorMessage` 时也会在历史中显式显示

## 仓库结构

- `skills/openclaw-session-branch-ui/`：skill 源码目录
- `dist/openclaw-session-branch-ui.skill`：打包后的 skill 文件，可直接分发

## skill 内包含的内容

在 `skills/openclaw-session-branch-ui/` 中，主要包括：

- `SKILL.md`：skill 说明与使用流程
- `README.md`：面向人类的安装与发布说明
- `scripts/install_session_branch_ui.py`：安装脚本
- `references/architecture.md`：架构说明
- `references/windows.md`：Windows 使用说明
- `references/macos.md`：macOS 使用说明
- `references/linux.md`：Linux 使用说明
- `assets/session-branch-ui-template/`：完整 UI 模板
- `assets/session-branch-ui-hook/`：Gateway 启动 hook 模板

## 平台支持

当前支持：

- Windows 原生 OpenClaw
- macOS OpenClaw
- Linux OpenClaw

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

如果希望按目标平台输出后续命令：

```bash
python scripts/install_session_branch_ui.py --platform linux
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

### macOS / Linux

```bash
bash ./session-branch-ui/scripts/status.sh
curl http://127.0.0.1:4317/api/sessions
```

## 补充说明

- 这个仓库同时提供 skill 源码目录和打包后的 `.skill` 文件
- 如果你只想快速安装，优先使用 `dist/` 里的打包产物
- 如果你想先审查或定制再安装，可以直接查看 `skills/openclaw-session-branch-ui/`
- 平台差异和运行细节放在 `skills/openclaw-session-branch-ui/references/`
