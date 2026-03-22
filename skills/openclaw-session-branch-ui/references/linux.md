# Linux Notes

## Manual commands

```bash
bash ./session-branch-ui/scripts/start.sh
bash ./session-branch-ui/scripts/status.sh
bash ./session-branch-ui/scripts/stop.sh
```

## Validation

```bash
openclaw gateway restart
bash ./session-branch-ui/scripts/status.sh
curl http://127.0.0.1:4317/api/sessions
```

## Expectations

- `node` and `openclaw` must be available on `PATH`
- no PowerShell dependency is required on Linux
- the startup hook uses the same Node-based handler as other platforms
- the UI directory can live anywhere under the target OpenClaw workspace
