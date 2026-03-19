const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const uiRoot = __dirname;
const dataDir = path.join(uiRoot, 'data');
const logsDir = path.join(uiRoot, 'logs');
const pidFile = path.join(dataDir, 'server.pid');
const watcherStateFile = path.join(dataDir, 'watcher-state.json');
const watcherLog = path.join(logsDir, 'watcher.log');
const gatewayPid = Number(process.argv[2] || '');
const intervalMs = Number(process.env.SESSION_BRANCH_UI_WATCHER_INTERVAL_MS || '2000');

if (!Number.isFinite(gatewayPid) || gatewayPid <= 0) {
  process.exit(1);
}

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });

function log(message) {
  fs.appendFileSync(watcherLog, `${new Date().toISOString()} ${message}\n`);
}

function processAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readUiPid() {
  if (!fs.existsSync(pidFile)) {
    return null;
  }

  const raw = fs.readFileSync(pidFile, 'utf8').trim();
  if (!raw) {
    return null;
  }

  const pid = Number(raw);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function removeFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {}
}

function cleanup() {
  removeFile(watcherStateFile);
}

function stopUi() {
  const uiPid = readUiPid();
  if (uiPid && processAlive(uiPid)) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(uiPid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      try {
        process.kill(uiPid, 'SIGTERM');
      } catch {}
    }
  }

  removeFile(pidFile);
}

function shutdown(code) {
  cleanup();
  process.exit(code);
}

fs.writeFileSync(
  watcherStateFile,
  `${JSON.stringify({ watcherPid: process.pid, gatewayPid, startedAt: Date.now() }, null, 2)}\n`,
  'utf8',
);

log(`watcher started watcherPid=${process.pid} gatewayPid=${gatewayPid}`);

const timer = setInterval(() => {
  const uiPid = readUiPid();

  if (!processAlive(gatewayPid)) {
    log(`gateway exited gatewayPid=${gatewayPid}; stopping ui`);
    stopUi();
    shutdown(0);
  }

  if (!uiPid) {
    log('ui pid missing; watcher exiting');
    shutdown(0);
  }

  if (!processAlive(uiPid)) {
    log(`ui exited uiPid=${uiPid}; cleaning up watcher`);
    removeFile(pidFile);
    shutdown(0);
  }
}, intervalMs);

timer.unref();

for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(signal, () => {
    log(`watcher received ${signal}; exiting`);
    shutdown(0);
  });
}

process.on('exit', cleanup);
