const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID, createHash } = require('crypto');
const { URL } = require('url');
const { GatewayWsClient } = require('./gateway-client');

const PORT = Number(process.env.PORT || 4317);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const HISTORY_CACHE_DIR = path.join(DATA_DIR, 'history-cache');
const BRANCHES_FILE = path.join(DATA_DIR, 'branches.json');
const OPENCLAW_ENTRY = process.env.OPENCLAW_ENTRY || 'C:\\npm-global\\node_modules\\openclaw\\openclaw.mjs';
const ACTIVE_WATCH_INTERVAL_MS = 5000;
const WARM_WATCH_INTERVAL_MS = 30000;
const COLD_WATCH_INTERVAL_MS = 120000;
const AUTOWATCH_SYNC_INTERVAL_MS = 60000;
const ACTIVE_DELTA_SYNC_MIN_MS = 2000;
const BACKGROUND_SYNC_STALE_MS = 10000;
const WARM_SESSION_AGE_MS = 30 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 60;
const MAX_PAGE_SIZE = 200;

const historyWatchers = new Map();
const pendingBackgroundSyncs = new Set();
const gatewayClient = new GatewayWsClient();

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
  syncAutoWatchers().catch((error) => {
    console.error(`[history-watch] bootstrap failed: ${error.message || error}`);
  });
  setInterval(() => {
    syncAutoWatchers().catch((error) => {
      console.error(`[history-watch] periodic sync failed: ${error.message || error}`);
    });
  }, AUTOWATCH_SYNC_INTERVAL_MS);
});

