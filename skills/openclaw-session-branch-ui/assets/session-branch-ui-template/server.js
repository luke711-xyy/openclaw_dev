const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 4317);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const BRANCHES_FILE = path.join(DATA_DIR, 'branches.json');
const OPENCLAW_ENTRY = process.env.OPENCLAW_ENTRY || 'C:\\npm-global\\node_modules\\openclaw\\openclaw.mjs';

ensureDataFiles();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Session Branch UI listening on http://127.0.0.1:${PORT}`);
});

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, port: PORT });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/branches') {
    sendJson(res, 200, { branches: readBranches() });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/branches') {
    const body = await readJsonBody(req);
    const branch = createBranch(body || {});
    sendJson(res, 201, { branch });
    return;
  }

  if (req.method === 'PATCH' && url.pathname.startsWith('/api/branches/')) {
    const branchId = decodeURIComponent(url.pathname.slice('/api/branches/'.length));
    const body = await readJsonBody(req);
    const branch = updateBranch(branchId, body || {});
    sendJson(res, 200, { branch });
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/branches/')) {
    const branchId = decodeURIComponent(url.pathname.slice('/api/branches/'.length));
    deleteBranch(branchId);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    const result = await gatewayCall('sessions.list', { limit: 200 });
    sendJson(res, 200, { sessions: result.sessions || [], defaults: result.defaults || null });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/history') {
    const sessionKey = url.searchParams.get('sessionKey');
    if (!sessionKey) {
      sendJson(res, 400, { error: 'sessionKey is required' });
      return;
    }
    const result = await gatewayCall('chat.history', { sessionKey, limit: 200 });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/send') {
    const body = await readJsonBody(req);
    const sessionKey = body?.sessionKey;
    const message = body?.message;
    if (!sessionKey || !message) {
      sendJson(res, 400, { error: 'sessionKey and message are required' });
      return;
    }
    const result = await gatewayCall('chat.send', {
      sessionKey,
      message,
      deliver: false,
      idempotencyKey: `branch-ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/abort') {
    const body = await readJsonBody(req);
    const sessionKey = body?.sessionKey;
    if (!sessionKey) {
      sendJson(res, 400, { error: 'sessionKey is required' });
      return;
    }
    const result = await gatewayCall('chat.abort', { sessionKey });
    sendJson(res, 200, result);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

function serveStatic(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const safePath = path.normalize(requested).replace(/^\\+/, '').replace(/^\/+/,'');
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (error.code === 'ENOENT') {
        sendText(res, 404, 'Not found');
        return;
      }
      sendText(res, 500, 'Failed to read file');
      return;
    }

    res.writeHead(200, { 'Content-Type': getContentType(filePath) });
    res.end(data);
  });
}

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BRANCHES_FILE)) {
    fs.writeFileSync(BRANCHES_FILE, '[]\n', 'utf8');
  }
}

function readBranches() {
  const raw = fs.readFileSync(BRANCHES_FILE, 'utf8');
  const branches = JSON.parse(raw || '[]');
  return Array.isArray(branches) ? branches : [];
}

function writeBranches(branches) {
  fs.writeFileSync(BRANCHES_FILE, `${JSON.stringify(branches, null, 2)}\n`, 'utf8');
}

function createBranch(input) {
  const name = String(input.name || '').trim();
  if (!name) {
    throw new Error('Branch name is required');
  }

  const sessionKey = String(input.sessionKey || '').trim() || buildBranchSessionKey(name);
  const branches = readBranches();
  if (branches.some((branch) => branch.sessionKey === sessionKey)) {
    throw new Error('That sessionKey already exists in the branch list');
  }

  const branch = {
    id: randomUUID(),
    name,
    sessionKey,
    createdAt: Date.now(),
  };
  branches.unshift(branch);
  writeBranches(branches);
  return branch;
}

function updateBranch(branchId, input) {
  const branches = readBranches();
  const index = branches.findIndex((branch) => branch.id === branchId);
  if (index === -1) {
    throw new Error('Branch not found');
  }
  const nextName = String(input.name || '').trim();
  if (!nextName) {
    throw new Error('Branch name is required');
  }
  branches[index] = { ...branches[index], name: nextName };
  writeBranches(branches);
  return branches[index];
}

function deleteBranch(branchId) {
  const branches = readBranches();
  const next = branches.filter((branch) => branch.id !== branchId);
  if (next.length === branches.length) {
    throw new Error('Branch not found');
  }
  writeBranches(next);
}

function buildBranchSessionKey(name) {
  const slug = slugify(name);
  return `agent:main:branch:${slug}-${Date.now().toString(36)}`;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'branch';
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function gatewayCall(method, params) {
  return new Promise((resolve, reject) => {
    const child = spawn(OPENCLAW_BIN, [
      'gateway',
      'call',
      method,
      '--params',
      JSON.stringify(params || {}),
      '--json',
    ], {
      cwd: ROOT,
      windowsHide: true,
      env: process.env,
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => reject(error));

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(cleanStderr(stderr) || stdout || `Gateway call failed (${code})`));
        return;
      }

      try {
        resolve(parseGatewayJson(stdout));
      } catch (error) {
        reject(new Error(`Failed to parse gateway JSON: ${error.message}`));
      }
    });
  });
}

function parseGatewayJson(stdout) {
  const text = String(stdout || '').trim();
  if (!text) {
    throw new Error('Empty stdout');
  }

  try {
    return JSON.parse(text);
  } catch {}

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = lines[index];
    if (!(candidate.startsWith('{') || candidate.startsWith('['))) {
      continue;
    }

    try {
      return JSON.parse(candidate);
    } catch {}
  }

  const startCandidates = ['\n{', '\n[', '{', '['];
  for (const marker of startCandidates) {
    const start = text.lastIndexOf(marker);
    if (start === -1) {
      continue;
    }

    const candidate = text.slice(start + (marker.startsWith('\n') ? 1 : 0)).trim();
    try {
      return JSON.parse(candidate);
    } catch {}
  }

  throw new Error(`Unexpected output: ${text.slice(0, 200)}`);
}

function cleanStderr(stderr) {
  return String(stderr || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('Config warnings:') && !line.startsWith('- plugins.entries.feishu:'))
    .join('\n');
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}
