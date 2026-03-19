# openclaw_dev

This repository publishes the `openclaw-session-branch-ui` skill.

It packages the complete **Session Branch UI** workflow into a reusable AgentSkill so a fresh OpenClaw setup can install the UI, its startup hook, and its watcher with minimal manual work.

For the Chinese introduction, see [`README.zh-CN.md`](README.zh-CN.md).

## What this skill provides

`openclaw-session-branch-ui` installs a local Session Branch UI stack for OpenClaw, including:

- a local web UI for named branches and existing sessions
- Gateway RPC access for session list, history, send, and abort
- background start/stop/status helpers
- a Gateway startup hook that auto-starts the UI
- a watcher that stops the UI after the Gateway exits
- JSON parsing compatibility when Gateway CLI logs leak into stdout before JSON

## Repository layout

- `skills/openclaw-session-branch-ui/` — source skill folder
- `dist/openclaw-session-branch-ui.skill` — packaged distributable skill bundle

## Inside the skill

The skill source contains:

- `SKILL.md` — the skill entrypoint and workflow
- `scripts/install_session_branch_ui.py` — installer for workspace + hook deployment
- `references/architecture.md` — runtime and file layout notes
- `references/windows.md` — Windows-specific manual commands
- `references/macos.md` — macOS-specific manual commands
- `assets/session-branch-ui-template/` — UI template, watcher, and control scripts
- `assets/session-branch-ui-hook/` — Gateway startup hook template

## Supported platforms

Current support target:

- Windows-native OpenClaw
- macOS OpenClaw

The same skill package now includes both Windows and macOS operator flows.

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

With explicit macOS hints:

```bash
python scripts/install_session_branch_ui.py --platform macos
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

### macOS

```bash
bash ./session-branch-ui/scripts/status.sh
curl http://127.0.0.1:4317/api/sessions
```

## Publishing readiness

This repository is already arranged for public distribution:

- public English README at the repository root
- Chinese README preserved separately
- source skill folder kept clean and self-contained
- packaged `.skill` artifact committed in `dist/`
- platform-specific guidance moved into `references/`

## Next possible improvements

Useful follow-ups if this is going to be published more broadly:

- add screenshots or demo GIFs for the UI
- create a GitHub Release and attach the `.skill` bundle
- add Linux / WSL2 adaptation
- publish to a skills directory or marketplace once the final metadata is confirmed
