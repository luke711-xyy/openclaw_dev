const state = {
  branches: [],
  sessions: [],
  active: null,
  activeHistoryKey: null,
  historyTimer: null,
  sessionTimer: null,
};

const elements = {
  branchesList: document.getElementById('branches-list'),
  sessionsList: document.getElementById('sessions-list'),
  messages: document.getElementById('messages'),
  activeTitle: document.getElementById('active-title'),
  activeKey: document.getElementById('active-key'),
  status: document.getElementById('status'),
  composerInput: document.getElementById('composer-input'),
  sendButton: document.getElementById('send-button'),
  refreshAll: document.getElementById('refresh-all'),
  createBranchForm: document.getElementById('create-branch-form'),
  branchName: document.getElementById('branch-name'),
  renameBranch: document.getElementById('rename-branch'),
  deleteBranch: document.getElementById('delete-branch'),
  abortRun: document.getElementById('abort-run'),
  itemTemplate: document.getElementById('item-template'),
};

boot();

async function boot() {
  bindEvents();
  window.addEventListener('unhandledrejection', (event) => {
    setStatus(event.reason?.message || '请求失败');
  });
  await guard(refreshAll);
  state.sessionTimer = setInterval(() => guard(refreshSessions), 10000);
}

function bindEvents() {
  elements.refreshAll.addEventListener('click', () => guard(refreshAll));
  elements.createBranchForm.addEventListener('submit', (event) => guard(() => onCreateBranch(event)));
  elements.sendButton.addEventListener('click', () => guard(onSend));
  elements.renameBranch.addEventListener('click', () => guard(onRenameBranch));
  elements.deleteBranch.addEventListener('click', () => guard(onDeleteBranch));
  elements.abortRun.addEventListener('click', () => guard(onAbort));
}

async function refreshAll() {
  setStatus('正在刷新…');
  await Promise.all([refreshBranches(), refreshSessions()]);
  if (!state.active) {
    const firstBranch = state.branches[0];
    const firstSession = state.sessions[0];
    if (firstBranch) {
      selectItem({ type: 'branch', data: firstBranch });
    } else if (firstSession) {
      selectItem({ type: 'session', data: firstSession });
    } else {
      renderMessages([]);
    }
  } else {
    await loadHistory();
  }
  setStatus('已刷新');
}

async function refreshBranches() {
  const result = await api('/api/branches');
  state.branches = result.branches || [];
  renderBranches();
}

async function refreshSessions() {
  const result = await api('/api/sessions');
  state.sessions = (result.sessions || []).sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  renderSessions();
}

function renderBranches() {
  elements.branchesList.replaceChildren();
  if (!state.branches.length) {
    elements.branchesList.append(makeEmpty('还没有命名分支。上面输个名字就能开。'));
    return;
  }
  for (const branch of state.branches) {
    const node = makeItem({
      title: branch.name,
      meta: `${branch.sessionKey}\n创建于 ${formatTime(branch.createdAt)}`,
      active: state.active?.sessionKey === branch.sessionKey,
      onClick: () => guard(() => selectItem({ type: 'branch', data: branch })),
    });
    elements.branchesList.append(node);
  }
}

function renderSessions() {
  elements.sessionsList.replaceChildren();
  if (!state.sessions.length) {
    elements.sessionsList.append(makeEmpty('还没有可见会话。'));
    return;
  }
  for (const session of state.sessions) {
    const title = session.displayName || session.key;
    const meta = [session.key, session.kind || '', session.lastChannel || session.origin?.provider || '', relativeTime(session.updatedAt)].filter(Boolean).join(' · ');
    const node = makeItem({
      title,
      meta,
      active: state.active?.sessionKey === session.key,
      onClick: () => guard(() => selectItem({ type: 'session', data: session })),
    });
    elements.sessionsList.append(node);
  }
}

async function selectItem(item) {
  state.active = {
    type: item.type,
    sessionKey: item.type === 'branch' ? item.data.sessionKey : item.data.key,
    title: item.type === 'branch' ? item.data.name : (item.data.displayName || item.data.key),
    branchId: item.type === 'branch' ? item.data.id : null,
  };

  elements.activeTitle.textContent = state.active.title;
  elements.activeKey.textContent = state.active.sessionKey;
  renderBranches();
  renderSessions();
  await loadHistory(true);
}

async function loadHistory(forceScroll = false) {
  if (!state.active?.sessionKey) {
    renderMessages([]);
    return;
  }

  const sessionKey = state.active.sessionKey;
  const result = await api(`/api/history?sessionKey=${encodeURIComponent(sessionKey)}`);
  state.activeHistoryKey = sessionKey;
  renderMessages(result.messages || [], forceScroll);
  scheduleHistoryPolling();
}

