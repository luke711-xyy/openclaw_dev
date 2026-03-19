const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const command = process.argv[2];
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const logsDir = path.join(root, 'logs');
const pidFile = path.join(dataDir, 'server.pid');
const watcherStateFile = path.join(dataDir, 'watcher-state.json');
const outLog = path.join(logsDir, 'server.out.log');
const errLog = path.join(logsDir, 'server.err.log');
const serverEntry = path.join(root, 'server.js');

function ensureDirs() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
}

function readPid(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return null;
  const pid = Number(raw);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function processAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPid(pid, includeTree = false) {
  if (!processAlive(pid)) return;

  if (process.platform === 'win32') {
    const args = ['/PID', String(pid), '/F'];
    if (includeTree) args.splice(2, 0, '/T');
    spawnSync('taskkill', args, { stdio: 'ignore', windowsHide: true });
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {}
}

function removeFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {}
}

function readWatcherState() {
  if (!fs.existsSync(watcherStateFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(watcherStateFile, 'utf8'));
  } catch {
    return null;
  }
}

function start() {
  ensureDirs();
  const existingPid = readPid(pidFile);
  if (existingPid && processAlive(existingPid)) {
    console.log(`Session Branch UI already running on PID ${existingPid}`);
    console.log('URL: http://127.0.0.1:4317');
    return 0;
  }

  removeFile(pidFile);

  const stdoutFd = fs.openSync(outLog, 'a');
  const stderrFd = fs.openSync(errLog, 'a');
  try {
    const child = spawn(process.execPath, [serverEntry], {
      cwd: root,
      detached: true,
      stdio: ['ignore', stdoutFd, stderrFd],
      windowsHide: true,
    });
    fs.writeFileSync(pidFile, String(child.pid));
    child.unref();
    console.log(`Started Session Branch UI on PID ${child.pid}`);
    console.log('URL: http://127.0.0.1:4317');
    return 0;
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
}

function stop() {
  const watcherState = readWatcherState();
  const watcherPid = Number(watcherState?.watcherPid || 0);
  if (watcherPid && processAlive(watcherPid)) {
    killPid(watcherPid, process.platform === 'win32');
    console.log(`Stopped Session Branch UI watcher (PID ${watcherPid})`);
  }
  removeFile(watcherStateFile);

  const serverPid = readPid(pidFile);
  if (!serverPid) {
    console.log('Session Branch UI is not running (no pid file).');
    return 0;
  }

  if (processAlive(serverPid)) {
    killPid(serverPid, process.platform === 'win32');
    console.log(`Stopped Session Branch UI (PID ${serverPid})`);
  } else {
    console.log(`Process ${serverPid} not found; cleaning stale pid file.`);
  }

  removeFile(pidFile);
  return 0;
}

function status() {
  const serverPid = readPid(pidFile);
  if (serverPid && processAlive(serverPid)) {
    console.log(`Session Branch UI is running on PID ${serverPid}`);
    console.log('URL: http://127.0.0.1:4317');
  } else if (serverPid) {
    console.log('Session Branch UI is stopped (stale pid file found).');
  } else {
    console.log('Session Branch UI is stopped.');
  }

  const watcherState = readWatcherState();
  const watcherPid = Number(watcherState?.watcherPid || 0);
  const watcherGatewayPid = Number(watcherState?.gatewayPid || 0);
  if (watcherPid && processAlive(watcherPid)) {
    console.log(`Watcher is running on PID ${watcherPid} for Gateway PID ${watcherGatewayPid}`);
  } else if (watcherState) {
    console.log('Watcher state exists but watcher process is not running.');
  }
  return 0;
}

const handlers = { start, stop, status };
if (!handlers[command]) {
  console.error('Usage: node scripts/control-bg.js <start|stop|status>');
  process.exit(1);
}

process.exit(handlers[command]());
