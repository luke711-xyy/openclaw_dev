# Session Branch UI Architecture

## What gets installed

- `workspace/session-branch-ui/`
  - `server.js`: local HTTP server + OpenClaw Gateway RPC bridge
  - `watcher.js`: watches the Gateway PID and stops the UI when the Gateway exits
  - `public/`: front-end for branch creation, session browsing, history view, send, abort
  - `scripts/start.ps1`: background launcher
  - `scripts/status.ps1`: status check
  - `scripts/stop.ps1`: stop UI + watcher
- `state-dir/hooks/session-branch-ui-autostart/`
  - `HOOK.md`: gateway startup hook metadata
  - `handler.js`: starts the UI and watcher when the Gateway starts

## Runtime model

1. Gateway starts.
2. `session-branch-ui-autostart` hook runs on `gateway:startup`.
3. Hook starts `session-branch-ui/server.js` if needed.
4. Hook starts `watcher.js` with the current Gateway PID.
5. `watcher.js` exits and stops the UI once the Gateway PID disappears.

## Validation commands

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\session-branch-ui\scripts\status.ps1
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4317/api/sessions
openclaw gateway restart
```

## Known assumptions

- Designed for native Windows OpenClaw installs.
- Requires `node`, `powershell`, and `openclaw` on `PATH`.
- The front-end expects `openclaw gateway call ... --json` to be reachable from the UI server process.
- If plugin/config logs leak into stdout before JSON, `server.js` now recovers by parsing the trailing JSON payload.
