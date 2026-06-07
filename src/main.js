import { invoke } from '@tauri-apps/api/core';
import APlayer from 'aplayer';
import 'aplayer/dist/APlayer.min.css';

const state = {
  root: '',

  currentPath: '',
  entries: [],
  selectedPath: '',
  search: '',
  view: localStorage.getItem('finder-anywhere-view') || 'list',
  sharePortLocked: false,
  savedSharePort: null,
  currentSharePort: null,
  entryByPath: new Map(),
  resourceUrlByPath: new Map(),
  previewUrlByPath: new Map(),
  fullscreenOpen: false,
  backStack: [],
  forwardStack: []
};

const TEXT_PREVIEW_LIMIT = 2 * 1024 * 1024;
const VIRTUAL_ROW_HEIGHT = 42;
const VIRTUAL_BUFFER_ROWS = 12;
const MOBILE_PREVIEW_QUERY = '(max-width: 1100px)';
let virtualRenderFrame = 0;
let fullscreenTouchStartY = 0;
let lockedScrollY = 0;
let copyFeedbackTimer = 0;
let previewMusicPlayer = null;

const dom = {

  breadcrumbs: document.getElementById('breadcrumbs'),
  contentArea: document.getElementById('contentArea'),
  folderTitle: document.getElementById('folderTitle'),
  folderMeta: document.getElementById('folderMeta'),
  previewTitle: document.getElementById('previewTitle'),
  previewMeta: document.getElementById('previewMeta'),
  previewActions: document.getElementById('previewActions'),
  previewBody: document.getElementById('previewBody'),
  chooseRootButton: document.getElementById('chooseRootButton'),
  rootName: document.getElementById('rootName'),
  shareAddresses: document.getElementById('shareAddresses'),
  searchInput: document.getElementById('searchInput'),
  backButton: document.getElementById('backButton'),
  forwardButton: document.getElementById('forwardButton'),
  refreshButton: document.getElementById('refreshButton'),
  portLockButton: document.getElementById('portLockButton'),
  listViewButton: document.getElementById('listViewButton'),
  gridViewButton: document.getElementById('gridViewButton')
};

