# openclaw_dev

This repo contains the `openclaw-session-branch-ui` skill, which packages the complete Windows-native Session Branch UI workflow for OpenClaw.

## Contents

- `skills/openclaw-session-branch-ui/` — source skill folder
- `dist/openclaw-session-branch-ui.skill` — packaged distributable skill bundle

## Purpose

Install a complete Session Branch UI stack with:

- local branch management web UI
- Gateway RPC bridge for sessions/history/send/abort
- background PowerShell scripts
- Gateway startup autostart hook
- watcher process that can stop the UI after Gateway exit
