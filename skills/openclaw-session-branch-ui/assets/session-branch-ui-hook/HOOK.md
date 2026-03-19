---
name: session-branch-ui-autostart
description: "Start Session Branch UI when the gateway starts"
metadata:
  { "openclaw": { "emoji": "🧷", "events": ["gateway:startup"], "requires": { "bins": ["node", "powershell"] } } }
---

# Session Branch UI Autostart

Starts the local `session-branch-ui` server whenever the OpenClaw gateway finishes starting.

The hook launches `session-branch-ui/scripts/start.ps1`, which is already idempotent:
- if the UI is already running, it exits quietly
- if the UI is stopped, it starts it in the background