process.on('SIGINT', () => {
  gatewayClient.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  gatewayClient.close();
  process.exit(0);
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
    const sessions = listStoredSessions('main');
    sendJson(res, 200, { sessions, defaults: null });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/metrics') {
    sendJson(res, 200, computeMetrics());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/history/truncate') {
    const body = await readJsonBody(req);
    const sessionKey = String(body?.sessionKey || '').trim();
    const cutoffMessageId = String(body?.cutoffMessageId || '').trim();
    if (!sessionKey || !cutoffMessageId) {
      sendJson(res, 400, { error: 'sessionKey and cutoffMessageId are required' });
      return;
    }
    try {
      truncateHistory(sessionKey, cutoffMessageId);
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 500, { error: error.message || String(error) });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/watch') {
    const body = await readJsonBody(req);
    const sessionKey = String(body?.sessionKey || '').trim();
    if (!sessionKey) {
      sendJson(res, 400, { error: 'sessionKey is required' });
      return;
    }
    startHistoryWatcher(sessionKey, { active: true, updatedAt: Date.now() });
    const cache = primeHistoryCache(sessionKey);
    queueBackgroundSync(sessionKey);
    sendJson(res, 200, { ok: true, total: cache.messageCount, lastSyncAt: cache.lastSyncAt || null });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/history') {
    const sessionKey = String(url.searchParams.get('sessionKey') || '').trim();
    if (!sessionKey) {
      sendJson(res, 400, { error: 'sessionKey is required' });
      return;
    }

    const pageSize = clampInteger(url.searchParams.get('pageSize'), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const before = parseOptionalInteger(url.searchParams.get('before'));
    startHistoryWatcher(sessionKey, { active: true, updatedAt: Date.now() });
    const cache = primeHistoryCache(sessionKey);
    if (!cache.lastSyncAt || (Date.now() - cache.lastSyncAt) > BACKGROUND_SYNC_STALE_MS) {
      queueBackgroundSync(sessionKey);
    }
    const page = getHistoryPage(cache, pageSize, before);
    sendJson(res, 200, page);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/history/search') {
    const sessionKey = String(url.searchParams.get('sessionKey') || '').trim();
    const query = String(url.searchParams.get('query') || '').trim();
    if (!sessionKey) {
      sendJson(res, 400, { error: 'sessionKey is required' });
      return;
    }
    if (!query) {
      sendJson(res, 200, { results: [], lastSyncAt: null });
      return;
    }

    const limit = clampInteger(url.searchParams.get('limit'), 8, 1, 20);
    startHistoryWatcher(sessionKey, { active: true, updatedAt: Date.now() });
    let cache = primeHistoryCache(sessionKey);
    if (!cache.lastSyncAt || (Date.now() - cache.lastSyncAt) >= ACTIVE_DELTA_SYNC_MIN_MS) {
      cache = await syncCacheFromRecentHistory(sessionKey, cache);
    }
    const results = searchHistory(cache, query, limit);
    sendJson(res, 200, { results, lastSyncAt: cache.lastSyncAt });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/history-delta') {
    const sessionKey = String(url.searchParams.get('sessionKey') || '').trim();
    if (!sessionKey) {
      sendJson(res, 400, { error: 'sessionKey is required' });
      return;
    }

    const afterId = String(url.searchParams.get('afterId') || '').trim();
    startHistoryWatcher(sessionKey, { active: true, updatedAt: Date.now() });
    let cache = primeHistoryCache(sessionKey);

    // ── Always check transcript for changes ──────────────────────────────
    // When RPC has no scope, chat.history fails and the cache goes stale.
    // We handle two cases:
    //  1. Incremental: transcript has grown → read only the new bytes and append.
    //  2. Truncated: transcript got smaller (reset) → full rebuild from transcript.
    let rpcFailed = false;
    if (!cache.lastSyncAt || (Date.now() - cache.lastSyncAt) >= ACTIVE_DELTA_SYNC_MIN_MS) {
      try {
        cache = await syncCacheFromRecentHistory(sessionKey, cache);
      } catch (error) {
        rpcFailed = true;
        console.warn(`[delta] RPC sync failed (${error?.message}), using direct transcript scan`);
      }
    }

    const sessionInfo = getSessionEntry(sessionKey);
    if (!sessionInfo?.transcriptPath || !fs.existsSync(sessionInfo.transcriptPath)) {
      const delta = getHistoryDelta(cache, afterId);
      sendJson(res, 200, delta);
      return;
    }

    const stats = fs.statSync(sessionInfo.transcriptPath);

    // Always compare cached transcript size vs actual — even when RPC "succeeded"
    // (the RPC might return stale data). This keeps delta fresh without extra cost.
    if (stats.size > (cache.transcriptSize || 0)) {
      // ── Incremental append from transcript tail ──────────────────────
      try {
        const fd = fs.openSync(sessionInfo.transcriptPath, 'r');
        const deltaBytes = stats.size - (cache.transcriptSize || 0);
        const buffer = Buffer.alloc(deltaBytes);
        fs.readSync(fd, buffer, 0, deltaBytes, cache.transcriptSize || 0);
        fs.closeSync(fd);
        const raw = buffer.toString('utf8');
        const lines = raw.split(/\r?\n/).filter(Boolean);
        const appended = parseTranscriptLines(lines, cache.trimFloor);

        if (appended.length > 0) {
          const messagesPath = historyCacheMessagesPath(sessionKey);
          const baseOffset = fs.existsSync(messagesPath)
            ? fs.statSync(messagesPath).size
            : 0;
          let offset = baseOffset;
          const newIndex = [];
          for (const msg of appended) {
            const line = `${JSON.stringify(msg)}\n`;
            const length = Buffer.byteLength(line, 'utf8');
            fs.appendFileSync(messagesPath, line, 'utf8');
            newIndex.push({ id: msg.id, role: msg.role, timestamp: msg.timestamp, offset, length });
            offset += length;
          }
          cache = {
            ...cache,
            transcriptPath: sessionInfo.transcriptPath,
            transcriptSources: resolveTranscriptSources(sessionInfo.transcriptPath),
            transcriptSourcesSignature: buildTranscriptSourcesSignature(resolveTranscriptSources(sessionInfo.transcriptPath)),
            transcriptSize: stats.size,
            transcriptLineCount: (cache.transcriptLineCount || 0) + lines.length,
            messageIndex: [...(cache.messageIndex || []), ...newIndex],
            messageCount: (cache.messageCount || 0) + appended.length,
            newestMessageId: appended[appended.length - 1].id,
            lastSyncAt: Date.now(),
            updatedAt: Date.now(),
          };
          writeHistoryCache(cache);
        } else {
          // Parsed no messages but transcript grew — still update transcriptSize
          cache.transcriptSize = stats.size;
          cache.lastSyncAt = Date.now();
          writeHistoryCache(cache);
        }
      } catch (err) {
        console.error(`[delta] incremental transcript scan failed: ${err?.message}`);
      }
    } else if (stats.size < (cache.transcriptSize || 0)) {
      // ── Transcript was truncated — full rebuild ───────────────────────
      try {
        const rebuilt = normalizeTranscriptMessages(sessionInfo.transcriptPath, cache.trimFloor);
        const artifacts = writeMessageLog(sessionKey, rebuilt.messages);
        cache = {
          ...cache,
          sessionId: sessionInfo.entry?.sessionId || cache.sessionId,
          transcriptPath: sessionInfo.transcriptPath,
          transcriptSources: resolveTranscriptSources(sessionInfo.transcriptPath),
          transcriptSourcesSignature: buildTranscriptSourcesSignature(resolveTranscriptSources(sessionInfo.transcriptPath)),
          transcriptSize: rebuilt.transcriptSize,
          transcriptLineCount: rebuilt.transcriptLineCount,
          messageIndex: artifacts.messageIndex,
          messageCount: artifacts.messageCount,
          newestMessageId: artifacts.newestMessageId,
          lastSyncAt: Date.now(),
          updatedAt: Date.now(),
        };
        writeHistoryCache(cache);
      } catch (err) {
        console.error(`[delta] transcript rebuild failed: ${err?.message}`);
      }
    }

    const delta = getHistoryDelta(cache, afterId);
    sendJson(res, 200, delta);
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

    // Try RPC first; on scope error fall back to direct transcript write
    let rpcOk = false;
    let rpcError = null;
    try {
      const result = await gatewayCall('chat.send', {
        sessionKey,
        message,
        deliver: false,
        idempotencyKey: `branch-ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
      rpcOk = true;
      await ensureHistoryCache(sessionKey, { watch: true });
      sendJson(res, 200, { ok: true, result });
      return;
    } catch (err) {
      rpcError = err?.message || String(err);
      const scopeMissing = /missing scope/i.test(rpcError);
      if (!scopeMissing) {
        sendJson(res, 502, { error: 'gateway error', detail: rpcError });
        return;
      }
      // Fall-through: scope missing → write directly to transcript + local cache
    }

    // ── Fallback: direct transcript append ──────────────────────────────────
    console.warn(`[send] RPC scope error (${rpcError}), falling back to direct transcript write`);
    const { agentId, entry, transcriptPath } = ensureLocalSessionEntry(sessionKey);
    const sessionId = entry?.sessionId;
    if (!sessionId || !transcriptPath) {
      sendJson(res, 404, { error: 'session not found' });
      return;
    }

    const sessionsDir = resolveSessionsDirForAgent(agentId);
    if (!fs.existsSync(transcriptPath)) {
      sendJson(res, 404, { error: 'transcript file not found' });
      return;
    }

    // Read last line to get parentId
    let parentId = null;
    try {
      const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
      if (lines.length > 0) {
        const last = JSON.parse(lines[lines.length - 1]);
        parentId = last.id || null;
      }
    } catch { /* ignore */ }

    const msgId = randomUUID().replace(/-/g, '').slice(0, 16);
    const ts = new Date().toISOString();
    const tsMs = Date.now();
    const msgEntry = {
      type: 'message',
      id: msgId,
      parentId,
      timestamp: ts,
      message: {
        role: 'user',
        content: [{ type: 'text', text: message }],
        timestamp: tsMs,
      },
    };

    fs.appendFileSync(transcriptPath, JSON.stringify(msgEntry) + '\n', 'utf8');

    // Keep transcriptSize in cache in sync so the delta path detects growth
    cache = readHistoryCache(sessionKey);
    const newStats = fs.statSync(transcriptPath);
    cache.transcriptSize = newStats.size;
    cache.transcriptLineCount = (cache.transcriptLineCount || 0) + 1;

    // ── Update local history cache directly ──────────────────────────────
    // Bypass chat.history RPC: write the new message straight into the
    // session's local history-cache so the UI sees it immediately.
    // IMPORTANT: cache message format is NORMALIZED ({ id, role, text, timestamp }),
    // not raw transcript event format.
    try {
      const sessionInfo = getSessionEntry(sessionKey);
      const transcriptSources = resolveTranscriptSources(sessionInfo.transcriptPath);
      let cache = readHistoryCache(sessionKey);
      cache = {
        ...cache,
        transcriptSourcesSignature: buildTranscriptSourcesSignature(transcriptSources),
        transcriptPath: sessionInfo.transcriptPath,
        sessionId: sessionInfo.entry?.sessionId || cache.sessionId,
      };

      const normalizedMessage = createNormalizedMessage('user', message, tsMs);
      if (normalizedMessage) {
        const messagesPath = historyCacheMessagesPath(sessionKey);
        const normalizedLine = JSON.stringify(normalizedMessage) + '\n';
        const offset = fs.existsSync(messagesPath)
          ? fs.statSync(messagesPath).size
          : 0;
        const length = Buffer.byteLength(normalizedLine, 'utf8');

        fs.appendFileSync(messagesPath, normalizedLine, 'utf8');

        cache.messageIndex = [...(cache.messageIndex || []), {
          id: normalizedMessage.id,
          role: normalizedMessage.role,
          timestamp: normalizedMessage.timestamp,
          offset,
          length,
        }];
        cache.messageCount = cache.messageIndex.length;
        cache.newestMessageId = normalizedMessage.id;
        cache.lastSyncAt = Date.now();
        cache.updatedAt = Date.now();
        writeHistoryCache(cache);
      }

      startHistoryWatcher(sessionKey, { active: true, updatedAt: Date.now() });
    } catch (err) {
      console.error(`[send] local cache update failed (non-fatal): ${err?.message || err}`);
    }

    sendJson(res, 200, { ok: true, fallback: true, id: msgId });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/abort') {
    const body = await readJsonBody(req);
    const sessionKey = body?.sessionKey;
    if (!sessionKey) {
      sendJson(res, 400, { error: 'sessionKey is required' });
      return;
    }
    try {
      const result = await gatewayCall('chat.abort', { sessionKey });
      sendJson(res, 200, result);
    } catch (err) {
      const text = String(err?.message || err);
      if (/missing scope/i.test(text)) {
        sendJson(res, 200, { ok: true, fallback: true, note: 'abort skipped - no operator.write scope' });
      } else {
        sendJson(res, 502, { error: 'abort failed', detail: text });
      }
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

function serveStatic(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const safePath = path.normalize(requested).replace(/^\\+/, '').replace(/^\/+/, '');
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
  fs.mkdirSync(HISTORY_CACHE_DIR, { recursive: true });
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
  syncAutoWatchers().catch((error) => {
    console.error(`[history-watch] create sync failed: ${error.message || error}`);
  });
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
  syncAutoWatchers().catch((error) => {
    console.error(`[history-watch] delete sync failed: ${error.message || error}`);
  });
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
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function gatewayCall(method, params) {
  return gatewayClient.request(method, params);
}

function clampInteger(value, fallback, min, max) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

function parseOptionalInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) ? numeric : null;
}

function resolveAgentIdFromSessionKey(sessionKey) {
  const match = /^agent:([^:]+):/.exec(sessionKey);
  return match?.[1] || 'main';
}

function resolveSessionsDirForAgent(agentId) {
  return path.join(process.env.USERPROFILE || process.env.HOME || ROOT, '.openclaw', 'agents', agentId, 'sessions');
}

function readSessionStore(agentId) {
  const sessionsDir = resolveSessionsDirForAgent(agentId);
  const storePath = path.join(sessionsDir, 'sessions.json');
  if (!fs.existsSync(storePath)) {
    return { sessionsDir, store: {}, storePath };
  }

  try {
    const raw = fs.readFileSync(storePath, 'utf8');
    return { sessionsDir, store: JSON.parse(raw || '{}') || {}, storePath };
  } catch {
    return { sessionsDir, store: {}, storePath };
  }
}

function writeSessionStore(agentId, store) {
  const { storePath, sessionsDir } = readSessionStore(agentId);
  fs.mkdirSync(sessionsDir, { recursive: true });
  const tempPath = `${storePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, storePath);
}

function ensureLocalSessionEntry(sessionKey) {
  const existing = getSessionEntry(sessionKey);
  if (existing.entry?.sessionId && existing.transcriptPath) {
    return existing;
  }

  const agentId = resolveAgentIdFromSessionKey(sessionKey);
  const { sessionsDir, store } = readSessionStore(agentId);
  const template = store[`agent:${agentId}:main`] || Object.values(store).find((entry) => entry?.chatType === 'direct') || null;
  const sessionId = randomUUID();
  const transcriptPath = path.join(sessionsDir, `${sessionId}.jsonl`);
  fs.mkdirSync(sessionsDir, { recursive: true });
  if (!fs.existsSync(transcriptPath)) {
    fs.writeFileSync(transcriptPath, '', 'utf8');
  }

  const entry = {
    ...(template || {}),
    sessionId,
    updatedAt: Date.now(),
    systemSent: template?.systemSent ?? true,
    abortedLastRun: false,
    chatType: template?.chatType || 'direct',
    deliveryContext: template?.deliveryContext || { channel: 'webchat' },
    lastChannel: template?.lastChannel || template?.deliveryContext?.channel || 'webchat',
    origin: template?.origin || { provider: 'webchat', surface: 'webchat', chatType: 'direct' },
    sessionFile: transcriptPath,
    compactionCount: template?.compactionCount ?? 0,
  };
  delete entry.displayName;
  store[sessionKey] = entry;
  writeSessionStore(agentId, store);
  return { agentId, sessionsDir, entry, transcriptPath };
}

function getSessionEntry(sessionKey) {
  const agentId = resolveAgentIdFromSessionKey(sessionKey);
  const { sessionsDir, store } = readSessionStore(agentId);
  const entry = store[sessionKey];
  if (!entry) {
    return { agentId, sessionsDir, entry: null, transcriptPath: null };
  }

  const transcriptPath = entry.sessionFile || (entry.sessionId ? path.join(sessionsDir, `${entry.sessionId}.jsonl`) : null);
  return { agentId, sessionsDir, entry, transcriptPath };
}

function listStoredSessions(agentId = 'main') {
  const { store } = readSessionStore(agentId);
  return Object.entries(store)
    .map(([key, entry]) => ({
      key,
      updatedAt: entry.updatedAt || 0,
      sessionId: entry.sessionId || null,
      kind: entry.chatType || 'other',
      lastChannel: entry.lastChannel || entry.origin?.provider || null,
      displayName: entry.displayName || entry.origin?.label || key,
      origin: entry.origin || null,
      transcriptPath: entry.sessionFile || null,
    }))
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
}

function historyCacheFilePath(sessionKey) {
  const hash = createHash('sha1').update(sessionKey).digest('hex');
  return path.join(HISTORY_CACHE_DIR, `${hash}.json`);
}

function historyCacheMessagesPath(sessionKey) {
  const hash = createHash('sha1').update(sessionKey).digest('hex');
  return path.join(HISTORY_CACHE_DIR, `${hash}.messages.jsonl`);
}

function emptyHistoryCache(sessionKey) {
  return {
    version: 3,
    sessionKey,
    sessionId: null,
    transcriptPath: null,
    transcriptSources: [],
    transcriptSourcesSignature: null,
    transcriptSize: 0,
    transcriptLineCount: 0,
    messageCount: 0,
    newestMessageId: null,
    messageIndex: [],
    trimFloor: null,
    lastSyncAt: null,
    updatedAt: null,
  };
}

function compareMessageOrder(left, right) {
  const leftTs = Number(left?.timestamp || 0);
  const rightTs = Number(right?.timestamp || 0);
  if (leftTs !== rightTs) {
    return leftTs - rightTs;
  }
  return String(left?.id || '').localeCompare(String(right?.id || ''));
}

function filterMessagesByTrim(messages, trimFloor) {
  if (!trimFloor || !trimFloor.id) {
    return messages;
  }
  return messages.filter((message) => compareMessageOrder(message, trimFloor) > 0);
}

function buildMessageLogArtifacts(messages) {
  const normalized = mergeMessages([], messages);
  let offset = 0;
  const lines = [];
  const messageIndex = [];
  for (const message of normalized) {
    const line = `${JSON.stringify(message)}\n`;
    const length = Buffer.byteLength(line, 'utf8');
    lines.push(line);
    messageIndex.push({
      id: message.id,
      role: message.role,
      timestamp: message.timestamp,
      offset,
      length,
    });
    offset += length;
  }
  return {
    normalized,
    raw: lines.join(''),
    messageIndex,
    messageCount: normalized.length,
    newestMessageId: normalized.length ? normalized[normalized.length - 1].id : null,
  };
}

function writeMessageLog(sessionKey, messages) {
  const filePath = historyCacheMessagesPath(sessionKey);
  const tempPath = `${filePath}.tmp`;
  const artifacts = buildMessageLogArtifacts(messages);
  fs.writeFileSync(tempPath, artifacts.raw, 'utf8');
  fs.renameSync(tempPath, filePath);
  return artifacts;
}

function appendMessageLog(sessionKey, cache, incomingMessages) {
  const existingIds = new Set(cache.messageIndex.map((entry) => entry.id));
  const appended = incomingMessages.filter((message) => message && message.id && !existingIds.has(message.id));
  if (!appended.length) {
    return cache;
  }

  appended.sort((left, right) => {
    if (left.timestamp !== right.timestamp) {
      return left.timestamp - right.timestamp;
    }
    return String(left.id).localeCompare(String(right.id));
  });

  const filePath = historyCacheMessagesPath(sessionKey);
  const baseOffset = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  let offset = baseOffset;
  let raw = '';
  const additions = [];
  for (const message of appended) {
    const line = `${JSON.stringify(message)}\n`;
    const length = Buffer.byteLength(line, 'utf8');
    raw += line;
    additions.push({ id: message.id, role: message.role, timestamp: message.timestamp, offset, length });
    offset += length;
  }
  fs.appendFileSync(filePath, raw, 'utf8');
  return {
    ...cache,
    messageIndex: [...cache.messageIndex, ...additions],
    messageCount: cache.messageCount + additions.length,
    newestMessageId: additions[additions.length - 1].id,
    updatedAt: Date.now(),
  };
}

function readMessagesRange(sessionKey, cache, start, end) {
  const filePath = historyCacheMessagesPath(sessionKey);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const stats = fs.statSync(filePath);
  const fd = fs.openSync(filePath, 'r');
  try {
    const slice = cache.messageIndex.slice(start, end);
    return slice.map((entry, index) => {
      const nextEntry = slice[index + 1];
      const length = nextEntry ? nextEntry.offset - entry.offset : (entry.length || (stats.size - entry.offset));
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, entry.offset);
      return JSON.parse(buffer.toString('utf8').trim());
    });
  } finally {
    fs.closeSync(fd);
  }
}

function migrateInlineMessagesCache(sessionKey, parsed) {
  const inlineMessages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const normalized = mergeMessages([], inlineMessages.map((message) => createNormalizedMessage(message.role, message.text, message.timestamp)).filter(Boolean));
  const artifacts = writeMessageLog(sessionKey, normalized);
  const migrated = {
    ...emptyHistoryCache(sessionKey),
    ...parsed,
    version: 3,
    sessionKey,
    messageIndex: artifacts.messageIndex,
    messageCount: artifacts.messageCount,
    newestMessageId: artifacts.newestMessageId,
  };
  delete migrated.messages;
  const metaPath = historyCacheFilePath(sessionKey);
  const tempPath = `${metaPath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(migrated, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, metaPath);
  return migrated;
}

function readHistoryCache(sessionKey) {
  const filePath = historyCacheFilePath(sessionKey);
  if (!fs.existsSync(filePath)) {
    return emptyHistoryCache(sessionKey);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') {
      return emptyHistoryCache(sessionKey);
    }
    if (Array.isArray(parsed.messages)) {
      return migrateInlineMessagesCache(sessionKey, parsed);
    }
    return {
      ...emptyHistoryCache(sessionKey),
      ...parsed,
      version: 3,
      sessionKey,
      transcriptSources: Array.isArray(parsed.transcriptSources) ? parsed.transcriptSources : [],
      transcriptSourcesSignature: typeof parsed.transcriptSourcesSignature === 'string' ? parsed.transcriptSourcesSignature : null,
      messageIndex: Array.isArray(parsed.messageIndex) ? parsed.messageIndex : [],
      messageCount: Number.isFinite(parsed.messageCount) ? parsed.messageCount : (Array.isArray(parsed.messageIndex) ? parsed.messageIndex.length : 0),
      newestMessageId: parsed.newestMessageId || null,
    };
  } catch {
    return emptyHistoryCache(sessionKey);
  }
}

function writeHistoryCache(cache) {
  const filePath = historyCacheFilePath(cache.sessionKey);
  const tempPath = `${filePath}.tmp`;
  const payload = { ...cache };
  delete payload.messages;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function isMissingSessionError(error) {
  const text = String(error?.message || error || '').toLowerCase();
  return text.includes('not found') || text.includes('unknown session') || text.includes('sessionkey') || text.includes('missing session');
}

function sanitizeText(text) {
  return String(text || '')
    .replace(/^\s*\[\[\s*reply_to[^\]]*\]\]\s*/i, '')
    .replace(/^\s*Sender \(untrusted metadata\):\s*```json[\s\S]*?```\s*/i, '')
    .trim();
}

function extractRenderableText(content) {
  if (!Array.isArray(content)) {
    return sanitizeText(content || '');
  }

  const parts = [];
  for (const chunk of content) {
    if (!chunk || typeof chunk !== 'object') {
      continue;
    }
    if (chunk.type === 'text' && chunk.text) {
      parts.push(sanitizeText(chunk.text));
    }
  }

  return parts.filter(Boolean).join('\n\n').trim();
}

function normalizeTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

function createNormalizedMessage(role, text, timestamp) {
  const cleanText = sanitizeText(text);
  if (!cleanText) {
    return null;
  }
  const ts = normalizeTimestamp(timestamp);
  const id = createHash('sha1').update(`${role}|${ts}|${cleanText}`).digest('hex').slice(0, 16);
  return {
    id,
    role,
    text: cleanText,
    timestamp: ts,
  };
}

function extractMessageTextPayload(message) {
  if (!message) {
    return '';
  }
  const directText = extractRenderableText(message.text || '');
  if (directText) {
    return directText;
  }
  const contentText = extractRenderableText(message.content || '');
  if (contentText) {
    return contentText;
  }
  if (message.role === 'assistant' && message.errorMessage) {
    return `[error] ${String(message.errorMessage)}`;
  }
  return '';
}

function normalizeChatHistoryMessages(rawMessages, trimFloor = null) {
  const normalized = [];
  for (const message of Array.isArray(rawMessages) ? rawMessages : []) {
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) {
      continue;
    }
    const text = extractMessageTextPayload(message);
    const normalizedMessage = createNormalizedMessage(message.role, text, message.timestamp);
    if (normalizedMessage) {
      normalized.push(normalizedMessage);
    }
  }
  return filterMessagesByTrim(normalized, trimFloor);
}

function parseTranscriptLines(lines, trimFloor = null) {
  const normalized = [];
  for (const line of lines) {
    if (!line) {
      continue;
    }

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event?.type !== 'message' || !event.message || (event.message.role !== 'user' && event.message.role !== 'assistant')) {
      continue;
    }

    const text = extractMessageTextPayload(event.message);
    const normalizedMessage = createNormalizedMessage(event.message.role, text, event.message.timestamp || event.timestamp);
    if (normalizedMessage) {
      normalized.push(normalizedMessage);
    }
  }
  return filterMessagesByTrim(normalized, trimFloor);
}

function normalizeTranscriptMessages(transcriptPath, trimFloor = null) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return { messages: [], transcriptSize: 0, transcriptLineCount: 0 };
  }

  const raw = fs.readFileSync(transcriptPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  return {
    messages: parseTranscriptLines(lines, trimFloor),
    transcriptSize: Buffer.byteLength(raw, 'utf8'),
    transcriptLineCount: lines.length,
  };
}

function resolveTranscriptSources(transcriptPath) {
  if (!transcriptPath) {
    return [];
  }

  const normalizedPath = path.resolve(transcriptPath);
  const dir = path.dirname(normalizedPath);
  const base = path.basename(normalizedPath);
  if (!fs.existsSync(dir)) {
    return fs.existsSync(normalizedPath) ? [normalizedPath] : [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name === base || name.startsWith(`${base}.bak.`))
    .map((name) => path.join(dir, name));

  const unique = Array.from(new Set(entries));
  unique.sort((left, right) => {
    const leftIsCurrent = path.resolve(left) === normalizedPath;
    const rightIsCurrent = path.resolve(right) === normalizedPath;
    if (leftIsCurrent !== rightIsCurrent) {
      return leftIsCurrent ? 1 : -1;
    }
    try {
      return fs.statSync(left).mtimeMs - fs.statSync(right).mtimeMs;
    } catch {
      return left.localeCompare(right);
    }
  });
  return unique;
}

function buildTranscriptSourcesSignature(transcriptSources) {
  return transcriptSources
    .map((sourcePath) => path.resolve(sourcePath))
    .join('|');
}

function normalizeTranscriptSources(transcriptSources, trimFloor = null) {
  let messages = [];
  for (const sourcePath of transcriptSources) {
    const normalized = normalizeTranscriptMessages(sourcePath, trimFloor);
    messages = mergeMessages(messages, normalized.messages);
  }
  return messages;
}

function appendTranscriptMessages(transcriptPath, cache) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return cache;
  }

  const stats = fs.statSync(transcriptPath);
  if (!stats.size || stats.size === cache.transcriptSize) {
    return cache;
  }

  if (stats.size < cache.transcriptSize) {
    const rebuilt = normalizeTranscriptMessages(transcriptPath, cache.trimFloor);
    const artifacts = writeMessageLog(cache.sessionKey, rebuilt.messages);
    return {
      ...cache,
      transcriptSize: rebuilt.transcriptSize,
      transcriptLineCount: rebuilt.transcriptLineCount,
      messageIndex: artifacts.messageIndex,
      messageCount: artifacts.messageCount,
      newestMessageId: artifacts.newestMessageId,
      updatedAt: Date.now(),
    };
  }

  const fd = fs.openSync(transcriptPath, 'r');
  try {
    const deltaBytes = stats.size - cache.transcriptSize;
    const buffer = Buffer.alloc(deltaBytes);
    fs.readSync(fd, buffer, 0, deltaBytes, cache.transcriptSize);
    const raw = buffer.toString('utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const appended = parseTranscriptLines(lines, cache.trimFloor);
    const nextCache = appendMessageLog(cache.sessionKey, {
      ...cache,
      transcriptSize: stats.size,
      transcriptLineCount: cache.transcriptLineCount + lines.length,
    }, appended);
    return {
      ...nextCache,
      transcriptSize: stats.size,
      transcriptLineCount: cache.transcriptLineCount + lines.length,
      updatedAt: appended.length ? Date.now() : cache.updatedAt,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function mergeMessages(existingMessages, incomingMessages) {
  const merged = [];
  const seen = new Set();

  for (const message of [...existingMessages, ...incomingMessages]) {
    if (!message || !message.id || seen.has(message.id)) {
      continue;
    }
    seen.add(message.id);
    merged.push(message);
  }

  merged.sort((left, right) => {
    if (left.timestamp !== right.timestamp) {
      return left.timestamp - right.timestamp;
    }
    return String(left.id).localeCompare(String(right.id));
  });

  return merged;
}

async function syncCacheFromRecentHistory(sessionKey, cache) {
  let result;
  try {
    result = await gatewayCall('chat.history', { sessionKey, limit: 200 });
  } catch (error) {
    if (isMissingSessionError(error)) {
      return {
        ...cache,
        lastSyncAt: Date.now(),
      };
    }
    if (!cache.messageCount) {
      throw error;
    }
    // RPC failed but cache has messages — fall back to transcript incremental sync
    {
      const si = getSessionEntry(sessionKey);
      if (si?.transcriptPath) {
        const nextCache = appendTranscriptMessages(si.transcriptPath, cache);
        if (nextCache !== cache) {
          const finalCache = { ...nextCache, lastSyncAt: Date.now() };
          writeHistoryCache(finalCache);
          return finalCache;
        }
      }
      return { ...cache, lastSyncAt: Date.now() };
    }
  }

  const incoming = normalizeChatHistoryMessages(result.messages || [], cache.trimFloor);
  const nextCache = appendMessageLog(sessionKey, cache, incoming);
  const changed = nextCache.messageCount !== cache.messageCount;
  const finalCache = {
    ...nextCache,
    lastSyncAt: Date.now(),
    updatedAt: changed ? Date.now() : cache.updatedAt,
  };

  if (changed || !cache.lastSyncAt) {
    writeHistoryCache(finalCache);
  }
  return finalCache;
}

function primeHistoryCache(sessionKey) {
  const sessionInfo = getSessionEntry(sessionKey);
  let cache = readHistoryCache(sessionKey);
  const transcriptSources = resolveTranscriptSources(sessionInfo.transcriptPath);
  const transcriptSourcesSignature = buildTranscriptSourcesSignature(transcriptSources);

  const switchedTranscript = cache.transcriptPath !== sessionInfo.transcriptPath || cache.sessionId !== (sessionInfo.entry?.sessionId || null);
  const sourcesChanged = cache.transcriptSourcesSignature !== transcriptSourcesSignature;

  if (switchedTranscript || sourcesChanged) {
    const mergedMessages = normalizeTranscriptSources(transcriptSources, cache.trimFloor);
    const currentTranscript = normalizeTranscriptMessages(sessionInfo.transcriptPath, cache.trimFloor);
    const artifacts = writeMessageLog(sessionKey, mergedMessages);
    cache = {
      ...cache,
      sessionId: sessionInfo.entry?.sessionId || null,
      transcriptPath: sessionInfo.transcriptPath,
      transcriptSources,
      transcriptSourcesSignature,
      transcriptSize: currentTranscript.transcriptSize,
      transcriptLineCount: currentTranscript.transcriptLineCount,
      messageIndex: artifacts.messageIndex,
      messageCount: artifacts.messageCount,
      newestMessageId: artifacts.newestMessageId,
      updatedAt: Date.now(),
    };
    writeHistoryCache(cache);
    return cache;
  }

  if (sessionInfo.transcriptPath) {
    const nextCache = appendTranscriptMessages(sessionInfo.transcriptPath, cache);
    if (nextCache !== cache) {
      cache = {
        ...nextCache,
        transcriptSources,
        transcriptSourcesSignature,
      };
      writeHistoryCache(cache);
    }
  }

  return cache;
}

async function ensureHistoryCache(sessionKey, options = {}) {
  const { watch = false, auto = false, branch = false } = options;
  let cache = primeHistoryCache(sessionKey);

  if (cache.transcriptPath || cache.messageCount > 0) {
    cache = await syncCacheFromRecentHistory(sessionKey, cache);
  }

  if (watch) {
    startHistoryWatcher(sessionKey, { auto, branch });
  }

  return cache;
}

function queueBackgroundSync(sessionKey) {
  if (pendingBackgroundSyncs.has(sessionKey)) {
    return;
  }
  pendingBackgroundSyncs.add(sessionKey);
  setTimeout(async () => {
    try {
      let cache = primeHistoryCache(sessionKey);
      if (cache.transcriptPath || cache.messageCount > 0) {
        cache = await syncCacheFromRecentHistory(sessionKey, cache);
      }
    } catch (error) {
      console.error(`[history-watch] background sync failed for ${sessionKey}: ${error.message || error}`);
    } finally {
      pendingBackgroundSyncs.delete(sessionKey);
    }
  }, 0);
}

function computeWatcherTier(sessionKey, options = {}) {
  if (options.active) {
    return 'active';
  }
  if (options.updatedAt && (Date.now() - options.updatedAt) <= WARM_SESSION_AGE_MS) {
    return 'warm';
  }
  return 'cold';
}

function intervalForTier(tier) {
  if (tier === 'active') return ACTIVE_WATCH_INTERVAL_MS;
  if (tier === 'warm') return WARM_WATCH_INTERVAL_MS;
  return COLD_WATCH_INTERVAL_MS;
}

function computeMetrics() {
  const mem = process.memoryUsage();
  const cacheFiles = fs.existsSync(HISTORY_CACHE_DIR)
    ? fs.readdirSync(HISTORY_CACHE_DIR, { withFileTypes: true }).filter((entry) => entry.isFile())
    : [];
  const cacheBytes = cacheFiles.reduce((sum, entry) => {
    try {
      return sum + fs.statSync(path.join(HISTORY_CACHE_DIR, entry.name)).size;
    } catch {
      return sum;
    }
  }, 0);
  const watcherRows = Array.from(historyWatchers.values());
  return {
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
    },
    watchers: {
      total: watcherRows.length,
      active: watcherRows.filter((row) => row.tier === 'active').length,
      warm: watcherRows.filter((row) => row.tier === 'warm').length,
      cold: watcherRows.filter((row) => row.tier === 'cold').length,
    },
    cache: {
      files: cacheFiles.length,
      sizeMb: Math.round(cacheBytes / 1024 / 1024),
    },
    sessions: {
      visible: listStoredSessions('main').length,
    },
  };
}

function startHistoryWatcher(sessionKey, options = {}) {
  const { auto = false, branch = false, active = false, updatedAt = 0 } = options;
  const nextTier = computeWatcherTier(sessionKey, { active, updatedAt });
  const nextInterval = intervalForTier(nextTier);
  const existing = historyWatchers.get(sessionKey);
  if (existing) {
    if (auto) existing.auto = true;
    if (branch) existing.branch = true;
    if (active) existing.active = true;
    existing.updatedAt = Math.max(existing.updatedAt || 0, updatedAt || 0);
    if (existing.intervalMs === nextInterval) {
      return;
    }
    clearInterval(existing.timer);
    historyWatchers.delete(sessionKey);
  }

  let syncing = false;
  const watcher = {
    auto,
    branch,
    active,
    updatedAt,
    tier: nextTier,
    intervalMs: nextInterval,
    timer: null,
  };

  watcher.timer = setInterval(async () => {
    if (syncing) {
      return;
    }
    syncing = true;
    try {
      await ensureHistoryCache(sessionKey, { watch: false });
    } catch (error) {
      console.error(`[history-watch] ${sessionKey}: ${error.message || error}`);
    } finally {
      syncing = false;
    }
  }, watcher.intervalMs);

  historyWatchers.set(sessionKey, watcher);
}

function stopHistoryWatcher(sessionKey) {
  const watcher = historyWatchers.get(sessionKey);
  if (!watcher) {
    return;
  }
  clearInterval(watcher.timer);
  historyWatchers.delete(sessionKey);
}

async function fetchVisibleSessions() {
  return listStoredSessions('main');
}

async function syncAutoWatchers() {
  const branchKeys = new Set(readBranches().map((branch) => branch.sessionKey).filter(Boolean));
  const visibleSessions = await fetchVisibleSessions().catch((error) => {
    console.error(`[history-watch] sessions.list failed: ${error.message || error}`);
    return [];
  });

  const targetKeys = new Set([...branchKeys, ...visibleSessions.map((session) => session.key)]);
  const updatedAtMap = new Map(visibleSessions.map((session) => [session.key, session.updatedAt || 0]));

  for (const sessionKey of targetKeys) {
    startHistoryWatcher(sessionKey, {
      auto: true,
      branch: branchKeys.has(sessionKey),
      updatedAt: updatedAtMap.get(sessionKey) || 0,
    });
    try {
      primeHistoryCache(sessionKey);
      queueBackgroundSync(sessionKey);
    } catch (error) {
      console.error(`[history-watch] initial sync failed for ${sessionKey}: ${error.message || error}`);
    }
  }

  for (const [sessionKey, watcher] of historyWatchers.entries()) {
    if (watcher.auto && !targetKeys.has(sessionKey)) {
      stopHistoryWatcher(sessionKey);
    }
  }
}

function truncateHistory(sessionKey, cutoffMessageId) {
  const cache = readHistoryCache(sessionKey);
  const cutoffIndex = cache.messageIndex.findIndex((entry) => entry.id === cutoffMessageId);
  if (cutoffIndex === -1) {
    throw new Error('Message not found in local history cache');
  }

  const cutoffEntry = cache.messageIndex[cutoffIndex];
  const keptMessages = readMessagesRange(sessionKey, cache, cutoffIndex + 1, cache.messageCount);
  const artifacts = writeMessageLog(sessionKey, keptMessages);
  const nextCache = {
    ...cache,
    messageIndex: artifacts.messageIndex,
    messageCount: artifacts.messageCount,
    newestMessageId: artifacts.newestMessageId,
    trimFloor: {
      id: cutoffEntry.id,
      timestamp: cutoffEntry.timestamp,
    },
    updatedAt: Date.now(),
  };
  writeHistoryCache(nextCache);
  return nextCache;
}

function getHistoryPage(cache, pageSize, before) {
  const total = cache.messageCount;
  const end = before === null ? total : Math.max(0, Math.min(total, before));
  const start = Math.max(0, end - pageSize);
  const messages = readMessagesRange(cache.sessionKey, cache, start, end);
  return {
    messages,
    total,
    hasMore: start > 0,
    nextBefore: start,
    newestId: cache.newestMessageId || null,
    lastSyncAt: cache.lastSyncAt,
  };
}

function getHistoryDelta(cache, afterId) {
  const total = cache.messageCount;
  if (!afterId) {
    return {
      messages: [],
      newestId: cache.newestMessageId || null,
      resetRequired: false,
      lastSyncAt: cache.lastSyncAt,
    };
  }

  const index = cache.messageIndex.findIndex((message) => message.id === afterId);
  if (index === -1) {
    return {
      messages: [],
      newestId: cache.messageIndex?.length
        ? cache.messageIndex[cache.messageIndex.length - 1].id
        : cache.newestMessageId || null,
      resetRequired: true,
      lastSyncAt: cache.lastSyncAt,
    };
  }

  const msgs = readMessagesRange(cache.sessionKey, cache, index + 1, total);
  const lastMsg = msgs[msgs.length - 1];

  return {
    messages: msgs,
    newestId: lastMsg?.id || afterId,
    resetRequired: false,
    lastSyncAt: cache.lastSyncAt,
  };
}

function readAllCachedMessages(sessionKey) {
  const filePath = historyCacheMessagesPath(sessionKey);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function buildSearchTimestampText(timestamp) {
  const date = new Date(normalizeTimestamp(timestamp));
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ];
  return [
    `${parts[0]}-${parts[1]}-${parts[2]} ${parts[3]}:${parts[4]}:${parts[5]}`,
    `${parts[0]}/${parts[1]}/${parts[2]} ${parts[3]}:${parts[4]}:${parts[5]}`,
    date.toISOString(),
    date.toLocaleString('zh-CN', { hour12: false }),
    String(normalizeTimestamp(timestamp)),
  ].join('\n');
}

function buildSearchPreview(text) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (!compact) {
    return '[空消息]';
  }
  return compact.length > 28 ? `${compact.slice(0, 28)}…` : compact;
}

function searchHistory(cache, query, limit) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const messages = readAllCachedMessages(cache.sessionKey);
  const results = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const haystack = [
      String(message.text || ''),
      buildSearchTimestampText(message.timestamp),
    ].join('\n').toLowerCase();

    if (!haystack.includes(normalizedQuery)) {
      continue;
    }

    results.push({
      id: message.id,
      role: message.role || 'system',
      timestamp: message.timestamp,
      preview: buildSearchPreview(message.text || ''),
      position: index,
    });

    if (results.length >= limit) {
      break;
    }
  }

  return results;
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
