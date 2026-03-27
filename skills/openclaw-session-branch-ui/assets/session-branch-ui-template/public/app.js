const state = {
  branches: [],
  sessions: [],
  active: null,
  activeHistoryKey: null,
  historyTimer: null,
  sessionTimer: null,
  metricsTimer: null,
  loadedMessages: [],
  historyBefore: null,
  historyHasMore: false,
  historyLoadingOlder: false,
  newestMessageId: null,
  messageHeights: new Map(),
  virtualRenderQueued: false,
  contextMenu: { visible: false, messageId: null },
  searchTimer: null,
  searchResults: [],
  searchActiveIndex: -1,
  highlightedMessageId: null,
  historyToastTimer: null,
  sidebarManuallyCollapsed: false,
  sidebarAutoCollapsed: false,
};

const HISTORY_PAGE_SIZE = 60;
const HISTORY_TOP_THRESHOLD = 120;
const HISTORY_BOTTOM_THRESHOLD = 48;
const VIRTUAL_OVERSCAN_PX = 900;
const MESSAGE_GAP_PX = 12;
const ESTIMATED_BASE_HEIGHT = 84;
const ESTIMATED_LINE_HEIGHT = 24;
const ESTIMATED_CHARS_PER_LINE = 44;
const VIRTUAL_RENDER_MIN_MESSAGES = 1000;
const SEARCH_RESULT_LIMIT = 8;
const SEARCH_DEBOUNCE_MS = 180;
const SEARCH_CONTEXT_PAGE_SIZE = 120;
const MESSAGE_HIGHLIGHT_MS = 2200;

const elements = {
  branchesList: document.getElementById('branches-list'),
  sessionsList: document.getElementById('sessions-list'),
  layout: document.getElementById('layout'),
  sidebar: document.getElementById('sidebar'),
  sidebarOpen: document.getElementById('sidebar-open'),
  sidebarClose: document.getElementById('sidebar-close'),
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
  metricsPanel: document.getElementById('metrics-panel'),
  contextMenu: document.getElementById('message-context-menu'),
  contextDeleteBefore: document.getElementById('context-delete-before'),
  itemTemplate: document.getElementById('item-template'),
  messageSearch: document.getElementById('message-search'),
  messageSearchSummary: document.getElementById('message-search-summary'),
  messageSearchResults: document.getElementById('message-search-results'),
  historyLoadingBanner: document.getElementById('history-loading-banner'),
};

boot();

async function boot() {
  bindEvents();
  syncSidebarMode();
  updateSelectionChrome();
  renderMessages([]);
  renderMetrics(null);
  window.addEventListener('unhandledrejection', (event) => {
    setStatus(event.reason?.message || '请求失败');
  });
  await guard(refreshAll);
  void guard(refreshMetrics);
  state.sessionTimer = setInterval(() => guard(refreshSessions), 10000);
  state.metricsTimer = setInterval(() => guard(refreshMetrics), 10000);
}