function renderMessages(messages, forceScroll = false) {
  elements.messages.replaceChildren();
  if (!messages.length) {
    elements.messages.append(makeEmpty('这个分支还没有消息。发第一条之后，它就真正活过来了。'));
    return;
  }

  for (const message of messages) {
    const box = document.createElement('article');
    box.className = `message ${message.role || 'system'}`;

    const role = document.createElement('div');
    role.className = 'message-role';
    role.textContent = message.role || 'system';
    box.append(role);

    const body = document.createElement('div');
    body.textContent = stringifyMessage(message);
    box.append(body);
    elements.messages.append(box);
  }

  if (forceScroll) {
    elements.messages.scrollTop = elements.messages.scrollHeight;
  }
}

async function onCreateBranch(event) {
  event.preventDefault();
  const name = elements.branchName.value.trim();
  if (!name) return;
  setStatus('正在创建分支…');
  const result = await api('/api/branches', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  elements.branchName.value = '';
  await refreshBranches();
  await selectItem({ type: 'branch', data: result.branch });
  setStatus('分支已创建');
}

async function onRenameBranch() {
  if (!state.active?.branchId) {
    alert('当前不是命名分支。');
    return;
  }
  const name = window.prompt('新分支名', state.active.title);
  if (!name || !name.trim()) return;
  setStatus('正在重命名…');
  const result = await api(`/api/branches/${encodeURIComponent(state.active.branchId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: name.trim() }),
  });
  await refreshBranches();
  await selectItem({ type: 'branch', data: result.branch });
  setStatus('已重命名');
}

async function onDeleteBranch() {
  if (!state.active?.branchId) {
    alert('当前不是命名分支。');
    return;
  }
  if (!window.confirm('删除这个命名分支入口？只会删别名，不会删底层 transcript。')) return;
  await api(`/api/branches/${encodeURIComponent(state.active.branchId)}`, { method: 'DELETE' });
  state.active = null;
  await refreshAll();
  setStatus('分支别名已删除');
}

async function onSend() {
  if (!state.active?.sessionKey) {
    alert('先选一个分支或现有会话。');
    return;
  }
  const message = elements.composerInput.value.trim();
  if (!message) return;
  elements.sendButton.disabled = true;
  try {
    setStatus('正在发送…');
    await api('/api/send', {
      method: 'POST',
      body: JSON.stringify({ sessionKey: state.active.sessionKey, message }),
    });
    elements.composerInput.value = '';
    await loadHistory(true);
    await refreshSessions();
    setStatus('已发送，后台正在生成回复…');
  } finally {
    elements.sendButton.disabled = false;
  }
}

async function onAbort() {
  if (!state.active?.sessionKey) return;
  await api('/api/abort', {
    method: 'POST',
    body: JSON.stringify({ sessionKey: state.active.sessionKey }),
  });
  setStatus('已请求停止');
}

function scheduleHistoryPolling() {
  if (state.historyTimer) {
    clearInterval(state.historyTimer);
  }
  state.historyTimer = setInterval(() => guard(async () => {
    if (!state.activeHistoryKey || state.active?.sessionKey !== state.activeHistoryKey) return;
    const result = await api(`/api/history?sessionKey=${encodeURIComponent(state.activeHistoryKey)}`);
    renderMessages(result.messages || []);
  }), 2500);
}

function stringifyMessage(message) {
  const chunks = Array.isArray(message.content) ? message.content : [];
  if (!chunks.length) {
    return message.text || '[空消息]';
  }
  return chunks.map((chunk) => {
    if (chunk.type === 'text') return chunk.text || '';
    if (chunk.type === 'thinking') return `【thinking】\n${chunk.thinking || ''}`;
    if (chunk.type === 'toolCall') return `【toolCall】 ${chunk.name || ''}\n${JSON.stringify(chunk.arguments || {}, null, 2)}`;
    if (chunk.type === 'image') return '[image]';
    return JSON.stringify(chunk, null, 2);
  }).join('\n\n');
}

function makeItem({ title, meta, active, onClick }) {
  const node = elements.itemTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector('.list-item-title').textContent = title;
  node.querySelector('.list-item-meta').textContent = meta;
  if (active) node.classList.add('active');
  node.addEventListener('click', onClick);
  return node;
}

function makeEmpty(text) {
  const node = document.createElement('div');
  node.className = 'message-empty';
  node.textContent = text;
  return node;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

async function guard(task) {
  try {
    return await task();
  } catch (error) {
    setStatus(error.message || '请求失败');
    console.error(error);
    return null;
  }
}

function formatTime(value) {
  if (!value) return '未知';
  return new Date(value).toLocaleString('zh-CN');
}

function relativeTime(value) {
  if (!value) return '';
  const diff = Date.now() - value;
  const minutes = Math.round(diff / 60000);
  if (minutes <= 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function setStatus(text) {
  elements.status.textContent = text;
}
