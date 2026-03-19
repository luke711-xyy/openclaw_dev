# Windows Notes

## Manual commands

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\session-branch-ui\scripts\start.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\session-branch-ui\scripts\status.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\session-branch-ui\scripts\stop.ps1
```

## Validation

```powershell
openclaw gateway restart
powershell -NoProfile -ExecutionPolicy Bypass -File .\session-branch-ui\scripts\status.ps1
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4317/api/sessions
```
