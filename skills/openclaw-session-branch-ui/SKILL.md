---
name: openclaw-session-branch-ui
description: Build and install the complete Session Branch UI stack for native Windows OpenClaw setups. Use when the user wants a local web UI for named session branches under one agent, including branch CRUD, session browsing, history view, send/abort actions, background PowerShell launch scripts, a Gateway startup hook, and a watcher that shuts the UI down after the Gateway exits.
---

# OpenClaw Session Branch UI

## Overview

Install a complete Windows-native Session Branch UI into an OpenClaw workspace/state directory.
Reuse the bundled template app, startup hook, and watcher instead of rebuilding the UI from scratch.

## Workflow

1. Confirm the target machine is a native Windows OpenClaw install with `node`, `powershell`, and `openclaw` on `PATH`.
2. Run `scripts/install_session_branch_ui.py` with the target `--state-dir` and `--workspace`.
3. Restart the Gateway so `session-branch-ui-autostart` is reloaded.
4. Verify that the UI starts and that `http://127.0.0.1:4317/api/sessions` returns JSON.
5. Open the UI and validate branch creation, history loading, send, and abort.

## Quick Start

Install into the default `~/.openclaw` layout:

```bash
python scripts/install_session_branch_ui.py
```

Install into a custom OpenClaw state/workspace layout:

```bash
python scripts/install_session_branch_ui.py --state-dir C:\Users\you\.openclaw --workspace C:\Users\you\.openclaw\workspace --force
```

Dry-run the install first:

```bash
python scripts/install_session_branch_ui.py --dry-run
```

## What the installer does

- Copy `assets/session-branch-ui-template/` into `<workspace>/session-branch-ui`
- Copy `assets/session-branch-ui-hook/` into `<state-dir>/hooks/session-branch-ui-autostart`
- Patch the hook so it points at the installed UI directory
- Create runtime folders and `data/branches.json` if missing

## Validation

Run these after install:

```powershell
openclaw gateway restart
powershell -NoProfile -ExecutionPolicy Bypass -File .\session-branch-ui\scripts\status.ps1
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4317/api/sessions
```

Expect the status script to report the UI PID and the API endpoint to return JSON session data.

## Customization

Read `references/architecture.md` when you need the file layout, lifecycle behavior, or troubleshooting context before modifying the template.

## Assets

- `assets/session-branch-ui-template/`: full UI server, front-end, watcher, and PowerShell scripts
- `assets/session-branch-ui-hook/`: Gateway startup hook that auto-starts the UI and watcher
