---
name: openclaw-session-branch-ui
description: Install a reproducible browser-based Session Branch UI for OpenClaw on Windows, macOS, or Linux. Use when the user wants one agent to manage multiple named branch conversations through a local web UI with branch CRUD, session browsing, history search, copy buttons, lazy-loaded transcript history, send/abort controls, background lifecycle helpers, a Gateway startup hook, and a watcher that stops the UI after the Gateway exits.
---

# OpenClaw Session Branch UI

Install the bundled Session Branch UI into an OpenClaw workspace/state directory.
Reuse the packaged app, startup hook, and watcher instead of rebuilding the UI manually.

## Workflow

1. Confirm the target machine has `node` and `openclaw` on `PATH`.
2. Run `scripts/install_session_branch_ui.py` with the target `--state-dir`, `--workspace`, and optional `--platform`.
3. Restart the Gateway so `session-branch-ui-autostart` is reloaded.
4. Verify that the UI starts and that `http://127.0.0.1:4317/api/sessions` returns JSON.
5. Open the UI and validate branch creation, history loading, search, send, and abort.

## Quick Start

Install into the default `~/.openclaw` layout:

```bash
python scripts/install_session_branch_ui.py
```

Install into a custom OpenClaw state/workspace layout:

```bash
python scripts/install_session_branch_ui.py --state-dir ~/.openclaw --workspace ~/.openclaw/workspace --force
```

Dry-run the install first:

```bash
python scripts/install_session_branch_ui.py --dry-run
```

Explicit Linux hints:

```bash
python scripts/install_session_branch_ui.py --platform linux
```

## What the installer does

- Copy `assets/session-branch-ui-template/` into `<workspace>/session-branch-ui`
- Copy `assets/session-branch-ui-hook/` into `<state-dir>/hooks/session-branch-ui-autostart`
- Patch the hook so it points at the installed UI directory
- Create runtime folders and `data/branches.json` if missing
- Preserve cross-platform background control scripts already bundled in the template

## Validation

Read only the platform notes you need:

- Windows manual commands: read `references/windows.md`
- macOS manual commands: read `references/macos.md`
- Linux manual commands: read `references/linux.md`
- Architecture and lifecycle: read `references/architecture.md`

## Assets

- `assets/session-branch-ui-template/`: full UI server, front-end, Gateway websocket client, watcher, and cross-platform control scripts
- `assets/session-branch-ui-hook/`: Gateway startup hook that auto-starts the UI and watcher
