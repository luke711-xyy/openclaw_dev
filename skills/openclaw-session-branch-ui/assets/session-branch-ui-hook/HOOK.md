---
name: session-branch-ui-autostart
description: "Start Session Branch UI when the Gateway starts"
metadata:
  { "openclaw": { "emoji": "🧷", "events": ["gateway:startup"], "requires": { "bins": ["node"] } } }
---

# Session Branch UI Autostart

Starts the local `session-branch-ui` server whenever the OpenClaw Gateway finishes starting.

The hook launches the UI server directly with Node and also starts a watcher process:

- if the UI is already running, it exits quietly
- if the UI is stopped, it starts it in the background
- the watcher observes the Gateway PID and stops the UI after the Gateway exits