function bindEvents() {
  elements.refreshAll.addEventListener('click', () => guard(refreshAll));
  elements.createBranchForm.addEventListener('submit', (event) => guard(() => onCreateBranch(event)));
  elements.sendButton.addEventListener('click', () => guard(onSend));
  elements.renameBranch.addEventListener('click', () => guard(onRenameBranch));
  elements.deleteBranch.addEventListener('click', () => guard(onDeleteBranch));
  elements.abortRun.addEventListener('click', () => guard(onAbort));
  elements.sidebarOpen.addEventListener('click', () => {
    if (state.sidebarAutoCollapsed) {
      openSidebarOverlay();
      return;
    }
    setSidebarCollapsed(false, true);
  });
  elements.sidebarClose.addEventListener('click', () => {
    if (state.sidebarAutoCollapsed) {
      closeSidebarOverlay();
      return;
    }
    setSidebarCollapsed(true, true);
  });
  elements.contextDeleteBefore.addEventListener('click', () => guard(onContextDeleteBefore));
  elements.messages.addEventListener('scroll', () => {
    hideContextMenu();
    if (elements.messages.scrollTop <= HISTORY_TOP_THRESHOLD) {
      void guard(loadOlderHistory);
    }
    queueVirtualRender();
  });
  elements.messages.addEventListener('contextmenu', onMessageContextMenu);
  elements.messageSearch.addEventListener('input', onSearchInput);
  elements.messageSearch.addEventListener('focus', onSearchFocus);
  elements.messageSearch.addEventListener('keydown', (event) => {
    void guard(() => onSearchKeydown(event));
  });
  document.addEventListener('click', (event) => {
    hideContextMenu();
    if (!event.target.closest('.search-shell')) {
      hideSearchResults();
    }
    if (
      state.sidebarAutoCollapsed &&
      elements.layout.classList.contains('sidebar-overlay-open') &&
      !event.target.closest('#sidebar') &&
      !event.target.closest('#sidebar-open')
    ) {
      closeSidebarOverlay();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideContextMenu();
      hideSearchResults();
    }
  });
  window.addEventListener('resize', () => {
    hideContextMenu();
    syncSidebarMode();
    queueVirtualRender();
  });
}