const icons = {
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"></path></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg>',
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="m21 15-5-5L5 21"></path></svg>',
  text: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h6"></path></svg>',
  pdf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M7.5 16h9"></path><path d="M8 12h8"></path></svg>',
  audio: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>',
  video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="14" height="14" rx="2"></rect><path d="m17 9 4-2v10l-4-2z"></path></svg>',
  binary: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 3 7v10l9 5 9-5V7z"></path><path d="m3 7 9 5 9-5"></path><path d="M12 22V12"></path></svg>',
  open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg>',
  fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M21 8V5a2 2 0 0 0-2-2h-3"></path><path d="M3 16v3a2 2 0 0 0 2 2h3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg>',
  unlock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"></rect><path d="M15 10V7a4 4 0 0 0-7.7-1.4"></path></svg>',
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6"></path></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>',
  archive: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z"></path><path d="M10 12h4"></path><path d="M10 16h4"></path><path d="M8 6V3h8v3"></path></svg>'
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function attrPath(path) {
  return encodeURIComponent(path);
}

function pathFromAttr(path) {
  return decodeURIComponent(path || '');
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.top = '-1000px';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('复制失败');
}

function showShareCopyFeedback(message, isError = false) {
  window.clearTimeout(copyFeedbackTimer);
  dom.shareAddresses.dataset.feedback = message;
  dom.shareAddresses.classList.toggle('copy-error', isError);
  dom.shareAddresses.classList.add('copied');
  copyFeedbackTimer = window.setTimeout(() => {
    dom.shareAddresses.classList.remove('copied', 'copy-error');
    delete dom.shareAddresses.dataset.feedback;
  }, 1200);
}

function shouldAutoFullscreenPreview() {
  return window.matchMedia(MOBILE_PREVIEW_QUERY).matches;
}

function lockPageScroll() {
  if (document.body.classList.contains('fullscreen-open')) return;
  lockedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${lockedScrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';
}

function unlockPageScroll() {
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  window.scrollTo(0, lockedScrollY);
}

function formatBytes(size) {
  if (size === null || size === undefined) return '--';
  if (size === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value * 1000));
}

function basename(path) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

function typeLabel(entry) {
  if (entry.entryType === 'directory') return '文件夹';
  if (entry.kind === 'image') return '图片';
  if (entry.kind === 'text') return '文本';
  if (entry.kind === 'pdf') return 'PDF';
  if (entry.kind === 'music') return '音乐';
  if (entry.kind === 'audio') return '音频';
  if (entry.kind === 'video') return '视频';
  return '文件';
}

function iconFor(entry) {
  if (entry.entryType === 'directory') return `<span class="folder-badge">${icons.folder}</span>`;
  const icon = entry.kind === 'music' ? icons.audio : icons[entry.kind] || icons.file;
  return `<span class="file-icon">${icon}</span>`;
}

function isImageEntry(entry) {
  return entry?.entryType === 'file' && entry.kind === 'image';
}

function isMusicPlayerEntry(entry) {
  return entry?.entryType === 'file' && (entry.kind === 'music' || entry.kind === 'audio');
}

async function resourceUrl(entry) {
  if (state.resourceUrlByPath.has(entry.path)) return state.resourceUrlByPath.get(entry.path);
  const url = await invoke('file_url', { path: entry.absolutePath });
  state.resourceUrlByPath.set(entry.path, url);
  return url;
}

async function musicPlaylistFor(entry) {
  const folderItems = state.entries.filter(isMusicPlayerEntry);
  const playlistEntries = folderItems.some((item) => item.path === entry.path)
    ? folderItems
    : [entry, ...folderItems];
  const audio = await Promise.all(
    playlistEntries.map(async (item) => ({
      name: item.name,
      artist: 'Finder Anywhere',
      url: await resourceUrl(item)
    }))
  );
  const currentIndex = Math.max(0, playlistEntries.findIndex((item) => item.path === entry.path));
  return { audio, currentIndex };
}

async function imagePreviewUrl(entry, size = 1200) {
  const key = `${entry.path}:${size}`;
  if (state.previewUrlByPath.has(key)) return state.previewUrlByPath.get(key);
  const url = await invoke('preview_url', { path: entry.absolutePath, size });
  state.previewUrlByPath.set(key, url);
  return url;
}

async function chooseRoot() {
  const selected = await invoke('choose_root');
  if (!selected) return;

  state.root = selected;
  localStorage.setItem('finder-anywhere-root', selected);
  state.backStack = [];
  state.forwardStack = [];
  await loadModules();
  await loadShareInfo();
  await openPath('', { pushHistory: false });
}

async function loadShareInfo() {
  try {
    const info = await invoke('share_info', {
      root: state.root || null,
      lockedPort: state.sharePortLocked ? state.savedSharePort : null
    });
    state.root = info.root;
    state.currentSharePort = info.port;
    state.savedSharePort = info.port;
    const urls = info.lanUrls?.length ? info.lanUrls : [info.localUrl];
    dom.shareAddresses.innerHTML = urls
      .map(
        (url) => `
          <button class="share-address" type="button" data-copy-url="${escapeHtml(url)}" title="点击复制 ${escapeHtml(url)}">
            ${escapeHtml(url.replace(/^https?:\/\//, ''))}
          </button>
        `
      )
      .join('');
    dom.shareAddresses.title = `局域网分享地址：${urls.join('  ')}`;
    updatePortLockButton();
  } catch (error) {
    dom.shareAddresses.innerHTML = `<span>${escapeHtml(String(error) || '分享地址不可用')}</span>`;
    dom.shareAddresses.title = String(error);
    state.currentSharePort = null;
    updatePortLockButton();
  }
}

function updatePortLockButton() {
  const locked = state.sharePortLocked;
  dom.portLockButton.classList.toggle('active', locked);
  dom.portLockButton.innerHTML = locked ? icons.lock : icons.unlock;
  dom.portLockButton.disabled = !locked && !state.currentSharePort;
  dom.portLockButton.setAttribute('aria-label', locked ? '解除端口锁定' : '锁定当前分享端口');
  dom.portLockButton.title = locked
    ? `已锁定端口 ${state.savedSharePort}，点击解除`
    : state.currentSharePort
      ? `锁定当前端口 ${state.currentSharePort}`
      : '分享端口未就绪';
}

async function toggleSharePortLock() {
  if (state.sharePortLocked) {
    const config = await invoke('set_share_port_config', {
      port: state.currentSharePort || state.savedSharePort || null,
      locked: false
    });
    state.savedSharePort = config.sharePort || null;
    state.sharePortLocked = Boolean(config.sharePortLocked);
    updatePortLockButton();
    await loadShareInfo();
    return;
  }

  if (!state.currentSharePort) return;
  const config = await invoke('set_share_port_config', {
    port: state.currentSharePort,
    locked: true
  });
  state.savedSharePort = config.sharePort || null;
  state.sharePortLocked = Boolean(config.sharePortLocked);
  updatePortLockButton();
  await loadShareInfo();
}

async function loadModules() {
  if (state.root) {
    dom.rootName.textContent = basename(state.root);
  }
}

async function openPath(path, options = {}) {
  const normalizedPath = path || '';
  const pushHistory = options.pushHistory !== false;

  if (pushHistory && normalizedPath !== state.currentPath) {
    state.backStack.push(state.currentPath);
    state.forwardStack = [];
  }

  state.currentPath = normalizedPath;
  state.selectedPath = '';
  state.resourceUrlByPath.clear();
  state.previewUrlByPath.clear();
  closeFullscreenPreview();
  renderPreview(null);
  renderLoading();

  try {
    const data = await invoke('list_directory', { root: state.root || null, path: normalizedPath || null });
    state.root = data.root;
    state.entries = data.entries;
    state.entryByPath = new Map(data.entries.map((entry) => [entry.path, entry]));
    renderBreadcrumbs(data.breadcrumbs);
    renderContent(data);
    updateNavButtons();
  } catch (error) {
    renderError(String(error));
  }
}

function renderLoading() {
  dom.contentArea.classList.remove('virtual-content');
  dom.contentArea.innerHTML = '<div class="loading-bar" aria-label="加载中"><span></span></div>';
}

function renderError(message) {
  dom.contentArea.classList.remove('virtual-content');
  dom.contentArea.innerHTML = `
    <div class="empty-state">
      ${icons.archive}
      <strong>${escapeHtml(message)}</strong>
    </div>
  `;
}

function renderBreadcrumbs(crumbs) {
  dom.breadcrumbs.innerHTML = crumbs
    .map((crumb, index) => {
      const isLast = index === crumbs.length - 1;
      const separator = index === 0 ? '' : '<span class="crumb-separator">/</span>';
      return `
        ${separator}
        <button class="crumb ${isLast ? 'active' : ''}" type="button" data-path="${attrPath(crumb.path)}" title="${escapeHtml(crumb.name)}">
          ${escapeHtml(crumb.name)}
        </button>
      `;
    })
    .join('');

  dom.breadcrumbs.querySelectorAll('.crumb').forEach((button) => {
    button.addEventListener('click', () => openPath(pathFromAttr(button.dataset.path)));
  });
}

function filteredEntries() {
  const keyword = state.search.trim().toLowerCase();
  if (!keyword) return state.entries;
  return state.entries.filter((entry) => entry.name.toLowerCase().includes(keyword));
}

function renderContent(data) {
  const entries = filteredEntries();
  dom.folderTitle.textContent = data.name;
  dom.folderMeta.textContent = `${entries.length} 项`;

  if (!entries.length) {
    dom.contentArea.classList.remove('virtual-content');
    dom.contentArea.innerHTML = `
      <div class="empty-state">
        ${icons.folder}
        <strong>没有可显示的文件</strong>
      </div>
    `;
    return;
  }

  if (state.view === 'grid') {
    renderGrid(entries);
  } else {
    renderList(entries);
  }
}

function renderList(entries) {
  dom.contentArea.classList.add('virtual-content');
  dom.contentArea.innerHTML = `
    <div class="file-table virtual-table" role="table">
      <div class="file-head" role="row">
        <span>名称</span>
        <span>修改时间</span>
        <span>大小</span>
        <span>类型</span>
      </div>
      <div class="virtual-scroll" id="virtualFileScroll">
        <div class="virtual-spacer" id="virtualFileSpacer" style="height: ${entries.length * VIRTUAL_ROW_HEIGHT}px">
          <div class="virtual-window" id="virtualFileWindow"></div>
        </div>
      </div>
    </div>
  `;

  const scroller = document.getElementById('virtualFileScroll');
  scroller.addEventListener('scroll', scheduleVirtualRender, { passive: true });
  bindEntryEvents();
  renderVirtualRows(entries);
}

function renderListRow(entry) {
  return `
    <button class="file-row ${state.selectedPath === entry.path ? 'selected' : ''}" type="button" data-path="${attrPath(entry.path)}" role="row" title="${escapeHtml(entry.name)}">
      <span class="file-primary">
        ${iconFor(entry)}
        <span class="file-name">${escapeHtml(entry.name)}</span>
      </span>
      <span class="file-cell">${formatDate(entry.modifiedAt)}</span>
      <span class="file-cell">${entry.entryType === 'directory' ? `${entry.children ?? 0} 项` : formatBytes(entry.size)}</span>
      <span class="file-cell">${typeLabel(entry)}</span>
    </button>
  `;
}

function renderGrid(entries) {
  dom.contentArea.classList.remove('virtual-content');
  dom.contentArea.innerHTML = `<div class="grid-view">${entries.map(renderGridItem).join('')}</div>`;
  bindEntryEvents();
  hydrateGridImages(entries);
}

function renderGridItem(entry) {
  const thumb =
    entry.kind === 'image'
      ? `<span class="async-thumb" data-thumb-path="${attrPath(entry.path)}">${icons.image}</span>`
      : iconFor(entry);

  return `
    <button class="grid-item ${state.selectedPath === entry.path ? 'selected' : ''}" type="button" data-path="${attrPath(entry.path)}" title="${escapeHtml(entry.name)}">
      <span class="thumb">${thumb}</span>
      <span class="grid-caption">
        <span class="file-name">${escapeHtml(entry.name)}</span>
        <span class="item-subtitle">${entry.entryType === 'directory' ? `${entry.children ?? 0} 项` : formatBytes(entry.size)}</span>
      </span>
    </button>
  `;
}

async function hydrateGridImages(entries) {
  const images = entries.filter((entry) => entry.kind === 'image');
  for (const entry of images) {
    const holder = [...dom.contentArea.querySelectorAll('[data-thumb-path]')].find(
      (element) => pathFromAttr(element.dataset.thumbPath) === entry.path
    );
    if (!holder) continue;
    try {
      const url = await imagePreviewUrl(entry, 420);
      holder.outerHTML = `<img src="${escapeHtml(url)}" alt="${escapeHtml(entry.name)}" loading="lazy" decoding="async">`;
    } catch {
      holder.innerHTML = icons.image;
    }
  }
}

function scheduleVirtualRender() {
  if (virtualRenderFrame) return;
  virtualRenderFrame = requestAnimationFrame(() => {
    virtualRenderFrame = 0;
    renderVirtualRows(filteredEntries());
  });
}

function renderVirtualRows(entries) {
  const scroller = document.getElementById('virtualFileScroll');
  const spacer = document.getElementById('virtualFileSpacer');
  const windowEl = document.getElementById('virtualFileWindow');
  if (!scroller || !spacer || !windowEl) return;

  const viewportHeight = scroller.clientHeight || 480;
  const start = Math.max(0, Math.floor(scroller.scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_BUFFER_ROWS);
  const end = Math.min(
    entries.length,
    Math.ceil((scroller.scrollTop + viewportHeight) / VIRTUAL_ROW_HEIGHT) + VIRTUAL_BUFFER_ROWS
  );
  const visibleRows = entries.slice(start, end);

  spacer.style.height = `${entries.length * VIRTUAL_ROW_HEIGHT}px`;
  windowEl.style.transform = `translateY(${start * VIRTUAL_ROW_HEIGHT}px)`;
  windowEl.innerHTML = visibleRows.map(renderListRow).join('');
}

function bindEntryEvents() {
  dom.contentArea.onclick = (event) => {
    const button = event.target.closest('[data-path]');
    if (!button || !dom.contentArea.contains(button)) return;

    const path = pathFromAttr(button.dataset.path);
    const entry = state.entryByPath.get(path) || state.entries.find((item) => item.path === path);
    if (!entry) return;

    if (entry.entryType === 'directory') {
      openPath(entry.path);
      return;
    }

    selectEntry(entry);
  };
}

function selectEntry(entry) {
  const previousPath = state.selectedPath;
  state.selectedPath = entry.path;
  updateSelectedRows(previousPath, entry.path);
  renderPreview(entry);
  if (shouldAutoFullscreenPreview() && !state.fullscreenOpen) {
    if (isImageEntry(entry) || isMusicPlayerEntry(entry)) {
      openFullscreenPreview(entry);
    }
  }
}

function updateSelectedRows(previousPath, nextPath) {
  dom.contentArea.querySelectorAll('[data-path]').forEach((element) => {
    const path = pathFromAttr(element.dataset.path);
    if (path === previousPath || path === nextPath) {
      element.classList.toggle('selected', path === nextPath);
    }
  });
}

function imagePreviewEntries() {
  return state.entries.filter(isImageEntry);
}

function selectedEntry() {
  return state.entryByPath.get(state.selectedPath) || null;
}

function adjacentImageEntry(direction) {
  const images = imagePreviewEntries();
  if (!images.length) return null;
  const currentIndex = images.findIndex((entry) => entry.path === state.selectedPath);
  const startIndex = currentIndex === -1 ? 0 : currentIndex;
  const nextIndex = Math.min(Math.max(startIndex + direction, 0), images.length - 1);
  return images[nextIndex] || null;
}

function moveImagePreview(direction) {
  const next = adjacentImageEntry(direction);
  if (!next || next.path === state.selectedPath) return;
  selectEntry(next);
}

function updateFullscreenNavButtons() {
  const overlay = document.getElementById('fullscreenPreview');
  if (!overlay) return;
  const images = imagePreviewEntries();
  const currentIndex = images.findIndex((entry) => entry.path === state.selectedPath);
  const previousButton = overlay.querySelector('[data-fullscreen-action="previous"]');
  const nextButton = overlay.querySelector('[data-fullscreen-action="next"]');
  if (previousButton) previousButton.disabled = currentIndex <= 0;
  if (nextButton) nextButton.disabled = currentIndex === -1 || currentIndex >= images.length - 1;
}

function ensureFullscreenPreview() {
  let overlay = document.getElementById('fullscreenPreview');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'fullscreenPreview';
  overlay.className = 'fullscreen-preview';
  overlay.innerHTML = `
    <div class="fullscreen-topbar">
      <div class="fullscreen-title">
        <h2 id="fullscreenPreviewTitle">预览</h2>
        <p id="fullscreenPreviewMeta"></p>
      </div>
      <div class="fullscreen-actions">
        <button class="icon-button" type="button" data-fullscreen-action="previous" aria-label="上一个" title="上一个">${icons.up}</button>
        <button class="icon-button" type="button" data-fullscreen-action="next" aria-label="下一个" title="下一个">${icons.down}</button>
        <button class="icon-button" type="button" data-fullscreen-action="close" aria-label="关闭" title="关闭">${icons.close}</button>
      </div>
    </div>
    <div class="fullscreen-body" id="fullscreenPreviewBody"></div>
  `;

  overlay.addEventListener('click', (event) => {
    const action = event.target.closest('[data-fullscreen-action]')?.dataset.fullscreenAction;
    if (!action) return;
    if (action === 'previous') moveImagePreview(-1);
    if (action === 'next') moveImagePreview(1);
    if (action === 'close') closeFullscreenPreview();
  });

  overlay.addEventListener('touchstart', (event) => {
    fullscreenTouchStartY = event.touches[0]?.clientY || 0;
  }, { passive: true });

  overlay.addEventListener('touchend', (event) => {
    const endY = event.changedTouches[0]?.clientY || 0;
    const deltaY = endY - fullscreenTouchStartY;
    if (Math.abs(deltaY) < 48) return;
    event.preventDefault();
    moveImagePreview(deltaY < 0 ? 1 : -1);
  }, { passive: false });

  overlay.addEventListener('touchmove', (event) => {
    event.preventDefault();
  }, { passive: false });

  document.body.appendChild(overlay);
  return overlay;
}

function openFullscreenPreview(entry = selectedEntry()) {
  if (!isImageEntry(entry) && !isMusicPlayerEntry(entry)) return;
  state.fullscreenOpen = true;
  lockPageScroll();
  document.body.classList.add('fullscreen-open');
  ensureFullscreenPreview();
  destroyPreviewMusicPlayer();
  renderFullscreenPreview(entry);
}

function closeFullscreenPreview() {
  if (!state.fullscreenOpen) return;
  state.fullscreenOpen = false;
  document.body.classList.remove('fullscreen-open');
  unlockPageScroll();
}

function destroyPreviewMusicPlayer() {
  if (!previewMusicPlayer) return;
  previewMusicPlayer.destroy();
  previewMusicPlayer = null;
}

function renderFullscreenPreview(entry) {
  if (!isImageEntry(entry) && !isMusicPlayerEntry(entry)) return;
  const overlay = ensureFullscreenPreview();
  const isAudio = isMusicPlayerEntry(entry);

  overlay.querySelector('#fullscreenPreviewTitle').textContent = entry.name;
  overlay.querySelector('#fullscreenPreviewMeta').textContent = `${typeLabel(entry)} · ${formatBytes(entry.size)}`;

  overlay.querySelectorAll('[data-fullscreen-action="previous"], [data-fullscreen-action="next"]').forEach((b) => {
    b.style.display = isAudio ? 'none' : '';
  });

  if (isImageEntry(entry)) {
    const images = imagePreviewEntries();
    const currentIndex = images.findIndex((item) => item.path === entry.path);
    if (currentIndex >= 0) {
      const meta = overlay.querySelector('#fullscreenPreviewMeta');
      meta.textContent += ` · ${currentIndex + 1}/${images.length}`;
    }
    updateFullscreenNavButtons();
  }

  renderPreviewBody(entry, overlay.querySelector('#fullscreenPreviewBody'), { fullscreen: true });
}

function bindPreviewKeyboard() {
  document.addEventListener('keydown', (event) => {
    if (!state.fullscreenOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFullscreenPreview();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveImagePreview(-1);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveImagePreview(1);
    }
  });
}

function renderPreview(entry) {
  destroyPreviewMusicPlayer();

  if (!entry) {
    dom.previewTitle.textContent = '预览';
    dom.previewMeta.textContent = '';
    dom.previewActions.innerHTML = '';
    dom.previewBody.innerHTML = '<div class="preview-empty">选择文件</div>';
    return;
  }

  dom.previewTitle.textContent = entry.name;
  dom.previewMeta.textContent = `${typeLabel(entry)} · ${formatBytes(entry.size)}`;
  const showFullscreen = isImageEntry(entry) || isMusicPlayerEntry(entry);
  dom.previewActions.innerHTML = `
    <button class="icon-button" type="button" id="openPreviewButton" aria-label="新窗口打开" title="新窗口打开">${icons.open}</button>
    ${
      showFullscreen
        ? `<button class="icon-button" type="button" id="fullscreenPreviewButton" aria-label="全屏预览" title="全屏预览">${icons.fullscreen}</button>`
        : ''
    }
  `;

  document.getElementById('openPreviewButton').addEventListener('click', () => {
    invoke('open_external', { path: entry.absolutePath });
  });

  document.getElementById('fullscreenPreviewButton')?.addEventListener('click', () => {
    openFullscreenPreview(entry);
  });

  renderPreviewBody(entry, dom.previewBody);
  if (state.fullscreenOpen) {
    if (isImageEntry(entry) || isMusicPlayerEntry(entry)) {
      renderFullscreenPreview(entry);
    } else {
      closeFullscreenPreview();
    }
  }
}

async function renderPreviewBody(entry, container, options = {}) {
  const imageSize = options.fullscreen ? 2200 : 1400;

  if (entry.kind === 'image') {
    container.innerHTML = `
      <div class="image-preview-stage loading">
        <div class="loading-bar" aria-label="加载中"><span></span></div>
        <img class="preview-image" alt="${escapeHtml(entry.name)}" decoding="async">
      </div>
    `;
    const stage = container.querySelector('.image-preview-stage');
    const image = container.querySelector('.preview-image');
    image.addEventListener('load', () => stage.classList.remove('loading'), { once: true });
    image.src = await imagePreviewUrl(entry, imageSize);
    if (image.complete) stage.classList.remove('loading');
    return;
  }

  const url = await resourceUrl(entry);

  if (entry.kind === 'pdf') {
    container.innerHTML = `<iframe class="preview-frame" src="${escapeHtml(url)}" title="${escapeHtml(entry.name)}"></iframe>`;
    return;
  }

  if (isMusicPlayerEntry(entry)) {
    const selectedPath = entry.path;
    const selectedUrl = await resourceUrl(entry);
    const { audio, currentIndex } = await musicPlaylistFor(entry);
    if (state.selectedPath !== selectedPath) return;

    container.innerHTML = `
      <div class="media-preview-stage music-player-stage">
        <span class="file-icon">${icons.audio}</span>
        <strong>音乐预览</strong>
        <div class="aplayer-host"></div>
        <audio class="preview-audio aplayer-fallback" src="${escapeHtml(selectedUrl)}" controls preload="metadata"></audio>
      </div>
    `;
    const fallback = container.querySelector('.aplayer-fallback');
    try {
      previewMusicPlayer = new APlayer({
        container: container.querySelector('.aplayer-host'),
        mutex: true,
        preload: 'metadata',
        listMaxHeight: '180px',
        listmaxheight: '180px',
        theme: '#1264a3',
        audio
      });
      if (currentIndex > 0) previewMusicPlayer.switchAudio(currentIndex);
      fallback.hidden = true;
    } catch (error) {
      fallback.hidden = false;
    }
    return;
  }

  if (entry.kind === 'video') {
    container.innerHTML = `<video class="preview-video" src="${escapeHtml(url)}" controls></video>`;
    return;
  }

  if (entry.kind === 'text') {
    renderTextPreview(entry, container, url);
    return;
  }

  container.innerHTML = `
    <div class="unsupported-preview">
      ${icons.binary}
      <strong>无法直接预览</strong>
      <span class="preview-meta-line">${escapeHtml(entry.mime || 'application/octet-stream')}</span>
    </div>
  `;
}

async function renderTextPreview(entry, container, url) {
  if (entry.size > TEXT_PREVIEW_LIMIT) {
    container.innerHTML = `
      <div class="unsupported-preview">
        ${icons.text}
        <strong>文本文件过大</strong>
        <span class="preview-meta-line">${formatBytes(entry.size)}</span>
      </div>
    `;
    return;
  }

  const selectedPath = entry.path;
  container.innerHTML = '<div class="loading-bar" aria-label="加载中"><span></span></div>';
  try {
    const response = await fetch(url);
    const text = await response.text();
    if (state.selectedPath !== selectedPath) return;
    container.innerHTML = '<pre class="text-preview"></pre>';
    container.querySelector('.text-preview').textContent = text;
  } catch (error) {
    if (state.selectedPath !== selectedPath) return;
    container.innerHTML = `
      <div class="unsupported-preview">
        ${icons.text}
        <strong>${escapeHtml(error.message)}</strong>
      </div>
    `;
  }
}

function updateNavButtons() {
  dom.backButton.disabled = state.backStack.length === 0;
  dom.forwardButton.disabled = state.forwardStack.length === 0;
  dom.listViewButton.classList.toggle('active', state.view === 'list');
  dom.gridViewButton.classList.toggle('active', state.view === 'grid');
}

function goBack() {
  if (!state.backStack.length) return;
  const previous = state.backStack.pop();
  state.forwardStack.push(state.currentPath);
  openPath(previous, { pushHistory: false });
}

function goForward() {
  if (!state.forwardStack.length) return;
  const next = state.forwardStack.pop();
  state.backStack.push(state.currentPath);
  openPath(next, { pushHistory: false });
}

function bindToolbar() {
  dom.backButton.addEventListener('click', goBack);
  dom.forwardButton.addEventListener('click', goForward);
  dom.chooseRootButton.addEventListener('click', chooseRoot);
  dom.portLockButton.addEventListener('click', toggleSharePortLock);
  dom.shareAddresses.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy-url]');
    if (!button || !dom.shareAddresses.contains(button)) return;

    try {
      await copyText(button.dataset.copyUrl);
      showShareCopyFeedback('已复制');
    } catch {
      showShareCopyFeedback('复制失败', true);
    }
  });
  dom.refreshButton.addEventListener('click', async () => {
    await loadModules();
    await loadShareInfo();
    await openPath(state.currentPath, { pushHistory: false });
  });

  dom.searchInput.addEventListener('input', () => {
    state.search = dom.searchInput.value;
    renderContent({
      path: state.currentPath,
      name: state.currentPath ? state.currentPath.split('/').at(-1) : '首页',
      entries: state.entries
    });
  });

  dom.listViewButton.addEventListener('click', () => setView('list'));
  dom.gridViewButton.addEventListener('click', () => setView('grid'));
}

