# openclaw_dev

This repository is now the canonical home of the `openclaw-session-branch-ui` skill.

It packages the full **Session Branch UI** workflow into a reusable AgentSkill so a fresh OpenClaw setup can install the UI, its Gateway startup hook, and its watcher with minimal manual work.

The old standalone `openclaw-session-branch-ui` repository has been archived to avoid confusion.

For the Chinese introduction, see [`README.zh-CN.md`](README.zh-CN.md).

## What this skill provides

`openclaw-session-branch-ui` installs a local Session Branch UI stack for OpenClaw, including:

- a local web UI for named branches and existing sessions
- lazy loading for older transcript history (scroll-to-top trigger with loading indicator)
- message search by keyword or timestamp
- one-click copy buttons for user and assistant messages
- Gateway websocket RPC access for session list, history, send, and abort
- background start/stop/status helpers
- a Gateway startup hook that auto-starts the UI
- a watcher that stops the UI after the Gateway exits
- compact-history recovery by merging active transcripts with same-session `.jsonl.bak.*` files
- fallback local transcript send when Gateway RPC lacks `operator.write`
- working `history-delta` updates after fallback send
- first-message bootstrap for newly created branches
- assistant error visibility when a reply only contains `errorMessage`
- session search bar filtering the "现有会话" list by name in real time
- rename and delete work for all sessions (both named branches and ordinary sessions); renaming a named branch also syncs the display name to the OpenClaw session store so the dashboard reflects the new name
- unified delete confirmation for all session types; deleting a named branch removes its transcript, cache, and session record from the OpenClaw store

## Repository layout

- `skills/openclaw-session-branch-ui/` — source skill folder
- `dist/openclaw-session-branch-ui.skill` — packaged distributable skill bundle

## Inside the skill

The skill source contains:

- `SKILL.md` — the skill entrypoint and workflow
- `README.md` — human-facing installation and publishing guide
- `scripts/install_session_branch_ui.py` — installer for workspace + hook deployment
- `references/architecture.md` — runtime and file layout notes
- `references/windows.md` — Windows-specific manual commands
- `references/macos.md` — macOS-specific manual commands
- `references/linux.md` — Linux-specific manual commands
- `assets/session-branch-ui-template/` — UI template, Gateway websocket client, watcher, and control scripts
- `assets/session-branch-ui-hook/` — Gateway startup hook template

## Supported platforms

Current support target:

- Windows-native OpenClaw
- macOS OpenClaw
- Linux OpenClaw

## Installation

### Use the packaged skill

Use the prebuilt bundle:

- `dist/openclaw-session-branch-ui.skill`

### Use the source skill

Use the source folder directly:

- `skills/openclaw-session-branch-ui/`

### Install from source

```bash
python scripts/install_session_branch_ui.py
```

With explicit paths:

```bash
python scripts/install_session_branch_ui.py --state-dir <state-dir> --workspace <workspace> --force
```

With explicit platform hints:

```bash
python scripts/install_session_branch_ui.py --platform linux
```

## Validation

After install:

```bash
openclaw gateway restart
```

Then choose your platform:

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

## Notes

- This repository contains both the source skill folder and a packaged `.skill` bundle in `dist/`
- Use the packaged bundle for the fastest installation path, or use the source folder if you want to inspect or customize the skill before installing
- Platform-specific operational details live under `skills/openclaw-session-branch-ui/references/`