async function refreshAll() {
  setStatus('正在刷新…');
  await Promise.all([refreshBranches(), refreshSessions()]);
  if (!state.active) {
    clearActiveState();
  } else {
    await loadInitialHistory(false);
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

async function refreshMetrics() {
  const metrics = await api('/api/metrics');
  renderMetrics(metrics);
}

function getLayoutThresholdWidth() {
  return 1120;
}

function syncSidebarMode() {
  state.sidebarAutoCollapsed = window.innerWidth < getLayoutThresholdWidth();
  applySidebarState();
}

function setSidebarCollapsed(collapsed, manual = false) {
  if (manual) {
    state.sidebarManuallyCollapsed = collapsed;
  }
  if (collapsed) {
    closeSidebarOverlay();
  }
  applySidebarState();
}

function openSidebarOverlay() {
  elements.layout.classList.add('sidebar-overlay-open');
}

function closeSidebarOverlay() {
  elements.layout.classList.remove('sidebar-overlay-open');
}

function applySidebarState() {
  const collapsed = state.sidebarAutoCollapsed || state.sidebarManuallyCollapsed;
  elements.layout.classList.toggle('sidebar-collapsed', collapsed);
  if (!state.sidebarAutoCollapsed) {
    closeSidebarOverlay();
  }
  elements.sidebarOpen.style.display = collapsed ? 'inline-flex' : 'none';
  elements.sidebarClose.style.display = 'inline-flex';
  elements.sidebarOpen.textContent = state.sidebarAutoCollapsed ? '☰' : '◧';
}

function renderMetrics(metrics) {
  const entries = metrics ? [
    ['RSS', `${metrics.memory?.rssMb ?? '-'} MB`],
    ['Heap', `${metrics.memory?.heapUsedMb ?? '-'} / ${metrics.memory?.heapTotalMb ?? '-'} MB`],
    ['Watchers', `${metrics.watchers?.total ?? '-'} (${metrics.watchers?.active ?? 0}/${metrics.watchers?.warm ?? 0}/${metrics.watchers?.cold ?? 0})`],
    ['Cache', `${metrics.cache?.files ?? '-'} files / ${metrics.cache?.sizeMb ?? '-'} MB`],
    ['Visible Sessions', `${metrics.sessions?.visible ?? '-'}`],
    ['Uptime', `${metrics.uptimeSec ?? '-'} s`],
  ] : [
    ['RSS', '-'],
    ['Heap', '-'],
    ['Watchers', '-'],
    ['Cache', '-'],
    ['Visible Sessions', '-'],
    ['Uptime', '-'],
  ];

  elements.metricsPanel.replaceChildren();
  for (const [label, value] of entries) {
    const card = document.createElement('div');
    card.className = 'metric-card';
    const title = document.createElement('div');
    title.className = 'metric-label';
    title.textContent = label;
    const body = document.createElement('div');
    body.className = 'metric-value';
    body.textContent = value;
    card.append(title, body);
    elements.metricsPanel.append(card);
  }
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

function updateSelectionChrome() {
  const hasActive = Boolean(state.active?.sessionKey);
  elements.activeTitle.textContent = hasActive ? state.active.title : '未选择';
  elements.activeKey.textContent = hasActive ? state.active.sessionKey : '先从左侧选一个命名分支或现有会话';
  elements.renameBranch.disabled = !state.active?.branchId;
  elements.deleteBranch.disabled = !state.active?.branchId;
  elements.abortRun.disabled = !hasActive;
  elements.sendButton.disabled = !hasActive;
  elements.composerInput.disabled = !hasActive;
  elements.messageSearch.disabled = !hasActive;
}

function clearActiveState() {
  state.active = null;
  state.activeHistoryKey = null;
  state.loadedMessages = [];
  state.historyBefore = null;
  state.historyHasMore = false;
  state.historyLoadingOlder = false;
  state.newestMessageId = null;
  state.messageHeights.clear();
  state.highlightedMessageId = null;
  clearSearch(true);
  setHistoryLoading(false);
  if (state.historyTimer) {
    clearInterval(state.historyTimer);
    state.historyTimer = null;
  }
  updateSelectionChrome();
  renderBranches();
  renderSessions();
  renderMessages([]);
}

async function selectItem(item) {
  closeSidebarOverlay();
  state.active = {
    type: item.type,
    sessionKey: item.type === 'branch' ? item.data.sessionKey : item.data.key,
    title: item.type === 'branch' ? item.data.name : (item.data.displayName || item.data.key),
    branchId: item.type === 'branch' ? item.data.id : null,
  };

  state.activeHistoryKey = state.active.sessionKey;
  state.loadedMessages = [];
  state.historyBefore = null;
  state.historyHasMore = false;
  state.historyLoadingOlder = false;
  state.newestMessageId = null;
  state.highlightedMessageId = null;
  clearSearch(true);
  setHistoryLoading(false);

  updateSelectionChrome();
  renderBranches();
  renderSessions();

  void api('/api/watch', {
    method: 'POST',
    body: JSON.stringify({ sessionKey: state.active.sessionKey }),
  }).catch((error) => {
    console.error(error);
  });

  await loadInitialHistory(true);
}

async function loadInitialHistory(forceScroll = false) {
  if (!state.active?.sessionKey) {
    state.loadedMessages = [];
    renderMessages([]);
    return;
  }

  const sessionKey = state.active.sessionKey;
  const result = await api(`/api/history?sessionKey=${encodeURIComponent(sessionKey)}&pageSize=${HISTORY_PAGE_SIZE}`);
  if (state.active?.sessionKey !== sessionKey) {
    return;
  }

  state.activeHistoryKey = sessionKey;
  state.loadedMessages = result.messages || [];
  state.historyBefore = result.nextBefore;
  state.historyHasMore = Boolean(result.hasMore);
  state.newestMessageId = result.newestId || state.loadedMessages.at(-1)?.id || null;
  renderMessages(state.loadedMessages, forceScroll);
  scheduleHistoryPolling();
}

async function loadOlderHistory() {
  if (!state.active?.sessionKey || !state.historyHasMore || state.historyLoadingOlder) {
    return;
  }

  state.historyLoadingOlder = true;
  setHistoryLoading(true, '正在加载更早消息');
  const sessionKey = state.active.sessionKey;
  const anchor = captureAnchor();

  try {
    const result = await api(`/api/history?sessionKey=${encodeURIComponent(sessionKey)}&pageSize=${HISTORY_PAGE_SIZE}&before=${state.historyBefore ?? ''}`);
    if (state.active?.sessionKey !== sessionKey) {
      return;
    }

    state.loadedMessages = mergeMessages(result.messages || [], state.loadedMessages);
    state.historyBefore = result.nextBefore;
    state.historyHasMore = Boolean(result.hasMore);
    renderMessages(state.loadedMessages, false, { anchor });
  } finally {
    state.historyLoadingOlder = false;
    setHistoryLoading(false);
  }

  if (!state.historyHasMore) {
    showHistoryToast('已加载最早消息');
  } else {
    showHistoryToast('向上滚动加载更早消息');
  }
}

function setHistoryLoading(isLoading, text = '正在加载更早消息') {
  window.clearTimeout(state.historyToastTimer || 0);
  state.historyToastTimer = null;
  if (!isLoading) {
    elements.historyLoadingBanner.hidden = true;
    elements.historyLoadingBanner.classList.remove('is-loading');
    elements.historyLoadingBanner.textContent = '';
    return;
  }
  elements.historyLoadingBanner.textContent = text;
  elements.historyLoadingBanner.classList.add('is-loading');
  elements.historyLoadingBanner.hidden = false;
}

function showHistoryToast(text, durationMs = 1800) {
  window.clearTimeout(state.historyToastTimer || 0);
  elements.historyLoadingBanner.textContent = text;
  elements.historyLoadingBanner.classList.remove('is-loading');
  elements.historyLoadingBanner.hidden = false;
  state.historyToastTimer = window.setTimeout(() => {
    elements.historyLoadingBanner.hidden = true;
    elements.historyLoadingBanner.textContent = '';
    state.historyToastTimer = null;
  }, durationMs);
}

function estimateMessageHeight(message) {
  const cached = state.messageHeights.get(message.id);
  if (cached) {
    return cached;
  }
  const text = stringifyMessage(message);
  const explicitLines = text.split('\n').length;
  const wrappedLines = Math.ceil(Math.max(text.length, 1) / ESTIMATED_CHARS_PER_LINE);
  const lineCount = Math.max(explicitLines, wrappedLines, 1);
  const estimate = ESTIMATED_BASE_HEIGHT + lineCount * ESTIMATED_LINE_HEIGHT + MESSAGE_GAP_PX;
  state.messageHeights.set(message.id, estimate);
  return estimate;
}

function shouldUseVirtualRendering(messages = state.loadedMessages) {
  return messages.length >= VIRTUAL_RENDER_MIN_MESSAGES;
}

function createMessageNode(message) {
  const box = document.createElement('article');
  box.className = `message ${message.role || 'system'}`;
  box.dataset.messageId = message.id;

  const header = document.createElement('div');
  header.className = 'message-header';

  const role = document.createElement('div');
  role.className = 'message-role';
  role.textContent = message.role || 'system';
  header.append(role);

  if (message.role === 'user' || message.role === 'assistant') {
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'message-copy';
    copyButton.textContent = '复制';
    copyButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void copyMessageText(stringifyMessage(message), copyButton);
    });
    header.append(copyButton);
  }

  box.append(header);

  const body = document.createElement('div');
  body.className = 'message-body';
  body.textContent = stringifyMessage(message);
  box.append(body);
  return box;
}

async function copyMessageText(text, button) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      fallbackCopyText(text);
    }
    flashButtonLabel(button, '已复制');
  } catch (error) {
    console.error(error);
    flashButtonLabel(button, '复制失败');
  }
}

