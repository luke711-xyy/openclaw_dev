---
name: openclaw-session-branch-ui
description: Install a reproducible browser-based Session Branch UI for OpenClaw on Windows, macOS, or Linux. Use when the user wants one agent to manage multiple named branch conversations through a local web UI with branch CRUD, session browsing, history search, send/abort controls, fallback transcript sync, and clearer assistant error visibility.
---

# OpenClaw Session Branch UI

Install the bundled Session Branch UI into an OpenClaw workspace/state directory.
Prefer the packaged template, hook, and installer instead of rebuilding the UI manually.

## Workflow

1. Confirm the target machine has `node`, `python`, and `openclaw` on `PATH`.
2. Run `scripts/install_session_branch_ui.py` with the target `--state-dir` and `--workspace` if needed.
3. Restart Gateway so `session-branch-ui-autostart` is reloaded.
4. Verify `http://127.0.0.1:4317/api/health` and `http://127.0.0.1:4317/api/sessions` both return JSON.
5. Open the UI and validate branch creation, history loading, search, send, and abort.

## Quick Start

Default install:

```bash
python scripts/install_session_branch_ui.py
```

Custom OpenClaw paths:

```bash
python scripts/install_session_branch_ui.py --state-dir ~/.openclaw --workspace ~/.openclaw/workspace --force
```

Dry-run first:

```bash
python scripts/install_session_branch_ui.py --dry-run
```

## What this package includes

- `assets/session-branch-ui-template/`: UI server, frontend, Gateway client, watcher, and control scripts
- `assets/session-branch-ui-hook/`: Gateway startup hook
- `scripts/install_session_branch_ui.py`: installer
- `references/`: platform and architecture notes

## Important behavior

- When direct `chat.send` RPC lacks `operator.write`, the UI falls back to local transcript writes
- After fallback send, `history-delta` still updates correctly
- Assistant-side error messages are surfaced into history instead of being silently dropped
- Full history fidelity depends on local OpenClaw session files on the target machine

## Validation references

- Windows: `references/windows.md`
- macOS: `references/macos.md`
- Linux: `references/linux.md`
- Architecture: `references/architecture.md`
