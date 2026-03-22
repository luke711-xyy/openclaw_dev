# OpenClaw Session Branch UI

A reproducible Session Branch UI skill for OpenClaw.

This skill installs a local web UI that lets one OpenClaw agent manage multiple named branch conversations from the browser. It is designed to be reusable across Windows, macOS, and Linux.

## What it does

- Create named branches backed by stable `sessionKey` values
- Browse current visible sessions from the local Gateway
- View message history with lazy loading for older messages
- Search messages by keyword or timestamp
- Copy user/assistant messages with one click
- Abort the active run for the selected session
- Preserve compacted history by merging current transcript data with same-session `.jsonl.bak.*` files when available
- Start automatically with the Gateway through a bundled startup hook
- Stop automatically after the Gateway exits through a watcher process

## Requirements

- OpenClaw installed on the target machine
- `node` available on `PATH`
- `openclaw` available on `PATH`
- The skill must be installed on the same machine as the target OpenClaw state directory for full history fidelity

## Install the skill

### Option A: Install from ClawHub

After publication, install with:

```bash
clawhub install openclaw-session-branch-ui
```

Then run the installer from the installed skill directory.

### Option B: Install from source

Run the bundled installer:

```bash
python scripts/install_session_branch_ui.py
```

Custom target paths:

```bash
python scripts/install_session_branch_ui.py --state-dir ~/.openclaw --workspace ~/.openclaw/workspace --force
```

Dry-run first:

```bash
python scripts/install_session_branch_ui.py --dry-run
```

## After installation

Restart the Gateway so the startup hook is loaded:

```bash
openclaw gateway restart
```

Then open:

```text
http://127.0.0.1:4317
```

## Manual runtime control

### Cross-platform

```bash
node scripts/control-bg.js start
node scripts/control-bg.js status
node scripts/control-bg.js stop
```

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

## Verify it works

Check the UI process:

```bash
node scripts/control-bg.js status
```

Check the API:

```bash
curl http://127.0.0.1:4317/api/sessions
```

If that returns JSON, the UI is alive.

## How the skill is structured

- `SKILL.md`: agent-facing installation workflow
- `scripts/install_session_branch_ui.py`: installer
- `assets/session-branch-ui-template/`: actual UI app template
- `assets/session-branch-ui-hook/`: Gateway startup hook
- `references/`: platform and architecture notes

## Important behavior

- The UI reads local OpenClaw session files directly for durable history caching
- Remote Gateway-only setups are not enough if you want complete transcript history
- `/compact` history is preserved in Branch UI by merging the active transcript with compacted backup files when present

## Publish to ClawHub

Before publishing:

```bash
clawhub login
clawhub whoami
```

Publish command template:

```bash
clawhub publish ./openclaw-session-branch-ui \
  --slug openclaw-session-branch-ui \
  --name "OpenClaw Session Branch UI" \
  --version 1.2.0 \
  --changelog "Initial public release: cross-platform installer, history search, compact-history recovery, and Gateway autostart hook"
```

## Suggested tags / positioning

Good fit for users who want:

- branch-style conversations in one agent
- a local browser UI for session management
- reproducible installation across multiple devices
- a better workflow for long-running OpenClaw sessions

## Troubleshooting

- If the page opens but history looks incomplete, verify the target machine has the right `~/.openclaw/agents/<agent>/sessions/` data
- If the UI does not start after install, restart the Gateway and inspect `session-branch-ui/logs/`
- If `clawhub publish` fails, verify login state with `clawhub whoami`