function fallbackCopyText(text) {
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', 'readonly');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  document.execCommand('copy');
  document.body.removeChild(input);
}

function flashButtonLabel(button, label) {
  const original = button.dataset.originalLabel || button.textContent || '复制';
  button.dataset.originalLabel = original;
  button.textContent = label;
  window.clearTimeout(Number(button.dataset.resetTimer || 0));
  const timer = window.setTimeout(() => {
    button.textContent = original;
    delete button.dataset.resetTimer;
  }, 1200);
  button.dataset.resetTimer = String(timer);
}

function hideContextMenu() {
  state.contextMenu.visible = false;
  state.contextMenu.messageId = null;
  elements.contextMenu.hidden = true;
}

function showContextMenu(messageId, x, y) {
  state.contextMenu.visible = true;
  state.contextMenu.messageId = messageId;
  elements.contextMenu.hidden = false;
  const maxX = window.innerWidth - elements.contextMenu.offsetWidth - 8;
  const maxY = window.innerHeight - elements.contextMenu.offsetHeight - 8;
  elements.contextMenu.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
  elements.contextMenu.style.top = `${Math.max(8, Math.min(y, maxY))}px`;
}

function onMessageContextMenu(event) {
  const messageNode = event.target.closest('.message[data-message-id]');
  if (!messageNode || !state.active?.sessionKey) {
    hideContextMenu();
    return;
  }
  event.preventDefault();
  showContextMenu(messageNode.dataset.messageId, event.clientX, event.clientY);
}