function setView(view) {
  state.view = view;
  localStorage.setItem('finder-anywhere-view', view);
  updateNavButtons();
  renderContent({
    path: state.currentPath,
    name: state.currentPath ? state.currentPath.split('/').at(-1) : '首页',
    entries: state.entries
  });
}

async function loadAppConfig() {
  const config = await invoke('app_config');
  state.savedSharePort = config.sharePort || config.lockedSharePort || null;
  state.sharePortLocked = Boolean(config.sharePortLocked || config.lockedSharePort);

  const legacyPort = Number(localStorage.getItem('finder-anywhere-locked-port')) || null;
  if (!state.savedSharePort && legacyPort) {
    const migratedConfig = await invoke('set_share_port_config', {
      port: legacyPort,
      locked: true
    });
    state.savedSharePort = migratedConfig.sharePort || null;
    state.sharePortLocked = Boolean(migratedConfig.sharePortLocked);
  }
  localStorage.removeItem('finder-anywhere-locked-port');
  updatePortLockButton();
}

async function init() {
  bindToolbar();
  bindPreviewKeyboard();
  updateNavButtons();
  renderPreview(null);

  state.root = localStorage.getItem('finder-anywhere-root') || '';
  await loadAppConfig();
  await loadModules();
  await loadShareInfo();
  await openPath('', { pushHistory: false });
}

init().catch((error) => {
  renderError(String(error));
});
