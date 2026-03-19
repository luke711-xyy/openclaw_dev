const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const uiRoot = '__SESSION_BRANCH_UI_ROOT__';
const dataDir = path.join(uiRoot, 'data');
const logsDir = path.join(uiRoot, 'logs');
const pidFile = path.join(dataDir, 'server.pid');
const watcherStateFile = path.join(dataDir, 'watcher-state.json');
const serverOutLog = path.join(logsDir, 'server.out.log');
const serverErrLog = path.join(logsDir, 'server.err.log');
const watcherOutLog = path.join(logsDir, 'watcher.out.log');
const watcherErrLog = path.join(logsDir, 'watcher.err.log');
const serverEntry = path.join(uiRoot, 'server.js');
const watcherEntry = path.join(uiRoot, 'watcher.js');
const hookLog = path.join(logsDir, 'autostart-hook.log');

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

function killProcess(pid) {
  if (!processAlive(pid)) {
    return;
  }

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {}
}

function readPid(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) {
    return null;
  }

  const pid = Number(raw);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function readWatcherState() {
  if (!fs.existsSync(watcherStateFile)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(watcherStateFile, 'utf8'));
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function removeFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {}
}

function spawnDetached(entry, args, stdoutPath, stderrPath) {
  const stdoutFd = fs.openSync(stdoutPath, 'a');
  const stderrFd = fs.openSync(stderrPath, 'a');

  try {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: uiRoot,
      detached: true,
      stdio: ['ignore', stdoutFd, stderrFd],
      windowsHide: true,
    });

    child.unref();
    return child.pid;
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
}

const handler = async (event) => {
  if (event.type !== 'gateway' || event.action !== 'startup') {
    return;
  }

  if (!fs.existsSync(serverEntry) || !fs.existsSync(watcherEntry)) {
    console.warn('[session-branch-ui-autostart] session-branch-ui runtime files are missing');
    return;
  }

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  fs.appendFileSync(hookLog, `${new Date().toISOString()} event=${event.eventName || 'gateway:startup'} gatewayPid=${process.pid}\n`);

  const currentUiPid = readPid(pidFile);
  const uiRunning = currentUiPid && processAlive(currentUiPid);
  if (!uiRunning) {
    removeFile(pidFile);
  }

  const watcherState = readWatcherState();
  const watcherPid = Number(watcherState?.watcherPid || 0);
  const watcherGatewayPid = Number(watcherState?.gatewayPid || 0);
  const watcherRunning = processAlive(watcherPid);

  if (watcherRunning && watcherGatewayPid !== process.pid) {
    killProcess(watcherPid);
    removeFile(watcherStateFile);
  }

  if (!uiRunning) {
    const uiPid = spawnDetached(serverEntry, [], serverOutLog, serverErrLog);
    fs.writeFileSync(pidFile, String(uiPid));
  }

  const refreshedWatcherState = readWatcherState();
  const refreshedWatcherPid = Number(refreshedWatcherState?.watcherPid || 0);
  const refreshedWatcherGatewayPid = Number(refreshedWatcherState?.gatewayPid || 0);
  const needsWatcher = !processAlive(refreshedWatcherPid) || refreshedWatcherGatewayPid !== process.pid;

  if (needsWatcher) {
    removeFile(watcherStateFile);
    spawnDetached(watcherEntry, [String(process.pid)], watcherOutLog, watcherErrLog);
  }
};

module.exports = handler;
module.exports.default = handler;