function captureAnchor() {
  if (!shouldUseVirtualRendering()) {
    return null;
  }
  const containerRect = elements.messages.getBoundingClientRect();
  const nodes = Array.from(elements.messages.querySelectorAll('.message[data-message-id]'));
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (rect.bottom >= containerRect.top) {
      return { id: node.dataset.messageId, offset: rect.top - containerRect.top };
    }
  }
  return nodes.length ? { id: nodes[0].dataset.messageId, offset: 0 } : null;
}

function restoreAnchor(anchor) {
  if (!anchor) {
    return;
  }
  const node = elements.messages.querySelector(`.message[data-message-id="${anchor.id}"]`);
  if (!node) {
    return;
  }
  const containerRect = elements.messages.getBoundingClientRect();
  const rect = node.getBoundingClientRect();
  elements.messages.scrollTop += (rect.top - containerRect.top) - anchor.offset;
}

function queueVirtualRender(anchor = captureAnchor()) {
  if (!shouldUseVirtualRendering()) {
    return;
  }
  if (state.virtualRenderQueued) {
    return;
  }
  state.virtualRenderQueued = true;
  requestAnimationFrame(() => {
    state.virtualRenderQueued = false;
    renderVirtualWindow({ anchor });
  });
}

function getMessagesEmptyText() {
  return state.active?.sessionKey
    ? '这个分支/会话还没有消息。发第一条之后，它就真正活过来了。'
    : '请从左侧选择分支';
}

function renderSimpleMessages(messages) {
  elements.messages.replaceChildren();
  if (!messages.length) {
    elements.messages.append(makeEmpty(getMessagesEmptyText()));
    return;
  }
  for (const message of messages) {
    elements.messages.append(createMessageNode(message));
  }
}

function measureRenderedMessages(anchor) {
  let changed = false;
  const nodes = Array.from(elements.messages.querySelectorAll('.message[data-message-id]'));
  for (const node of nodes) {
    const id = node.dataset.messageId;
    const measured = node.offsetHeight + MESSAGE_GAP_PX;
    const previous = state.messageHeights.get(id);
    if (!previous || Math.abs(previous - measured) > 2) {
      state.messageHeights.set(id, measured);
      changed = true;
    }
  }
  if (changed) {
    renderVirtualWindow({ anchor, skipMeasurement: true });
    return true;
  }
  return false;
}

