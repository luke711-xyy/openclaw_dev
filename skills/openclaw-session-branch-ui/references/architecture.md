# Session Branch UI Architecture

## What gets installed

- `workspace/session-branch-ui/`
  - `server.js`: local HTTP server + OpenClaw Gateway websocket RPC bridge
  - `gateway-client.js`: runtime discovery for the local Gateway websocket URL and auth
  - `watcher.js`: watches the Gateway PID and stops the UI when the Gateway exits
  - `public/`: front-end for branch creation, session browsing, lazy history loading, history search, copy buttons, send, and abort
  - `scripts/control-bg.js`: cross-platform background lifecycle helper
  - `scripts/start.ps1` / `scripts/status.ps1` / `scripts/stop.ps1`: Windows helpers
  - `scripts/start.sh` / `scripts/status.sh` / `scripts/stop.sh`: POSIX helpers
- `state-dir/hooks/session-branch-ui-autostart/`
  - `HOOK.md`: gateway startup hook metadata
  - `handler.js`: starts the UI and watcher when the Gateway starts

## Runtime model

1. Gateway starts.
2. `session-branch-ui-autostart` hook runs on `gateway:startup`.
3. Hook starts `session-branch-ui/server.js` if needed.
4. Hook starts `watcher.js` with the current Gateway PID.
5. `watcher.js` exits and stops the UI once the Gateway PID disappears.
6. `server.js` reads local OpenClaw session files to build durable history caches and merges compacted `.bak` transcripts when present.

## Validation commands

```bash
openclaw gateway restart
node ./session-branch-ui/scripts/control-bg.js status
curl http://127.0.0.1:4317/api/sessions
```

## Known assumptions

- Works best when installed on the same machine as the target OpenClaw state directory.
- Requires `node` and `openclaw` on `PATH`.
- Reads local OpenClaw session files directly, so pointing only at a remote Gateway is not enough for full history fidelity.
- Preserves compacted history in Branch UI by merging the current transcript with same-session `.jsonl.bak.*` files.