function renderVirtualWindow(options = {}) {
  const { anchor = null, skipMeasurement = false } = options;
  const messages = state.loadedMessages;
  elements.messages.replaceChildren();

  if (!messages.length) {
    elements.messages.append(makeEmpty(getMessagesEmptyText()));
    return;
  }

  const viewportHeight = Math.max(elements.messages.clientHeight || 0, 480);
  const scrollTop = elements.messages.scrollTop;
  const startTarget = Math.max(0, scrollTop - VIRTUAL_OVERSCAN_PX);
  const endTarget = scrollTop + viewportHeight + VIRTUAL_OVERSCAN_PX;

  let cursor = 0;
  let startIndex = 0;
  while (startIndex < messages.length) {
    const next = estimateMessageHeight(messages[startIndex]);
    if (cursor + next >= startTarget) {
      break;
    }
    cursor += next;
    startIndex += 1;
  }
  const topSpacerHeight = cursor;

  let endIndex = startIndex;
  while (endIndex < messages.length && cursor < endTarget) {
    cursor += estimateMessageHeight(messages[endIndex]);
    endIndex += 1;
  }
  endIndex = Math.min(messages.length, Math.max(endIndex, startIndex + 1));

  let totalHeight = 0;
  for (const message of messages) {
    totalHeight += estimateMessageHeight(message);
  }
  const visibleMessages = messages.slice(startIndex, endIndex);
  const renderedHeight = visibleMessages.reduce((sum, message) => sum + estimateMessageHeight(message), 0);
  const bottomSpacerHeight = Math.max(0, totalHeight - topSpacerHeight - renderedHeight);

  if (topSpacerHeight > 0) {
    const spacerTop = document.createElement('div');
    spacerTop.className = 'messages-spacer';
    spacerTop.style.height = `${topSpacerHeight}px`;
    elements.messages.append(spacerTop);
  }

  const fragment = document.createDocumentFragment();
  for (const message of visibleMessages) {
    fragment.append(createMessageNode(message));
  }
  elements.messages.append(fragment);

  if (bottomSpacerHeight > 0) {
    const spacerBottom = document.createElement('div');
    spacerBottom.className = 'messages-spacer';
    spacerBottom.style.height = `${bottomSpacerHeight}px`;
    elements.messages.append(spacerBottom);
  }

  requestAnimationFrame(() => {
    if (!skipMeasurement && measureRenderedMessages(anchor)) {
      return;
    }
    restoreAnchor(anchor);
  });
}

function renderMessages(messages, forceScroll = false, options = {}) {
  const { anchor = null } = options;
  const liveIds = new Set(messages.map((message) => message.id));
  for (const key of Array.from(state.messageHeights.keys())) {
    if (!liveIds.has(key)) {
      state.messageHeights.delete(key);
    }
  }

  if (!shouldUseVirtualRendering(messages)) {
    renderSimpleMessages(messages);
  } else {
    renderVirtualWindow({ anchor });
  }

  if (forceScroll) {
    requestAnimationFrame(() => {
      elements.messages.scrollTop = elements.messages.scrollHeight;
    });
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
  clearActiveState();
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
    await pollHistoryDelta(true);
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

async function onContextDeleteBefore() {
  if (!state.active?.sessionKey || !state.contextMenu.messageId) {
    hideContextMenu();
    return;
  }
  const messageId = state.contextMenu.messageId;
  hideContextMenu();
  const ok = window.confirm('确定删除这条消息及其之前的本地历史吗？\n此操作只对 Branch UI 生效，重启后也不会恢复。');
  if (!ok) {
    return;
  }
  setStatus('正在删除本地历史…');
  await api('/api/history/truncate', {
    method: 'POST',
    body: JSON.stringify({ sessionKey: state.active.sessionKey, cutoffMessageId: messageId }),
  });
  state.messageHeights.clear();
  await loadInitialHistory(false);
  setStatus('已删除此条及之前的本地历史');
}

function scheduleHistoryPolling() {
  if (state.historyTimer) {
    clearInterval(state.historyTimer);
  }
  state.historyTimer = setInterval(() => guard(() => pollHistoryDelta(false)), 4000);
}

async function pollHistoryDelta(forceScroll) {
  if (!state.activeHistoryKey || state.active?.sessionKey !== state.activeHistoryKey) {
    return;
  }

  const sessionKey = state.activeHistoryKey;
  const wasNearBottom = isNearBottom(elements.messages);
  const anchor = wasNearBottom ? null : captureAnchor();
  const afterId = state.newestMessageId ? `&afterId=${encodeURIComponent(state.newestMessageId)}` : '';
  const result = await api(`/api/history-delta?sessionKey=${encodeURIComponent(sessionKey)}${afterId}`);
  if (state.active?.sessionKey !== sessionKey) {
    return;
  }

  if (result.resetRequired) {
    await loadInitialHistory(false);
    return;
  }

  const incoming = result.messages || [];
  if (!incoming.length) {
    return;
  }

  state.loadedMessages = mergeMessages(state.loadedMessages, incoming);
  state.newestMessageId = result.newestId || state.loadedMessages.at(-1)?.id || state.newestMessageId;
  renderMessages(state.loadedMessages, false, { anchor });

  if (forceScroll || wasNearBottom) {
    elements.messages.scrollTop = elements.messages.scrollHeight;
  }
}

function mergeMessages(left, right) {
  const merged = [];
  const seen = new Set();
  for (const message of [...left, ...right]) {
    if (!message?.id || seen.has(message.id)) {
      continue;
    }
    seen.add(message.id);
    merged.push(message);
  }
  merged.sort((a, b) => {
    const at = Number(a.timestamp || 0);
    const bt = Number(b.timestamp || 0);
    if (at !== bt) return at - bt;
    return String(a.id).localeCompare(String(b.id));
  });
  return merged;
}

function isNearBottom(container) {
  return container.scrollHeight - container.scrollTop - container.clientHeight <= HISTORY_BOTTOM_THRESHOLD;
}

function stringifyMessage(message) {
  if (message.text) {
    return message.text;
  }
  const chunks = Array.isArray(message.content) ? message.content : [];
  if (!chunks.length) {
    return message.text || '[空消息]';
  }
  return chunks.map((chunk) => {
    if (chunk.type === 'text') return chunk.text || '';
    return '';
  }).filter(Boolean).join('\n\n') || '[空消息]';
}

function onSearchInput() {
  const query = elements.messageSearch.value.trim();
  window.clearTimeout(state.searchTimer || 0);
  if (!query) {
    clearSearch(false);
    return;
  }
  state.searchTimer = window.setTimeout(() => {
    void guard(() => performSearch(query));
  }, SEARCH_DEBOUNCE_MS);
}

function onSearchFocus() {
  if (state.searchResults.length) {
    renderSearchResults(state.searchResults);
  }
}

async function onSearchKeydown(event) {
  if (!state.searchResults.length && event.key !== 'Enter') {
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    state.searchActiveIndex = Math.min(state.searchActiveIndex + 1, state.searchResults.length - 1);
    renderSearchResults(state.searchResults);
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    state.searchActiveIndex = Math.max(state.searchActiveIndex - 1, 0);
    renderSearchResults(state.searchResults);
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    if (!state.searchResults.length) {
      const query = elements.messageSearch.value.trim();
      if (query) {
        await performSearch(query);
      }
      return;
    }
    const index = state.searchActiveIndex >= 0 ? state.searchActiveIndex : 0;
    const result = state.searchResults[index];
    if (result) {
      await focusSearchResult(result);
    }
  }
}

async function performSearch(query) {
  if (!state.active?.sessionKey || !query.trim()) {
    clearSearch(false);
    return;
  }
  const sessionKey = state.active.sessionKey;
  const result = await api(`/api/history/search?sessionKey=${encodeURIComponent(sessionKey)}&query=${encodeURIComponent(query.trim())}&limit=${SEARCH_RESULT_LIMIT}`);
  if (state.active?.sessionKey !== sessionKey || elements.messageSearch.value.trim() !== query.trim()) {
    return;
  }
  state.searchResults = result.results || [];
  state.searchActiveIndex = state.searchResults.length ? 0 : -1;
  setSearchSummary(state.searchResults.length ? `找到 ${state.searchResults.length} 条` : '无匹配');
  renderSearchResults(state.searchResults, query.trim());
}

function renderSearchResults(results, query = elements.messageSearch.value.trim()) {
  elements.messageSearchResults.replaceChildren();
  if (!query) {
    hideSearchResults();
    return;
  }

  if (!results.length) {
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.textContent = '未找到匹配消息';
    elements.messageSearchResults.append(empty);
    elements.messageSearchResults.hidden = false;
    return;
  }

  results.forEach((result, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `search-result${index === state.searchActiveIndex ? ' active' : ''}`;
    button.addEventListener('click', () => {
      void guard(() => focusSearchResult(result));
    });

    const title = document.createElement('div');
    title.className = 'search-result-title';
    title.textContent = result.preview || '[空消息]';

    const meta = document.createElement('div');
    meta.className = 'search-result-meta';
    meta.textContent = `${formatTime(result.timestamp)} · ${result.role || 'system'}`;

    button.append(title, meta);
    elements.messageSearchResults.append(button);
  });

  elements.messageSearchResults.hidden = false;
}

function hideSearchResults() {
  elements.messageSearchResults.hidden = true;
}

function clearSearch(resetInput) {
  window.clearTimeout(state.searchTimer || 0);
  state.searchTimer = null;
  state.searchResults = [];
  state.searchActiveIndex = -1;
  setSearchSummary('');
  if (resetInput) {
    elements.messageSearch.value = '';
  }
  hideSearchResults();
}

async function focusSearchResult(result) {
  hideSearchResults();
  if (!state.active?.sessionKey) {
    return;
  }

  if (!state.loadedMessages.some((message) => message.id === result.id)) {
    const page = await api(`/api/history?sessionKey=${encodeURIComponent(state.active.sessionKey)}&pageSize=${SEARCH_CONTEXT_PAGE_SIZE}&before=${result.position + 1}`);
    state.loadedMessages = mergeMessages(page.messages || [], state.loadedMessages);
    state.historyBefore = state.historyBefore === null ? page.nextBefore : Math.min(state.historyBefore, page.nextBefore);
    state.historyHasMore = Boolean(page.hasMore) || state.historyHasMore;
    state.newestMessageId = page.newestId || state.newestMessageId;
    renderMessages(state.loadedMessages, false);
  }

  await scrollToMessage(result.id);
  setStatus(`已定位到 ${formatTime(result.timestamp)}`);
}

async function scrollToMessage(messageId) {
  const index = state.loadedMessages.findIndex((message) => message.id === messageId);
  if (index === -1) {
    return;
  }

  if (shouldUseVirtualRendering()) {
    let top = 0;
    for (let pointer = 0; pointer < index; pointer += 1) {
      top += estimateMessageHeight(state.loadedMessages[pointer]);
    }
    elements.messages.scrollTop = Math.max(0, top - 96);
    renderVirtualWindow();
  }

  const node = await waitForMessageNode(messageId);
  if (!node) {
    return;
  }
  node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  highlightMessageNode(node, messageId);
}

async function waitForMessageNode(messageId, attempts = 8) {
  for (let index = 0; index < attempts; index += 1) {
    const node = elements.messages.querySelector(`.message[data-message-id="${messageId}"]`);
    if (node) {
      return node;
    }
    await nextFrame();
  }
  return null;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function highlightMessageNode(node, messageId) {
  const previous = state.highlightedMessageId
    ? elements.messages.querySelector(`.message[data-message-id="${state.highlightedMessageId}"]`)
    : null;
  previous?.classList.remove('message-highlight');
  node.classList.add('message-highlight');
  state.highlightedMessageId = messageId;
  window.setTimeout(() => {
    const current = elements.messages.querySelector(`.message[data-message-id="${messageId}"]`);
    current?.classList.remove('message-highlight');
    if (state.highlightedMessageId === messageId) {
      state.highlightedMessageId = null;
    }
  }, MESSAGE_HIGHLIGHT_MS);
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

function setSearchSummary(text) {
  elements.messageSearchSummary.textContent = text || '';
}

function setStatus(text) {
  elements.status.textContent = text;
}
