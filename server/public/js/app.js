// DOM Elements
const body = document.documentElement;
const setupView = document.getElementById('setup-view');
const appView = document.getElementById('app-view');
const setupForm = document.getElementById('setup-form');
const rootDirInput = document.getElementById('root-dir-input');
const setupError = document.getElementById('setup-error');
const fileContainer = document.getElementById('file-container');
const breadcrumbsContainer = document.getElementById('breadcrumbs');
const searchInput = document.getElementById('search-input');
const viewToggles = document.querySelectorAll('.view-toggle');
const sortSelect = document.getElementById('sort-select');
const themeToggleBtn = document.getElementById('theme-toggle');
const settingsToggleBtn = document.getElementById('settings-toggle');
const setupCancelBtn = document.getElementById('setup-cancel');

// Media Modal Elements
const mediaModal = document.getElementById('media-modal');
const mediaContainer = document.getElementById('media-container');
const closeModalBtn = document.getElementById('close-modal');
const mediaTitle = document.getElementById('media-title');
const mediaDownload = document.getElementById('media-download');
const toastContainer = document.getElementById('toast-container');
const onlineCountSpan = document.getElementById('online-count');
const globalPreloader = document.getElementById('global-preloader');
const mediaPrevBtn = document.getElementById('media-prev');
const mediaNextBtn = document.getElementById('media-next');
const mediaCounter = document.getElementById('media-counter');

// Upload Elements
const uploadBtn = document.getElementById('upload-btn');
const uploadInput = document.getElementById('upload-input');
const uploadContainer = document.getElementById('upload-progress-container');
const uploadStatusText = document.getElementById('upload-status-text');
const uploadPercentage = document.getElementById('upload-percentage');
const uploadProgressBar = document.getElementById('upload-progress-bar');
const uploadSizeText = document.getElementById('upload-size-text');
const uploadSpeedText = document.getElementById('upload-speed-text');

let activeUploads = 0;
let wakeLock = null;

// Audio trick for background execution on strict iOS/Android browsers
const silenceAudio = new Audio('data:audio/mp3;base64,//OExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq');
silenceAudio.loop = true;

window.addEventListener('beforeunload', (e) => {
    if (activeUploads > 0) {
        e.preventDefault();
        e.returnValue = 'Upload in progress. Are you sure you want to leave?';
        return e.returnValue;
    }
});

// Wake Lock Helper
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('Screen Wake Lock active');
            wakeLock.addEventListener('release', () => {
                console.log('Screen Wake Lock released');
            });
        }
        // Fallback/Enhancement: play silent audio
        silenceAudio.play().catch(e => console.log('Audio trick blocked:', e));
    } catch (err) {
        console.error('Wake Lock error:', err);
    }
}

function releaseWakeLock() {
    if (wakeLock !== null) {
        wakeLock.release().then(() => {
            wakeLock = null;
        });
    }
    silenceAudio.pause();
}

// State
let currentPath = '';
let currentFiles = [];
let currentView = 'grid'; // Force grid for premium look
let currentSort = localStorage.getItem('lan-server-sort') || 'name';
let currentCategory = 'all'; // New state for filter chips
let currentMediaList = [];
let currentMediaIndex = -1;
let baseFolderFiles = [];
let searchTimeout;

// ---- v2.0 state & helpers ----
let selectedPaths = new Set();
const TEXT_EXTS = ['txt', 'md', 'json', 'js', 'css', 'html', 'htm', 'py', 'xml', 'csv', 'log', 'ts', 'java', 'php', 'sh', 'yml', 'yaml', 'c', 'cpp', 'h', 'rb', 'go', 'rs', 'sql', 'ini', 'toml', 'srt', 'vtt'];
const THUMB_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v'];
// ---- v2.2 file types: every file either previews in the browser or downloads cleanly ----
const VIDEO_EXTS = ['mp4', 'mkv', 'webm', 'mov', 'm4v', '3gp'];
const VIDEO_UNPLAYABLE_EXTS = ['avi', 'wmv', 'flv', 'mpg', 'mpeg'];
const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus', 'oga'];
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif'];
const IMAGE_UNPLAYABLE_EXTS = ['tif', 'tiff', 'heic', 'heif', 'raw', 'psd'];
// Browser <video> MIME subtype for an extension (mkv/mov need a playable subtype)
function videoMimeSubtype(ext) {
    if (ext === 'mkv') return 'webm';
    if (ext === 'mov' || ext === 'm4v') return 'mp4';
    if (ext === '3gp') return '3gpp';
    return ext;
}
function fullPathFor(file) { return currentPath === '' ? `/${file.name}` : `${currentPath}/${file.name}`; }
function resumeKey(p) { return 'speed-resume:' + p; }
function getResume(p) { const v = parseFloat(localStorage.getItem(resumeKey(p))); return Number.isFinite(v) ? v : 0; }
function saveResume(p, t) { try { if (t > 5) localStorage.setItem(resumeKey(p), String(Math.floor(t))); } catch (e) {} }

// ---- v2.2 video player: full controls, keyboard shortcuts, remembered settings ----
function plyrVideoOptions() {
    return {
        controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'captions', 'settings', 'pip', 'airplay', 'fullscreen'],
        settings: ['quality', 'speed', 'loop'],
        keyboard: { focused: true, global: true },
        seekTime: 10,
        tooltips: { controls: true, seek: true },
        captions: { active: true, language: 'auto', update: true },
        speed: { selected: 1, options: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 4] },
        fullscreen: { enabled: true, fallback: true, iosNative: true },
        loop: { active: false },
        storage: { enabled: true, key: 'speed-plyr' },
        displayDuration: true,
        invertTime: true
    };
}

// ---- v2.2 image viewer zoom: buttons, wheel, drag to pan, double-click fit/100% ----
let imgZoom = { scale: 1, fitScale: 1, x: 0, y: 0, active: false };
function resetImageZoom() { imgZoom = { scale: 1, fitScale: 1, x: 0, y: 0, active: false }; }
function imgZoomEl() { return document.getElementById('img-zoom-target'); }
function imgZoomStage() { return document.getElementById('img-zoom-stage'); }
function applyImageZoom() {
    const img = imgZoomEl(); if (!img) return;
    img.style.transform = `translate(${imgZoom.x}px, ${imgZoom.y}px) scale(${imgZoom.scale})`;
    const label = document.getElementById('img-zoom-label');
    if (label) label.textContent = Math.round(imgZoom.scale * 100) + '%';
}
function fitImageZoom() {
    const img = imgZoomEl(), stage = imgZoomStage(); if (!img || !stage || !img.naturalWidth) return;
    const r = stage.getBoundingClientRect();
    imgZoom.fitScale = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    imgZoom.scale = imgZoom.fitScale; imgZoom.x = 0; imgZoom.y = 0;
    applyImageZoom();
}
function clampImagePan() {
    const img = imgZoomEl(), stage = imgZoomStage(); if (!img || !stage) return;
    const r = stage.getBoundingClientRect();
    const w = img.naturalWidth * imgZoom.scale, h = img.naturalHeight * imgZoom.scale;
    const maxX = Math.max(0, (w - r.width) / 2), maxY = Math.max(0, (h - r.height) / 2);
    imgZoom.x = Math.min(maxX, Math.max(-maxX, imgZoom.x));
    imgZoom.y = Math.min(maxY, Math.max(-maxY, imgZoom.y));
}
function setImageZoom(factor) {
    const img = imgZoomEl(); if (!img) return;
    imgZoom.scale = Math.min(8, Math.max(0.1, imgZoom.scale * factor));
    clampImagePan();
    applyImageZoom();
}
function bindImageZoom() {
    const img = imgZoomEl(), stage = imgZoomStage(); if (!img || !stage) return;
    imgZoom.active = true;
    if (img.complete && img.naturalWidth) fitImageZoom();
    else img.addEventListener('load', fitImageZoom, { once: true });
    document.getElementById('img-zoom-out').onclick = (e) => { e.stopPropagation(); setImageZoom(1 / 1.25); };
    document.getElementById('img-zoom-in').onclick = (e) => { e.stopPropagation(); setImageZoom(1.25); };
    document.getElementById('img-zoom-label').onclick = (e) => { e.stopPropagation(); fitImageZoom(); };
    document.getElementById('img-zoom-fit').onclick = (e) => { e.stopPropagation(); fitImageZoom(); };
    document.getElementById('img-zoom-actual').onclick = (e) => { e.stopPropagation(); imgZoom.scale = 1; imgZoom.x = 0; imgZoom.y = 0; applyImageZoom(); };
    stage.addEventListener('wheel', (e) => { e.preventDefault(); setImageZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
    stage.addEventListener('dblclick', (e) => {
        e.preventDefault();
        if (Math.abs(imgZoom.scale - 1) < 0.01) fitImageZoom();
        else { imgZoom.scale = 1; imgZoom.x = 0; imgZoom.y = 0; applyImageZoom(); }
    });
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    stage.addEventListener('pointerdown', (e) => { dragging = true; sx = e.clientX; sy = e.clientY; ox = imgZoom.x; oy = imgZoom.y; try { stage.setPointerCapture(e.pointerId); } catch (_) {} stage.style.cursor = 'grabbing'; });
    stage.addEventListener('pointermove', (e) => { if (!dragging) return; imgZoom.x = ox + (e.clientX - sx); imgZoom.y = oy + (e.clientY - sy); clampImagePan(); applyImageZoom(); });
    const endDrag = () => { dragging = false; stage.style.cursor = imgZoom.scale > imgZoom.fitScale + 0.01 ? 'grab' : 'default'; };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
}
function formatUptime(sec) {
    sec = sec || 0;
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s2 = sec % 60;
    return h > 0 ? `${h}h ${m}m` : (m > 0 ? `${m}m ${s2}s` : `${s2}s`);
}
function thumbHtml(fullPath, ext, fallbackSvg) {
    if (!THUMB_EXTS.includes(ext)) return '';
    const url = `/api/thumb?path=${encodeURIComponent(fullPath)}`;
    const fallback = fallbackSvg ? `<span class="thumb-fallback">${fallbackSvg}</span>` : '';
    return `<img src="${url}" alt="" loading="lazy" class="w-full h-full object-cover" onerror="this.style.display='none';var f=this.nextElementSibling;if(f)f.style.display='flex';">${fallback}`;
}
window.toggleSelectCheckbox = function (cb) {
    if (cb.checked) selectedPaths.add(cb.dataset.path);
    else selectedPaths.delete(cb.dataset.path);
    updateSelectionToolbar();
};
function updateSelectionToolbar() {
    const bar = document.getElementById('selection-toolbar');
    const count = document.getElementById('selection-count');
    if (!bar) return;
    if (count) count.textContent = selectedPaths.size;
    bar.classList.toggle('hidden', selectedPaths.size === 0);
}
function clearSelection() { selectedPaths.clear(); updateSelectionToolbar(); document.querySelectorAll('.select-checkbox').forEach(c => { c.checked = false; }); }
async function bulkDownload() {
    if (selectedPaths.size === 0) return;
    try {
        const res = await fetch('/api/download-zip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: [...selectedPaths] }) });
        if (!res.ok) throw new Error('Zip failed');
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'selection.zip'; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        showToast('Bulk download started', 'success');
    } catch (e) { showToast('Bulk download failed', 'error'); }
}
async function bulkDelete() {
    if (selectedPaths.size === 0) return;
    if (!confirm(`Move ${selectedPaths.size} item(s) to trash?`)) return;
    try {
        const res = await fetch('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: [...selectedPaths] }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Delete failed');
        showToast('Moved to trash', 'success');
        clearSelection(); loadFiles(currentPath);
    } catch (e) { showToast(e.message || 'Delete failed', 'error'); }
}
async function createFolder() {
    const name = prompt('New folder name:');
    if (!name) return;
    try {
        const res = await fetch('/api/mkdir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: currentPath || '/', name: name.trim() }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create folder');
        showToast('Folder created', 'success'); loadFiles(currentPath);
    } catch (e) { showToast(e.message, 'error'); }
}
window.renameItemByPath = async function (fullPath, oldName) {
    const name = prompt('Rename to:', oldName);
    if (!name || name === oldName) return;
    try {
        const res = await fetch('/api/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: fullPath, newName: name.trim() }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Rename failed');
        showToast('Renamed', 'success'); loadFiles(currentPath);
    } catch (e) { showToast(e.message, 'error'); }
};
window.deleteItemByPath = async function (fullPath, name) {
    if (!confirm(`Move "${name}" to trash?`)) return;
    try {
        const res = await fetch('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: [fullPath] }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Delete failed');
        showToast('Moved to trash', 'success'); loadFiles(currentPath);
    } catch (e) { showToast(e.message, 'error'); }
};
async function openTrash() {
    const modal = document.getElementById('trash-modal');
    const list = document.getElementById('trash-list');
    if (!modal || !list) return;
    list.innerHTML = '<p class="text-slate-500 dark:text-slate-400 text-sm py-6 text-center">Loading trash...</p>';
    modal.classList.remove('hidden');
    try {
        const res = await fetch('/api/trash');
        const data = await res.json();
        const items = data.items || [];
        if (items.length === 0) { list.innerHTML = '<p class="text-slate-500 dark:text-slate-400 text-sm py-6 text-center">Trash is empty</p>'; return; }
        list.innerHTML = '';
        items.forEach(it => {
            const row = document.createElement('div');
            row.className = 'flex items-center gap-3 p-3 rounded-2xl bg-white/70 dark:bg-white/[0.05] border border-white/70 dark:border-white/10 backdrop-blur';
            row.innerHTML = `<div class="flex-1 min-w-0"><p class="text-slate-900 dark:text-white text-sm font-medium truncate" title="${it.name}">${it.name}</p><p class="text-xs text-slate-500 dark:text-slate-400">${it.isDirectory ? 'Folder' : formatBytes(it.size)} &bull; ${formatDate(it.mtime)}</p></div>
                <button class="bg-brand-cyan/15 text-brand-cyan text-xs font-bold rounded-lg px-3 py-2" data-restore="${it.name.replace(/"/g, '&quot;')}">Restore</button>`;
            row.querySelector('[data-restore]').onclick = async () => {
                const r = await fetch('/api/trash/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: it.name }) });
                const d = await r.json();
                if (!r.ok) { showToast(d.error || 'Restore failed', 'error'); return; }
                showToast('Restored: ' + (d.restored || it.name), 'success');
                openTrash(); loadFiles(currentPath);
            };
            list.appendChild(row);
        });
    } catch (e) { list.innerHTML = '<p class="text-red-500 dark:text-red-400 text-sm py-6 text-center">Failed to load trash</p>'; }
}
async function emptyTrash() {
    if (!confirm('Permanently delete everything in trash? This cannot be undone.')) return;
    const res = await fetch('/api/trash/empty', { method: 'POST' });
    if (res.ok) { showToast('Trash emptied', 'success'); openTrash(); } else showToast('Failed to empty trash', 'error');
}
async function showQr() {
    const modal = document.getElementById('qr-modal');
    if (!modal) return;
    try {
        const res = await fetch('/api/qr');
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        document.getElementById('qr-image').src = data.dataUrl;
        document.getElementById('qr-url').textContent = data.url;
        modal.classList.remove('hidden');
    } catch (e) { showToast('Failed to load QR code', 'error'); }
}
// After a language switch through the transcoded stream, the player's clock restarts
// at the switch point — this offset keeps the saved resume position in real file time.
let resumeOffsetSeconds = 0;
function startResumeSaver(filePath) {
    stopResumeSaver();
    window._resumeTimer = setInterval(() => {
        if (window.plyrInstance && window.plyrInstance.currentTime) saveResume(filePath, resumeOffsetSeconds + window.plyrInstance.currentTime);
    }, 5000);
}
function stopResumeSaver() { if (window._resumeTimer) { clearInterval(window._resumeTimer); window._resumeTimer = null; } }
function applyResume(filePath) {
    if (!window.plyrInstance) return;
    const saved = getResume(filePath);
    const trySeek = () => {
        const dur = window.plyrInstance.duration;
        if (saved > 10 && dur && saved < dur * 0.95) {
            window.plyrInstance.currentTime = saved;
            showToast('Resumed from ' + formatUptime(Math.floor(saved)), 'info');
        }
    };
    if (window.plyrInstance.duration) trySeek();
    else window.plyrInstance.once('loadedmetadata', trySeek);
}

// Global File Type Categories mapping
const icons = {
    video: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v', '3gp'],
    audio: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus', 'oga'],
    image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif'],
    pdf: ['pdf'],
    archive: ['zip', 'rar', '7z', 'tar', 'gz'],
    code: ['js', 'json', 'html', 'css', 'ts', 'py', 'java', 'xml', 'php'],
    doc: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'md', 'csv']
};

// Initialize
async function init() {
    initTheme();
    setupEventListeners();
    await checkConfig();
    startStatsPolling();
}

// Stats Polling
function startStatsPolling() {
    // Poll every 5 seconds (v2.0 live stats strip)
    const poll = async () => {
        try {
            const res = await fetch('/api/stats');
            if (res.ok) {
                const data = await res.json();
                if (onlineCountSpan) onlineCountSpan.textContent = data.connections || 1;
                const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
                set('stat-connections', data.connections || 1);
                set('stat-uptime', formatUptime(data.uptimeSeconds || 0));
                set('stat-downloaded', formatBytes(data.bytesDownloaded || 0));
                set('stat-uploaded', formatBytes(data.bytesUploaded || 0));
                if (data.diskFree != null && data.diskTotal) {
                    set('stat-disk', formatBytes(data.diskFree) + ' free');
                    const bar = document.getElementById('stat-disk-bar');
                    if (bar) bar.style.width = Math.round(((data.diskTotal - data.diskFree) / data.diskTotal) * 100) + '%';
                }
            }
        } catch (err) { /* silently retry next tick */ }
    };
    poll();
    setInterval(poll, 5000);
}

// Theme handling
function initTheme() {
    const isDark = localStorage.getItem('lan-server-theme') === 'dark' ||
        (!('lan-server-theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);

    if (isDark) {
        body.classList.add('dark');
    } else {
        body.classList.remove('dark');
    }
}

function toggleTheme() {
    if (body.classList.contains('dark')) {
        body.classList.remove('dark');
        localStorage.setItem('lan-server-theme', 'light');
    } else {
        body.classList.add('dark');
        localStorage.setItem('lan-server-theme', 'dark');
    }
    if (themeToggleBtn) themeToggleBtn.setAttribute('aria-pressed', String(body.classList.contains('dark')));
}

// Configuration
async function checkConfig() {
    try {
        const res = await fetch('/api/config?t=' + Date.now());
        const config = await res.json();

        if (!config.rootDir) {
            setupView.classList.remove('hidden');
            appView.classList.add('hidden');
            hidePreloader();
        } else {
            setupView.classList.add('hidden');
            appView.classList.remove('hidden');
            await loadFiles('/'); // await the initial load
            hidePreloader();
        }
    } catch (err) {
        showToast('Failed to load configuration', 'error');
        hidePreloader();
    }
}

// Helper to hide preloader smoothly
function hidePreloader() {
    if (globalPreloader && !globalPreloader.classList.contains('hidden')) {
        globalPreloader.classList.add('opacity-0');
        setTimeout(() => globalPreloader.classList.add('hidden'), 500);
    }
}

async function saveConfig(e) {
    e.preventDefault();
    const rootDir = rootDirInput.value.trim();
    if (!rootDir) return;

    try {
        const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rootDir })
        });
        const data = await res.json();

        if (data.error) {
            setupError.textContent = data.error;
            setupError.classList.remove('hidden');
        } else {
            setupError.classList.add('hidden');
            setupView.classList.add('hidden');
            appView.classList.remove('hidden');
            currentPath = '';
            loadFiles('/');
            showToast('Server configured successfully', 'success');
        }
    } catch (err) {
        setupError.textContent = 'Network error occurred';
        setupError.classList.remove('hidden');
    }
}

// Gallery Handlers
function updateGalleryControls() {
    if (currentMediaList.length <= 1) {
        if (mediaPrevBtn) mediaPrevBtn.classList.add('hidden');
        if (mediaNextBtn) mediaNextBtn.classList.add('hidden');
        if (mediaCounter) mediaCounter.classList.add('hidden');
        return;
    }

    if (mediaPrevBtn) {
        if (currentMediaIndex > 0) mediaPrevBtn.classList.remove('hidden');
        else mediaPrevBtn.classList.add('hidden');
    }

    if (mediaNextBtn) {
        if (currentMediaIndex < currentMediaList.length - 1) mediaNextBtn.classList.remove('hidden');
        else mediaNextBtn.classList.add('hidden');
    }

    if (mediaCounter) {
        mediaCounter.textContent = `${currentMediaIndex + 1} / ${currentMediaList.length}`;
        mediaCounter.classList.remove('hidden');
    }
}

function showNextMedia() {
    if (currentMediaIndex >= 0 && currentMediaIndex < currentMediaList.length - 1) {
        currentMediaIndex++;
        const nextFile = currentMediaList[currentMediaIndex];
        const nextExt = nextFile.name.split('.').pop().toLowerCase();
        const nextPath = currentPath === '' ? `/${nextFile.name}` : `${currentPath}/${nextFile.name}`;
        handleFileClick(nextFile, nextPath, nextExt);
    }
}

function showPrevMedia() {
    if (currentMediaIndex > 0) {
        currentMediaIndex--;
        const prevFile = currentMediaList[currentMediaIndex];
        const prevExt = prevFile.name.split('.').pop().toLowerCase();
        const prevPath = currentPath === '' ? `/${prevFile.name}` : `${currentPath}/${prevFile.name}`;
        handleFileClick(prevFile, prevPath, prevExt);
    }
}

// File Loading & Rendering
async function loadFiles(dirPath) {
    try {
        // Skeleton shimmer cards while loading (v2.1)
        fileContainer.innerHTML = `<div class="col-span-full grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 md:gap-5" aria-hidden="true">${Array.from({ length: 6 }).map(() => `<div class="rounded-card border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card overflow-hidden"><div class="skeleton aspect-[4/3]"></div><div class="p-3.5 space-y-2"><div class="skeleton h-3.5 rounded-full w-4/5"></div><div class="skeleton h-3 rounded-full w-2/5"></div></div></div>`).join('')}</div>`;

        // Ensure a 500ms minimum smooth transition as requested
        await new Promise(r => setTimeout(r, 500));

        const endpoint = `/api/files${encodeURIComponent(dirPath)}`;
        const res = await fetch(endpoint);
        const data = await res.json();

        if (data.error) {
            showToast(data.error, 'error');
            return;
        }

        currentPath = data.path;
        currentFiles = data.contents;
        baseFolderFiles = [...data.contents];
        clearSelection();

        // Clear search so the new folder's contents aren't immediately filtered out
        if (searchInput) {
            searchInput.value = '';
        }

        updateBreadcrumbs();
        renderFiles();
    } catch (err) {
        showToast('Failed to load directory', 'error');
        fileContainer.innerHTML = `<div class="col-span-full flex flex-col items-center justify-center py-20 text-center">
            <div class="w-16 h-16 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mb-4"><i class="ph ph-warning-circle text-3xl"></i></div>
            <p class="text-lg font-semibold text-slate-900 dark:text-white">Could not load this folder</p>
            <p class="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-5">Check the server is still running, then try again.</p>
            <button onclick="loadFiles(currentPath)" class="bg-gradient-to-r from-cyan-500 to-brand-purple text-white text-sm font-semibold rounded-full px-5 py-2.5 min-h-10">Retry</button>
        </div>`;
    }
}

// Compact page header (v2.1): folder name, item count, total size
function updateFolderHeader(files) {
    const nameEl = document.getElementById('folder-name');
    const countEl = document.getElementById('folder-count');
    const sizeEl = document.getElementById('folder-size');
    if (nameEl) {
        const parts = (currentPath || '').split('/').filter(Boolean);
        nameEl.textContent = parts.length ? parts[parts.length - 1] : 'All Files';
    }
    if (countEl) countEl.textContent = `${files.length} item${files.length === 1 ? '' : 's'}`;
    if (sizeEl) {
        const total = files.reduce((a, f) => a + (f.isDirectory ? 0 : (f.size || 0)), 0);
        sizeEl.textContent = formatBytes(total);
    }
}

function renderFiles() {
    const searchTerm = searchInput.value.toLowerCase();

    // If we're not using backend search but have local filtering
    let displayFiles = currentFiles;

    // Fallback local filtering only if the string is very short
    // Backend search handles deeper matching when string is >= 2 chars
    if (searchTerm.length > 0 && searchTerm.length < 2) {
        displayFiles = displayFiles.filter(f => f.name.toLowerCase().includes(searchTerm));
    }

    // Filter by Category
    if (currentCategory !== 'all') {
        displayFiles = displayFiles.filter(f => {
            if (currentCategory === 'folders') return f.isDirectory;

            if (f.isDirectory) return false;

            const ext = f.name.split('.').pop().toLowerCase();
            const { iconColorClass } = getFileIcon(false, ext);

            if (currentCategory === 'media') return iconColorClass.includes('video') || iconColorClass.includes('audio') || iconColorClass.includes('image');
            if (currentCategory === 'docs') return iconColorClass.includes('doc') || iconColorClass.includes('pdf');
            if (currentCategory === 'archives') return iconColorClass.includes('archive');
            if (currentCategory === 'windows') return ['exe', 'msi', 'bat'].includes(ext);
            if (currentCategory === 'android') return ['apk'].includes(ext);

            return false;
        });
    }

    // Sort
    displayFiles.sort((a, b) => {
        // Always folders first
        if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1;
        }

        // Then sort by chosen criteria
        let valA, valB;
        if (currentSort === 'name') {
            return a.name.localeCompare(b.name);
        } else if (currentSort === 'size') {
            return (a.size || 0) - (b.size || 0);
        } else if (currentSort === 'date') {
            return new Date(b.mtime) - new Date(a.mtime); // Newest first
        }
        return 0;
    });

    updateFolderHeader(displayFiles);
    fileContainer.innerHTML = '';

    if (displayFiles.length === 0) {
        const searching = searchTerm.length > 0;
        fileContainer.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center py-20 text-center">
                <div class="w-20 h-20 rounded-3xl bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-500 flex items-center justify-center mb-5">
                    <i class="ph ${searching ? 'ph-magnifying-glass' : 'ph-folder-open'} text-4xl"></i>
                </div>
                <p class="text-lg font-semibold text-slate-900 dark:text-white">${searching ? `No results for &ldquo;${searchTerm}&rdquo;` : 'This folder is empty'}</p>
                <p class="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-6">${searching ? 'Try a different search, or clear it to see everything here.' : 'Upload files or create a folder to get started.'}</p>
                ${searching
                    ? `<button onclick="document.getElementById('search-input').value='';document.getElementById('search-input').dispatchEvent(new Event('input'))" class="bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-white text-sm font-semibold rounded-full px-5 py-2.5 min-h-10">Clear search</button>`
                    : `<button onclick="document.getElementById('upload-input').click()" class="bg-gradient-to-r from-cyan-500 via-brand-purple to-pink-500 text-white text-sm font-semibold rounded-full px-5 py-2.5 min-h-10 shadow-lg shadow-brand-purple/25">Upload files</button>`}
            </div>
        `;
        return;
    }

    if (currentView === 'list') {
        fileContainer.className = 'flex flex-col gap-1.5 pb-32';
        fileContainer.innerHTML = `
            <div class="hidden md:flex items-center px-4 py-2.5 text-xs font-semibold text-slate-400 dark:text-slate-500 tracking-wider uppercase border-b border-slate-200 dark:border-white/10 mb-1">
                <div class="w-12"></div>
                <div class="flex-1 min-w-0">Name</div>
                <div class="w-48 px-2">Date Modified</div>
                <div class="w-24 text-right px-2">Size</div>
                <div class="w-28"></div>
            </div>
        `;
    } else {
        fileContainer.className = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 md:gap-5 pb-32';
    }

    displayFiles.forEach((file, i) => {
        const fullPath = currentPath === '' ? `/${file.name}` : `${currentPath}/${file.name}`;
        const fileExt = file.isDirectory ? '' : file.name.split('.').pop().toLowerCase();
        const { svg, iconColorClass } = getFileIcon(file.isDirectory, fileExt);
        const colorOnly = iconColorClass.split(' ').find(c => c.startsWith('text-')) || 'text-gray-400';
        const formattedSize = file.isDirectory ? '--' : formatBytes(file.size);
        const dateModified = formatDate(file.mtime);

        const card = document.createElement('div');

        if (currentView === 'list') {
            card.className = 'file-row card-enter flex items-center gap-3 px-3 py-2.5 rounded-2xl bg-white/70 dark:bg-white/[0.05] backdrop-blur-xl border border-white/70 dark:border-white/10 hover:bg-white/90 dark:hover:bg-white/[0.09] shadow-sm cursor-pointer group';
            card.style.animationDelay = Math.min(i, 12) * 30 + 'ms';

            const thumb = thumbHtml(fullPath, fileExt, '<div class="w-6 h-6">' + svg + '</div>');
            card.innerHTML = `
                <label class="card-checkbox shrink-0 flex items-center min-w-5" onclick="event.stopPropagation()"><input type="checkbox" class="select-checkbox w-5 h-5 accent-teal-400" data-path="${fullPath.replace(/"/g, '&quot;')}" onchange="toggleSelectCheckbox(this)"></label>
                <div class="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center ${colorOnly} ${colorOnly.replace('text-', 'bg-').split(' ')[0]}/10 overflow-hidden">
                    ${thumb ? thumb : `<div class="w-6 h-6">${svg}</div>`}
                </div>
                <div class="flex-1 min-w-0">
                    <h3 class="font-semibold text-[14px] text-slate-900 dark:text-white truncate" title="${file.name}">${file.name}</h3>
                    <p class="text-xs text-slate-500 dark:text-slate-400 md:hidden mt-0.5">${formattedSize} &bull; ${dateModified}</p>
                </div>
                <div class="w-48 hidden md:block text-sm text-slate-500 dark:text-slate-400 px-2 truncate">
                    ${dateModified}
                </div>
                <div class="w-24 hidden md:block text-sm text-slate-500 dark:text-slate-400 text-right px-2 whitespace-nowrap">
                    ${formattedSize}
                </div>
                <div class="w-28 shrink-0 flex flex-row items-center justify-end gap-1.5">
                    <button data-action="rename" class="w-9 h-9 min-w-9 rounded-full text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 flex items-center justify-center transition-colors" title="Rename"><i class="ph ph-pencil-simple text-lg"></i></button>
                    <button data-action="delete" class="w-9 h-9 min-w-9 rounded-full text-red-500 hover:bg-red-500/10 flex items-center justify-center transition-colors" title="Delete to trash"><i class="ph ph-trash text-lg"></i></button>
                    ${file.isDirectory
                    ? `<button data-action="play" class="w-9 h-9 min-w-9 rounded-full text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 flex items-center justify-center transition-colors" title="Open"><i class="ph ph-arrow-right text-lg"></i></button>`
                    : `<a href="/api/download${fullPath}" download class="w-9 h-9 min-w-9 rounded-full text-brand-cyan hover:bg-brand-cyan/10 flex items-center justify-center transition-colors" title="Download"><i class="ph ph-download-simple text-lg"></i></a>`
                }
                </div>
            `;
            bindCardActions(card, file, fullPath, fileExt);
        } else {
            const ext = file.isDirectory ? '' : file.name.split('.').pop().toLowerCase();
            const extLower = ext.toLowerCase();
            let cardClass = 'card-unknown';
            if (file.isDirectory) cardClass = 'card-folder';
            else {
                if (icons.video.includes(extLower)) cardClass = 'card-video';
                else if (icons.audio.includes(extLower)) cardClass = 'card-audio';
                else if (icons.image.includes(extLower)) cardClass = 'card-image';
                else if (icons.pdf.includes(extLower)) cardClass = 'card-pdf';
                else if (icons.archive.includes(extLower)) cardClass = 'card-archive';
                else if (icons.code.includes(extLower)) cardClass = 'card-code';
                else if (icons.doc.includes(extLower)) cardClass = 'card-doc';
                else if (['exe', 'msi', 'bat'].includes(extLower)) cardClass = 'card-app-windows';
                else if (['apk', 'aab'].includes(extLower)) cardClass = 'card-app-android';
                else if (['dmg', 'app', 'pkg', 'ipa'].includes(extLower)) cardClass = 'card-app-apple';
            }

            // Modern media-style card (v2.1): thumbnail on top, meta below
            const isThumb = THUMB_EXTS.includes(extLower);
            // v2.2: only video/audio get a Play button — images get a zoom/view icon, the rest an Open icon
            const isVideoFile = VIDEO_EXTS.includes(extLower) || VIDEO_UNPLAYABLE_EXTS.includes(extLower);
            const isAudioFile = AUDIO_EXTS.includes(extLower);
            const isImageFile = IMAGE_EXTS.includes(extLower);
            const overlayIcon = (isVideoFile || isAudioFile) ? 'ph-play' : (isImageFile ? 'ph-magnifying-glass-plus' : 'ph-arrow-square-out');
            const overlayTitle = (isVideoFile || isAudioFile) ? 'Play' : (isImageFile ? 'View image' : 'Open');
            const cardBtnLabel = (isVideoFile || isAudioFile) ? 'Play' : (isImageFile ? 'View' : 'Open');
            const cardBtnIcon = (isVideoFile || isAudioFile) ? 'ph-play' : (isImageFile ? 'ph-magnifying-glass-plus' : 'ph-arrow-square-out');
            const tileTint = colorOnly.replace('text-', 'bg-').split(' ')[0];
            card.className = `file-card card-enter group/card glass-card relative flex flex-col overflow-hidden rounded-card shadow-card cursor-pointer ${cardClass}`;
            card.style.animationDelay = Math.min(i, 12) * 30 + 'ms';

            const gridThumb = thumbHtml(fullPath, ext, '<div class="w-10 h-10">' + svg + '</div>');
            card.innerHTML = `
                <div class="relative aspect-[4/3] overflow-hidden bg-slate-100 dark:bg-dark-bg shrink-0">
                    ${gridThumb ? gridThumb : `<div class="w-full h-full flex items-center justify-center bg-gradient-to-br ${tileTint}/15 to-transparent ${colorOnly}"><div class="w-12 h-12">${svg}</div></div>`}
                    <span class="absolute top-2 right-2 z-20 rounded-full bg-black/55 backdrop-blur px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">${file.isDirectory ? 'Folder' : (fileExt || 'File')}</span>
                    ${!file.isDirectory ? `<button data-action="play" class="absolute inset-0 z-10 flex items-center justify-center bg-black/0 group-hover/card:bg-black/30 transition-colors" title="${overlayTitle}" aria-label="${overlayTitle}"><span class="w-12 h-12 rounded-full bg-white/95 text-slate-900 flex items-center justify-center opacity-0 group-hover/card:opacity-100 scale-90 group-hover/card:scale-100 transition-all shadow-xl"><i class="ph-fill ${overlayIcon} text-xl"></i></span></button>` : ''}
                </div>
                <label class="card-checkbox absolute top-2 left-2 z-30 bg-white/90 dark:bg-black/60 backdrop-blur rounded-lg p-1.5 shadow-sm" onclick="event.stopPropagation()"><input type="checkbox" class="select-checkbox w-4 h-4 accent-teal-400 block" data-path="${fullPath.replace(/"/g, '&quot;')}" onchange="toggleSelectCheckbox(this)"></label>
                <div class="flex flex-1 flex-col gap-0.5 p-3">
                    <h3 class="font-semibold text-[13px] leading-snug text-slate-900 dark:text-white line-clamp-2" title="${file.name}">${file.name}</h3>
                    <p class="text-xs text-slate-500 dark:text-slate-400">${file.isDirectory ? 'Folder' : formattedSize} &bull; ${dateModified}</p>
                    <div class="mt-auto pt-2 flex items-center gap-1.5">
                        <button data-action="play" class="flex-1 min-h-9 py-2 bg-gradient-to-r from-cyan-500 to-brand-purple hover:opacity-90 text-white rounded-full text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-brand-purple/20 border-0">
                            ${file.isDirectory ? '<i class="ph-bold ph-folder-open text-sm"></i> Open' : `<i class="ph-bold ${cardBtnIcon} text-sm"></i> ${cardBtnLabel}`}
                        </button>
                        ${!file.isDirectory ? `<a href="/api/download${fullPath}" download class="w-9 h-9 min-w-9 flex items-center justify-center bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20 text-slate-700 dark:text-white rounded-full transition-colors" title="Download"><i class="ph-bold ph-download-simple text-base"></i></a>` : ''}
                        <button data-action="rename" class="w-9 h-9 min-w-9 flex items-center justify-center bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20 text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-full transition-colors" title="Rename"><i class="ph-bold ph-pencil-simple text-base"></i></button>
                        <button data-action="delete" class="w-9 h-9 min-w-9 flex items-center justify-center bg-slate-100 dark:bg-white/10 hover:bg-red-500/10 text-red-500 rounded-full transition-colors" title="Delete to trash"><i class="ph-bold ph-trash text-base"></i></button>
                    </div>
                </div>
            `;
            bindCardActions(card, file, fullPath, fileExt);
        }

        card.onclick = (e) => {
            if (e.target.closest('button, a')) return;
            if (file.isDirectory) {
                loadFiles(fullPath);
            } else {
                handleFileClick(file, fullPath, fileExt);
            }
        };

        fileContainer.appendChild(card);
    });
}



// Wire a rendered card's action buttons via closures (v2.1: no inline escaped paths).
// (v2.3.1: querySelectorAll — a card has TWO play buttons, the thumbnail overlay and
// the bottom Play pill; querySelector only wired the first, so the pill did nothing.)
function bindCardActions(card, file, fullPath, fileExt) {
    const bind = (sel, fn) => { card.querySelectorAll(sel).forEach(el => { el.onclick = (e) => { e.stopPropagation(); fn(); }; }); };
    bind('[data-action="rename"]', () => renameItemByPath(fullPath, file.name));
    bind('[data-action="delete"]', () => deleteItemByPath(fullPath, file.name));
    bind('[data-action="play"]', () => {
        if (file.isDirectory) loadFiles(fullPath);
        else handleFileClick(file, fullPath, fileExt);
    });
}

// Handle the explicit button click inside the card
window.handleCardAction = function (e, isDir, fullPath, ext, fileName) {
    e.stopPropagation(); // stop card click
    const fileObj = { name: fileName, isDirectory: isDir };
    if (isDir) {
        loadFiles(fullPath);
    } else {
        handleFileClick(fileObj, fullPath, ext);
    }
}

function getActionButtonsHtml(file, fullPath, ext) {
    const downloadUrl = `/api/download${encodeURIComponent(fullPath)}`;
    const streamUrl = `/api/stream${encodeURIComponent(fullPath)}`;

    let html = '';

    // Play button for media
    if ([...VIDEO_EXTS, ...AUDIO_EXTS].includes(ext)) {
        html += `
            <button class="action-btn flex-1 bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/50 p-1.5 rounded text-lg flex items-center justify-center transition-colors" title="Play" onclick="event.stopPropagation(); handleFileClick({name: '${file.name.replace(/'/g, "\\'")}', isDirectory: false}, '${fullPath.replace(/'/g, "\\'")}', '${ext}')">
                <i class="ph-fill ph-play"></i>
            </button>
        `;
    }

    // Download/Zip button (Zip for folders)
    const downloadIcon = file.isDirectory ? 'ph-file-zip' : 'ph-download-simple';
    html += `
        <a href="${downloadUrl}" class="action-btn block flex-1 bg-gray-100 text-gray-700 dark:bg-dark-bg dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 p-1.5 rounded text-lg flex items-center justify-center transition-colors" title="${file.isDirectory ? 'Download Zip' : 'Download'}">
            <i class="ph-fill ${downloadIcon}"></i>
        </a>
    `;

    // Copy link button
    const linkUrl = window.location.origin + ([...VIDEO_EXTS, ...AUDIO_EXTS].includes(ext) ? streamUrl : downloadUrl);
    html += `
        <button class="action-btn flex-1 bg-gray-100 text-gray-700 dark:bg-dark-bg dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 p-1.5 rounded text-lg flex items-center justify-center transition-colors" onclick="copyLink('${linkUrl}')" title="Copy Link">
            <i class="ph-fill ph-link"></i>
        </button>
    `;

    return html;
}

// Interactions
async function handleFileClick(file, path, ext) {
    const streamUrl = `/api/stream${encodeURIComponent(path)}`;
    const downloadUrl = `/api/download${encodeURIComponent(path)}`;

    mediaTitle.textContent = file.name;
    mediaDownload.href = downloadUrl;
    resetImageZoom(); // a photo's zoom never carries over to the next file
    resumeOffsetSeconds = 0; // a new file starts its own timeline

    // Update Gallery State if media
    const isMedia = [...VIDEO_EXTS, ...AUDIO_EXTS, ...IMAGE_EXTS].includes(ext);
    if (isMedia) {
        // Create an array of all media files in the current folder, sorting alphabetically for simplicity
        currentMediaList = currentFiles.filter(f => {
            if (f.isDirectory) return false;
            const fExt = f.name.split('.').pop().toLowerCase();
            return [...VIDEO_EXTS, ...AUDIO_EXTS, ...IMAGE_EXTS].includes(fExt);
        }).sort((a, b) => a.name.localeCompare(b.name));

        currentMediaIndex = currentMediaList.findIndex(f => f.name === file.name);
        updateGalleryControls();
    } else {
        currentMediaList = [];
        currentMediaIndex = -1;
        if (mediaPrevBtn) mediaPrevBtn.classList.add('hidden');
        if (mediaNextBtn) mediaNextBtn.classList.add('hidden');
        if (mediaCounter) mediaCounter.classList.add('hidden');
    }

    if (VIDEO_EXTS.includes(ext)) {
        // Show fetching loader in modal
        mediaContainer.innerHTML = `<div class="p-12 text-center text-brand-cyan"><i class="ph ph-circle-notch animate-spin text-4xl mb-4"></i><p>Probing media tracks...</p></div>`;
        openModal();

        try {
            // Probe media for audio languages and qualities
            const infoRes = await fetch(`/api/media-info${encodeURIComponent(path)}`);
            const info = await infoRes.json();

            if (info.error) throw new Error(info.error);

            // Construct sources for Plyr
            let sources = [];
            
            // 1. Add Default Original quality
            sources.push({
                src: `/api/stream${encodeURIComponent(path)}`,
                type: `video/${videoMimeSubtype(ext)}`,
                size: info.video[0] ? info.video[0].height : 1080
            });

            // 2. Map Downscaled Qualities (if original is big enough)
            const origHeight = info.video[0] ? info.video[0].height : 1080;
            if (origHeight >= 1080) {
                sources.push({ src: `/api/stream-custom${encodeURIComponent(path)}?res=720`, type: 'video/mp4', size: 720 });
            }
            if (origHeight >= 720) {
                sources.push({ src: `/api/stream-custom${encodeURIComponent(path)}?res=480`, type: 'video/mp4', size: 480 });
            }

            // 2b. Subtitles (v2.0): sibling .srt/.vtt files as Plyr caption tracks
            let tracks = [];
            try {
                const subRes = await fetch(`/api/subtitles?path=${encodeURIComponent(path)}`);
                const subData = await subRes.json();
                tracks = (subData.subtitles || []).map((sub, i) => ({
                    kind: 'captions',
                    label: sub.label || sub.name,
                    srclang: 'en',
                    src: `/api/subtitle-file?path=${encodeURIComponent(sub.path)}`,
                    default: i === 0
                }));
            } catch (e) { /* no subtitles — play without them */ }

            // 3. Mount Player HTML
            mediaContainer.innerHTML = `<video id="plyr-video" crossorigin playsinline autoplay></video>`;
            
            // 4. Init Plyr with tracks
            if (window.plyrInstance) window.plyrInstance.destroy();
            
            window.plyrInstance = new Plyr('#plyr-video', {
                ...plyrVideoOptions(),
                quality: {
                    default: origHeight,
                    options: sources.map(s => s.size),
                    forced: true,
                    onChange: (e) => {
                        console.log("Quality changed to", e);
                    }
                }
            });

            // Assign initial source
            window.plyrInstance.source = {
                type: 'video',
                title: file.name,
                sources: sources,
                tracks: tracks
            };
            // Resume playback (v2.0): seek to saved position, save every 5s
            applyResume(path);
            startResumeSaver(path);

            // Inject Custom Audio Selection UI into Plyr Controls if Multiple Tracks Exist
            // (v2.3: a function now, because Plyr rebuilds its controls on every source
            // change — the Audio row must be put back after a language switch.)
            const injectAudioMenu = () => {
                if (document.getElementById('current-audio-label')) return; // already there
                const controls = window.document.querySelector('.plyr__controls');
                if (!controls) return;
                // Find the core container for the Plymouth popup interface
                const settingsPopupContainer = controls.querySelector('.plyr__menu__container > div');
                const mainSettingsMenu = settingsPopupContainer ? settingsPopupContainer.firstElementChild : null;

                if (!mainSettingsMenu) return;

                // Identify the current track label
                const firstTrackName = (info.audio[0].language && info.audio[0].language !== 'und') ? info.audio[0].language : 'Track 1';

                // 1. Create a native-looking row button inside the main settings menu panel
                const audioRowBtn = document.createElement('button');
                audioRowBtn.type = 'button';
                audioRowBtn.className = 'plyr__control plyr__control--forward';
                audioRowBtn.setAttribute('aria-haspopup', 'true');
                audioRowBtn.setAttribute('aria-controls', 'plyr-settings-audio-menu');
                audioRowBtn.innerHTML = `
                    <span>Audio</span>
                    <span class="plyr__menu__value" id="current-audio-label">${firstTrackName.toUpperCase()}</span>
                `;

                // Append it to the main settings panel
                mainSettingsMenu.appendChild(audioRowBtn);

                // 2. Build the Sub-Menu Panel explicitly mimicking Plymouth standard format
                const audioSubMenu = document.createElement('div');
                audioSubMenu.id = 'plyr-settings-audio-menu';
                audioSubMenu.hidden = true; // Hidden until navigated to

                audioSubMenu.innerHTML = `
                    <button type="button" class="plyr__control plyr__control--back" id="plyr-audio-back">
                        <span class="plyr__sr-only">Go back</span>
                        <span aria-hidden="true">Audio</span>
                    </button>
                    <div role="menu">
                        ${info.audio.map((track, i) => {
                            const trackName = (track.language && track.language !== 'und' ? track.language : `Track ${i+1}`).toUpperCase();
                            return `
                            <button type="button" role="menuitemradio" class="plyr__control" aria-checked="${i === 0 ? 'true' : 'false'}" data-audio-id="${track.customId}">
                                <span>${trackName} <span style="font-size: 0.7em; opacity: 0.6;">(${track.codec})</span></span>
                            </button>`;
                        }).join('')}
                    </div>
                `;

                // Append sub-menu layer directly inside the Plymouth structure alongside 'Speed' or 'Quality' subpanels
                settingsPopupContainer.appendChild(audioSubMenu);

                // 3. Handle Navigation smoothly simulating Plymouth slides
                audioRowBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    mainSettingsMenu.hidden = true;
                    audioSubMenu.hidden = false;
                };

                document.getElementById('plyr-audio-back').onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    audioSubMenu.hidden = true;
                    mainSettingsMenu.hidden = false;
                };

                // The track selector logic is handled below

                // Handle Audio Track Change Request
                audioSubMenu.querySelectorAll('[data-audio-id]').forEach(btn => {
                    btn.onclick = async (e) => {
                        e.stopPropagation();
                        const audioIdx = btn.dataset.audioId;
                        const currentTime = window.plyrInstance.currentTime;

                        // Visual feedback update inside the sub-menu checkboxes
                        audioSubMenu.querySelectorAll('[data-audio-id]').forEach(b => b.setAttribute('aria-checked', 'false'));
                        btn.setAttribute('aria-checked', 'true');

                        // Update main row label
                        const newLabel = btn.querySelector('span').textContent.split(' (')[0].trim();
                        document.getElementById('current-audio-label').textContent = newLabel;

                        // Slide back to main menu instantly
                        audioSubMenu.hidden = true;
                        mainSettingsMenu.hidden = false;

                        // v2.3: try the browser's native audio-track switch first — instant,
                        // keeps time, duration and seeking (Chrome/Edge/Safari).
                        const mediaEl = window.plyrInstance && window.plyrInstance.media;
                        const wantTrack = Number(audioIdx);
                        if (mediaEl && mediaEl.audioTracks && mediaEl.audioTracks.length > 1 && wantTrack < mediaEl.audioTracks.length) {
                            for (let i = 0; i < mediaEl.audioTracks.length; i++) mediaEl.audioTracks[i].enabled = (i === wantTrack);
                            showToast('Audio: ' + newLabel, 'success');
                            return;
                        }
                        // Fallback (Firefox, or files whose tracks the browser won't expose):
                        // reboot with the FFmpeg-mapped stream. Plyr rebuilds its controls on
                        // a source change, so the Audio row is put back afterwards. The new
                        // stream's clock starts at the switch point, so remember the offset —
                        // otherwise resume would save the wrong position.
                        stopResumeSaver();
                        resumeOffsetSeconds = Math.floor(currentTime);
                        window.plyrInstance.source = {
                            type: 'video',
                            title: file.name,
                            sources: [{
                                src: `/api/stream-custom${encodeURIComponent(path)}?audio=${audioIdx}&time=${Math.floor(currentTime)}`,
                                type: 'video/mp4',
                                size: origHeight
                            }],
                            tracks: tracks
                        };
                        showToast('Audio: ' + newLabel, 'success');
                        window.plyrInstance.once('loadedmetadata', () => {
                            startResumeSaver(path);
                            setTimeout(injectAudioMenu, 100);
                        });

                        // Call play directly. Play promises resolve when buffering permits it.
                        setTimeout(() => {
                            const playPromise = window.plyrInstance.play();
                            if (playPromise !== undefined) {
                                playPromise.catch(error => console.log('Autoplay prevented:', error));
                            }
                        }, 200);
                    };
                });
            };
            if (info.audio && info.audio.length > 1) {
                window.plyrInstance.once('ready', () => setTimeout(injectAudioMenu, 100));
            }

        } catch (err) {
            console.error(err);
            mediaContainer.innerHTML = `<div class="p-8 text-center text-red-500"><i class="ph ph-warning-circle text-4xl mb-4"></i><p>Failed to load media info. Falling back to default player.</p></div>`;
            setTimeout(() => {
                mediaContainer.innerHTML = `<video id="plyr-video" crossorigin playsinline autoplay><source src="${streamUrl}" type="video/${videoMimeSubtype(ext)}"></video>`;
                window.plyrInstance = new Plyr('#plyr-video', plyrVideoOptions());
            }, 1000);
        }
    } else if (AUDIO_EXTS.includes(ext)) {
        // Audio player (Plyr UI & space styling)
        let t = ext === 'm4a' ? 'mp4' : (ext === 'oga' ? 'ogg' : ext);
        mediaContainer.innerHTML = `
            <div class="bg-white dark:bg-dark-card border border-[#523cbd]/30 p-8 rounded-2xl w-full max-w-md flex flex-col items-center shadow-2xl relative overflow-hidden">
                <!-- Glowing Space Background Bubble -->
                <div class="absolute inset-0 bg-[#523cbd] blur-[120px] opacity-20 pointer-events-none rounded-full scale-150"></div>
                
                <div class="w-24 h-24 bg-primary-100 dark:bg-[#523cbd]/20 text-[#523cbd] rounded-full flex items-center justify-center mb-6 shadow-[0_0_40px_rgba(82,60,189,0.5)] z-10">
                    <i class="ph-fill ph-music-notes text-4xl"></i>
                </div>
                <h3 class="font-bold text-center mb-6 text-gray-800 dark:text-gray-200 truncate w-full px-4 z-10 relative">${file.name}</h3>
                <div class="w-full z-10 relative">
                    <audio id="plyr-audio" crossorigin playsinline autoplay><source src="${streamUrl}" type="audio/${t}">Your browser does not support audio element.</audio>
                </div>
            </div>
        `;
        openModal();
        // Init Plyr
        if (window.plyrInstance) window.plyrInstance.destroy();
        window.plyrInstance = new Plyr('#plyr-audio', {
            controls: ['play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings'],
            settings: ['speed'],
            speed: { selected: 1, options: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 4] },
            keyboard: { focused: true, global: true },
            seekTime: 10,
            tooltips: { controls: true, seek: true },
            storage: { enabled: true, key: 'speed-plyr' },
            displayDuration: true
        });
    } else if (IMAGE_EXTS.includes(ext)) {
        // Image viewer (v2.2): zoom controls, mouse-wheel zoom, drag to pan, double-click fit/100%
        resetImageZoom();
        mediaContainer.innerHTML = `
        <div class="w-full h-full flex flex-col items-center justify-center min-h-0 gap-2 p-2 md:p-4">
            <div class="flex items-center gap-1.5 bg-black/60 backdrop-blur-md border border-white/10 rounded-full px-2 py-1.5 shadow-2xl z-30">
                <button id="img-zoom-out" class="w-9 h-9 rounded-full text-white hover:bg-white/15 flex items-center justify-center transition-colors" title="Zoom out (-)" aria-label="Zoom out"><i class="ph-bold ph-minus text-lg"></i></button>
                <button id="img-zoom-label" class="min-w-14 px-1 text-sm font-bold text-white text-center" title="Click to fit to screen">100%</button>
                <button id="img-zoom-in" class="w-9 h-9 rounded-full text-white hover:bg-white/15 flex items-center justify-center transition-colors" title="Zoom in (+)" aria-label="Zoom in"><i class="ph-bold ph-plus text-lg"></i></button>
                <span class="w-px h-6 bg-white/15 mx-0.5"></span>
                <button id="img-zoom-fit" class="h-9 px-3 rounded-full text-white hover:bg-white/15 text-xs font-bold transition-colors" title="Fit to screen (0)">Fit</button>
                <button id="img-zoom-actual" class="h-9 px-3 rounded-full text-white hover:bg-white/15 text-xs font-bold transition-colors" title="Actual size 100%">1:1</button>
            </div>
            <div id="img-zoom-stage" class="flex-1 w-full min-h-0 overflow-hidden flex items-center justify-center relative" style="touch-action: none;">
                <img id="img-zoom-target" src="${downloadUrl}" alt="${file.name}" draggable="false" class="max-w-none select-none" style="transform-origin: center center; will-change: transform;">
            </div>
        </div>`;
        openModal();
        bindImageZoom();
    } else if (TEXT_EXTS.includes(ext)) {
        openModal();
        mediaContainer.innerHTML = '<div class="p-12 text-center text-brand-cyan"><i class="ph ph-circle-notch animate-spin text-4xl mb-4"></i><p>Loading preview...</p></div>';
        try {
            const r = await fetch(streamUrl);
            if (!r.ok) throw new Error('Failed to load file');
            const text = await r.text();
            const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            mediaContainer.innerHTML = `<pre class="w-full h-full overflow-auto text-left text-sm text-slate-800 dark:text-gray-200 bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl p-6 whitespace-pre-wrap break-words" style="max-height:100%">${esc}</pre>`;
        } catch (e) {
            mediaContainer.innerHTML = '<div class="p-8 text-center text-red-500"><p>Preview failed — try downloading instead.</p></div>';
        }
    } else if (ext === 'pdf') {
        // PDF preview iframe
        mediaContainer.innerHTML = `<iframe src="${downloadUrl}" class="w-full h-full rounded-lg bg-white" frameborder="0"></iframe>`;
        openModal();
    } else if ([...VIDEO_UNPLAYABLE_EXTS, ...IMAGE_UNPLAYABLE_EXTS, 'wma'].includes(ext)) {
        // Can't be previewed in a browser (old video codecs, raw/TIFF/HEIC photos, WMA) —
        // say so clearly instead of opening a dead player, and offer the download.
        mediaContainer.innerHTML = `
        <div class="bg-white dark:bg-dark-card border border-white/10 rounded-3xl p-8 md:p-10 max-w-md w-full text-center shadow-2xl">
            <div class="w-20 h-20 mx-auto rounded-full bg-slate-100 dark:bg-white/10 flex items-center justify-center text-4xl text-slate-400 dark:text-slate-300 mb-5"><i class="ph-fill ph-file"></i></div>
            <h3 class="font-bold text-lg text-slate-900 dark:text-white mb-2 truncate">${file.name}</h3>
            <p class="text-sm text-slate-500 dark:text-slate-400 mb-6">This file type can't be previewed in the browser. Download it to open it on your PC.</p>
            <div class="flex gap-2 justify-center">
                <a href="${downloadUrl}" download class="px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-brand-purple text-white rounded-full text-sm font-bold shadow-md hover:opacity-90">Download</a>
                <button id="unsupported-close" class="px-5 py-2.5 bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-white rounded-full text-sm font-bold hover:bg-slate-200 dark:hover:bg-white/20">Close</button>
            </div>
        </div>`;
        openModal();
        document.getElementById('unsupported-close').onclick = () => closeModal();
    } else {
        // Default to download
        window.location.href = downloadUrl;
    }
}

function copyLink(url) {
    navigator.clipboard.writeText(url).then(() => {
        showToast('Link copied to clipboard!', 'success');
    }).catch(() => {
        showToast('Failed to copy link', 'error');
    });
}

function updateBreadcrumbs() {
    breadcrumbsContainer.innerHTML = '';

    // Home crumb
    const homeBtn = document.createElement('button');
    homeBtn.className = 'shrink-0 w-9 h-9 min-w-9 rounded-full bg-white/70 dark:bg-white/5 border border-white/70 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-white flex items-center justify-center transition-colors backdrop-blur';
    homeBtn.innerHTML = '<i class="ph-fill ph-house text-lg"></i>';
    homeBtn.onclick = () => loadFiles('/');
    breadcrumbsContainer.appendChild(homeBtn);

    if (currentPath === '') return;

    const parts = currentPath.split('/').filter(p => p !== '');
    let accumulatedPath = '';

    parts.forEach((part, index) => {
        accumulatedPath += `/${part}`;
        const isLast = index === parts.length - 1;

        // Chevron
        const chevron = document.createElement('span');
        chevron.className = 'text-slate-300 dark:text-slate-600 mx-0.5 shrink-0';
        chevron.innerHTML = '<i class="ph ph-caret-right"></i>';
        breadcrumbsContainer.appendChild(chevron);

        // Crumb
        const crumb = document.createElement('button');
        crumb.className = `whitespace-nowrap px-3.5 py-2 rounded-full font-medium text-[13px] transition-colors ${isLast
            ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm border border-white/70 dark:border-white/10 cursor-default font-semibold'
            : 'text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-white hover:bg-white/70 dark:hover:bg-white/5'
            }`;
        crumb.textContent = part;

        if (!isLast) {
            const tgt = accumulatedPath; // Closure capture
            crumb.onclick = () => loadFiles(tgt);
        }

        breadcrumbsContainer.appendChild(crumb);
    });
}

// Media Modal
function openModal() {
    mediaModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    stopResumeSaver();
    resumeOffsetSeconds = 0;
    resetImageZoom();
    // Stop media playback
    if (window.plyrInstance) {
        window.plyrInstance.pause();
        window.plyrInstance.destroy();
        window.plyrInstance = null;
    }
    mediaContainer.innerHTML = '';
    mediaModal.classList.add('hidden');
    document.body.style.overflow = 'auto';
}

// Utils
function getFileIcon(isDirectory, ext) {
    if (isDirectory) {
        return {
            svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full"><path d="M19.5 7.5h-5.22l-2.06-2.57A2.25 2.25 0 0 0 10.47 4.2H4.5A2.25 2.25 0 0 0 2.25 6.45v11.1a2.25 2.25 0 0 0 2.25 2.25h15a2.25 2.25 0 0 0 2.25-2.25v-7.8a2.25 2.25 0 0 0-2.25-2.25Z"/></svg>`,
            iconColorClass: 'icon-folder text-brand-purple'
        };
    }

    const extLower = (ext || '').toLowerCase();

    // 1. Hardware/Platform Binaries
    if (['exe', 'msi', 'bat'].includes(extLower)) {
        return { // Windows Logo
            svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full"><path d="M22.5 11.25V3a.75.75 0 0 0-1.157-.63l-9.75 6.25A.75.75 0 0 0 11.25 9.25v2H22.5ZM1.5 12v6.75a.75.75 0 0 0 1.157.63l8.25-5.25a.75.75 0 0 0 .343-.63V12H1.5Zm9.75-2.75v-4.5a.75.75 0 0 0-1.157-.63l-8.25 5.25A.75.75 0 0 0 1.5 10v2h9.75ZM22.5 12.75h-11.25v6.5a.75.75 0 0 0 .343.63l9.75 6.25a.75.75 0 0 0 1.157-.63V12.75Z"/></svg>`,
            iconColorClass: 'icon-app text-blue-500' // Distinct vibrant blue for Windows tools
        };
    }
    if (['apk', 'aab'].includes(extLower)) {
        return { // Flat Android Bot representation
            svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full"><path d="M6 18c0 .55.45 1 1 1h1v3c0 .55.45 1 1 1s1-.45 1-1v-3h4v3c0 .55.45 1 1 1s1-.45 1-1v-3h1c.55 0 1-.45 1-1V9H6v9zm6-14.93L13.93 1.1a.5.5 0 0 1 .84.54L13.15 4.5c1.94.57 3.47 2.18 3.8 4.25H7.05c.33-2.07 1.86-3.68 3.8-4.25L9.23 1.64a.5.5 0 0 1 .84-.54L12 3.07zM5 9c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1s1-.45 1-1v-6c0-.55-.45-1-1-1zm14 0c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1s1-.45 1-1v-6c0-.55-.45-1-1-1z"/></svg>`,
            iconColorClass: 'icon-app text-emerald-500' // Google green
        };
    }
    if (['dmg', 'app', 'pkg', 'ipa'].includes(extLower)) {
        return { // Apple/Mac
            svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full"><path d="M18.75 19.5c0 1.243-1.007 2.25-2.25 2.25H7.5c-1.243 0-2.25-1.007-2.25-2.25v-15c0-1.243 1.007-2.25 2.25-2.25h9.56l5.69 5.69v11.56ZM17.25 7.5V3.375l3.875 3.875h-3.875ZM8.25 12a1.5 1.5 0 0 0-1.5 1.5v3A1.5 1.5 0 0 0 8.25 18h7.5a1.5 1.5 0 0 0 1.5-1.5v-3a1.5 1.5 0 0 0-1.5-1.5h-7.5Z"/></svg>`,
            iconColorClass: 'icon-app text-gray-300' // Sleek aluminum silver
        };
    }
    
    // 2. Media / Standard types
    const icons = {
        video: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v', '3gp'],
        audio: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus', 'oga'],
        image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif'],
        pdf: ['pdf'],
        archive: ['zip', 'rar', '7z', 'tar', 'gz'],
        code: ['js', 'json', 'html', 'css', 'ts', 'py', 'java', 'xml', 'php'],
        doc: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'md', 'csv']
    };

    if (icons.video.includes(extLower)) return { svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full"><path d="M8 5.14v14c0 .86.94 1.39 1.66.9l10.5-7a1.125 1.125 0 0 0 0-1.8l-10.5-7c-.72-.49-1.66.04-1.66.9z"/></svg>`, iconColorClass: 'icon-video text-brand-cyan' };
    if (icons.audio.includes(extLower)) return { svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h6V3h-8z"/></svg>`, iconColorClass: 'icon-audio text-fuchsia-500' };
    if (icons.image.includes(extLower)) return { svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 16H6c-.55 0-1-.45-1-1v-2.5l3.5-3.5L11 14.5l4.5-4.5L19 14v4c0 .55-.45 1-1 1zm-3-9c-.83 0-1.5-.67-1.5-1.5S14.17 7 15 7s1.5.67 1.5 1.5S15.83 10 15 10z"/></svg>`, iconColorClass: 'icon-image text-amber-400' };
    if (icons.pdf.includes(extLower)) return { svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`, iconColorClass: 'icon-pdf text-rose-500' };
    if (icons.archive.includes(extLower)) return { svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full"><path d="M20 3H4a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10h1a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-1 5H5V5h14v3zm-3 4H8v-2h8v2z"/></svg>`, iconColorClass: 'icon-archive text-yellow-500' };
    if (icons.code.includes(extLower)) return { svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>`, iconColorClass: 'icon-code text-orange-500' };
    if (icons.doc.includes(extLower)) return { svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`, iconColorClass: 'icon-doc text-gray-300' };

    return { 
        svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full opacity-50"><path fill-rule="evenodd" d="M4.5 2.25h9l6 6v11.25a2.25 2.25 0 0 1-2.25 2.25h-12.75A2.25 2.25 0 0 1 2.25 19.5v-15A2.25 2.25 0 0 1 4.5 2.25Zm8.25 1.5v4.5h4.5l-4.5-4.5ZM3.75 19.5a.75.75 0 0 0 .75.75h12.75a.75.75 0 0 0 .75-.75v-9H12a1.5 1.5 0 0 1-1.5-1.5v-6H4.5a.75.75 0 0 0-.75.75v15Z" clip-rule="evenodd" /></svg>`, 
        iconColorClass: 'icon-unknown text-gray-400' 
    };
}

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function formatDate(dateString) {
    if (!dateString) return '--';
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    const iconColors = {
        success: 'text-emerald-500',
        error: 'text-red-500',
        info: 'text-blue-500'
    };

    toast.className = 'toast-enter glass-panel text-slate-900 dark:text-white px-4 py-3 rounded-2xl shadow-lift flex items-center gap-3 w-80';

    const icons = {
        success: 'ph-check-circle',
        error: 'ph-warning-circle',
        info: 'ph-info'
    };

    toast.innerHTML = `
        <i class="ph-fill ${icons[type]} ${iconColors[type]} text-xl shrink-0"></i>
        <div class="flex-1 font-medium text-sm break-words">${message}</div>
        <button class="shrink-0 hover:bg-slate-900/5 dark:hover:bg-white/10 p-1 rounded-full transition-colors" onclick="this.parentElement.remove()">
            <i class="ph ph-x"></i>
        </button>
    `;

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.replace('toast-enter', 'toast-leave');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Event Listeners
function setupEventListeners() {
    if (setupForm) setupForm.onsubmit = saveConfig;
    if (themeToggleBtn) themeToggleBtn.onclick = toggleTheme;
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log("Close Modal Clicked");
            closeModal();
        });
    }

    settingsToggleBtn.onclick = async () => {
        try {
            const res = await fetch('/api/config?t=' + Date.now());
            const config = await res.json();
            rootDirInput.value = config.rootDir || '';
            setupCancelBtn.classList.remove('hidden');
            appView.classList.add('hidden');
            setupView.classList.remove('hidden');
        } catch (err) {
            showToast('Failed to load configuration', 'error');
        }
    };

    setupCancelBtn.onclick = () => {
        setupView.classList.add('hidden');
        appView.classList.remove('hidden');
    };

    // Close modal on background click
    mediaModal.onclick = (e) => {
        if (e.target === mediaModal) closeModal();
    };

    if (searchInput) {
        searchInput.oninput = () => {
            clearTimeout(searchTimeout);
            const searchTerm = searchInput.value.trim().toLowerCase();

            // Local fast-filtering or reset for short queries
            if (searchTerm.length < 2) {
                currentFiles = [...baseFolderFiles];
                renderFiles();
                return;
            }

            // Debounced deep backend search
            searchTimeout = setTimeout(async () => {
                try {
                    fileContainer.innerHTML = `<div class="col-span-full"><p class="text-sm text-slate-500 dark:text-slate-400 text-center pb-4">Searching subfolders...</p><div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 md:gap-5" aria-hidden="true">${Array.from({ length: 6 }).map(() => `<div class="rounded-card border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card overflow-hidden"><div class="skeleton aspect-[4/3]"></div><div class="p-3 space-y-2"><div class="skeleton h-3.5 rounded-full w-4/5"></div><div class="skeleton h-3 rounded-full w-2/5"></div></div></div>`).join('')}</div></div>`;

                    const endpoint = `/api/search${encodeURIComponent(currentPath)}?q=${encodeURIComponent(searchTerm)}`;
                    const res = await fetch(endpoint);
                    const data = await res.json();

                    if (!data.error) {
                        currentFiles = data.contents;
                        renderFiles();
                    }
                } catch (err) {
                    console.error('Search request failed:', err);
                    showToast('Search error', 'error');
                    currentFiles = [...baseFolderFiles];
                    renderFiles();
                }
            }, 400); // Wait 400ms after last keystroke
        };
    }

    sortSelect.onchange = (e) => {
        currentSort = e.target.value;
        localStorage.setItem('lan-server-sort', currentSort);
        renderFiles();
    };

    // Category chip filters
    const filterChips = document.querySelectorAll('.filter-chip');
    filterChips.forEach(chip => {
        chip.onclick = () => {
            // Update active styling
            filterChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');

            // Set state and re-render
            currentCategory = chip.dataset.filter;
            renderFiles();
        };
    });

    viewToggles.forEach(btn => {
        btn.onclick = () => {
            currentView = btn.dataset.view;
            localStorage.setItem('lan-server-view', currentView);
            // Active look is owned by .view-toggle.active in CSS (works in both themes)
            viewToggles.forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            renderFiles();
        };

        // Init active state
        btn.classList.toggle('active', btn.dataset.view === currentView);
    });

    // Keyboard shortcuts (v2.1): Ctrl/Cmd+K focuses search, Esc clears it
    document.addEventListener('keydown', (e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            if (searchInput) { searchInput.focus(); searchInput.select(); }
            return;
        }
        if (e.key === 'Escape' && document.activeElement === searchInput) {
            searchInput.value = '';
            searchInput.blur();
            currentFiles = [...baseFolderFiles];
            renderFiles();
        }
    });

    // Upload Event Listeners
    if (uploadBtn && uploadInput) {
        uploadBtn.onclick = () => uploadInput.click();
        uploadInput.onchange = uploadFiles;
    }

    // v2.0 buttons
    const newFolderBtn = document.getElementById('new-folder-btn');
    if (newFolderBtn) newFolderBtn.onclick = createFolder;
    const qrBtn = document.getElementById('qr-btn');
    if (qrBtn) qrBtn.onclick = showQr;
    const qrClose = document.getElementById('qr-close');
    if (qrClose) qrClose.onclick = () => document.getElementById('qr-modal').classList.add('hidden');
    const qrModal = document.getElementById('qr-modal');
    if (qrModal) qrModal.onclick = (e) => { if (e.target === qrModal) qrModal.classList.add('hidden'); };
    const trashBtn = document.getElementById('trash-btn');
    if (trashBtn) trashBtn.onclick = openTrash;
    const trashClose = document.getElementById('trash-close');
    if (trashClose) trashClose.onclick = () => document.getElementById('trash-modal').classList.add('hidden');
    const trashModal = document.getElementById('trash-modal');
    if (trashModal) trashModal.onclick = (e) => { if (e.target === trashModal) trashModal.classList.add('hidden'); };
    const trashEmptyBtn = document.getElementById('trash-empty-btn');
    if (trashEmptyBtn) trashEmptyBtn.onclick = emptyTrash;
    const bulkDl = document.getElementById('bulk-download-btn');
    if (bulkDl) bulkDl.onclick = bulkDownload;
    const bulkDel = document.getElementById('bulk-delete-btn');
    if (bulkDel) bulkDel.onclick = bulkDelete;
    const selClear = document.getElementById('selection-clear-btn');
    if (selClear) selClear.onclick = clearSelection;

    // Drag & drop upload (v2.0): drop files onto the file container
    const dropOverlay = document.getElementById('drop-overlay');
    let dragDepth = 0;
    if (fileContainer) {
        fileContainer.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; if (dropOverlay) dropOverlay.classList.remove('hidden'); });
        fileContainer.addEventListener('dragover', (e) => { e.preventDefault(); });
        fileContainer.addEventListener('dragleave', (e) => { e.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0 && dropOverlay) dropOverlay.classList.add('hidden'); });
        fileContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            dragDepth = 0;
            if (dropOverlay) dropOverlay.classList.add('hidden');
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) uploadFilesFromFiles(e.dataTransfer.files);
        });
    }
    document.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) { dragDepth++; if (dropOverlay) dropOverlay.classList.remove('hidden'); } });
    document.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0 && dropOverlay) dropOverlay.classList.add('hidden'); });
    document.addEventListener('drop', (e) => { if (dropOverlay) dropOverlay.classList.add('hidden'); });

    // Gallery Listeners
    if (mediaPrevBtn) mediaPrevBtn.onclick = (e) => { e.stopPropagation(); showPrevMedia(); };
    if (mediaNextBtn) mediaNextBtn.onclick = (e) => { e.stopPropagation(); showNextMedia(); };

    document.addEventListener('keydown', (e) => {
        if (!mediaModal.classList.contains('hidden')) {
            if (e.key === 'Escape') {
                closeModal();
                return;
            }
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // Image viewer zoom keys (v2.2): + zoom in, - zoom out, 0 fit to screen
            if (imgZoom.active && (e.key === '+' || e.key === '=')) { setImageZoom(1.25); return; }
            if (imgZoom.active && e.key === '-') { setImageZoom(1 / 1.25); return; }
            if (imgZoom.active && e.key === '0') { fitImageZoom(); return; }

            // If playing video/audio, let plyr use Arrow keys for seek/volume
            if (window.plyrInstance && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) return;

            if (e.key === 'ArrowRight') showNextMedia();
            if (e.key === 'ArrowLeft') showPrevMedia();
        }
    });

    if (mediaContainer) {
        mediaContainer.addEventListener('click', (e) => {
            // Only handle gallery layout clicks if we have multiple media and no video player active
            if (currentMediaList.length <= 1 || window.plyrInstance) return;
            
            // Prevent clicks on explicit buttons/links
            if (e.target.closest('button, a')) return;

            // Image viewer handles its own clicks (zoom/drag) — don't navigate away
            if (e.target.closest('#img-zoom-stage')) return;

            const rect = mediaContainer.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            
            // 35% click zones on left and right for navigation
            if (clickX < rect.width * 0.35) {
                showPrevMedia();
            } else if (clickX > rect.width * 0.65) {
                showNextMedia();
            }
        });
    }

    // Touch Swipe Support for Gallery
    let touchStartX = 0;
    let touchEndX = 0;

    mediaModal.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    mediaModal.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }, { passive: true });

    function handleSwipe() {
        if (mediaModal.classList.contains('hidden')) return;
        // A zoomed-in image pans with the finger instead of switching files
        if (imgZoom.active && imgZoom.scale > imgZoom.fitScale + 0.01) return;
        const swipeThreshold = 50;
        if (touchEndX < touchStartX - swipeThreshold) {
            showNextMedia(); // Swiped Left -> Next
        }
        if (touchEndX > touchStartX + swipeThreshold) {
            showPrevMedia(); // Swiped Right -> Prev
        }
    }
}

// Upload Logic
function uploadFiles(event) {
    uploadFilesFromFiles(event.target.files);
}
function uploadFilesFromFiles(files) {
    if (!files || files.length === 0) return;

    if (activeUploads === 0) {
        requestWakeLock();
    }
    
    activeUploads++;

    // Show Progress UI
    uploadContainer.classList.remove('hidden');
    uploadContainer.classList.add('flex');
    uploadStatusText.textContent = `Uploading ${files.length} file(s)...`;
    uploadProgressBar.style.width = '0%';
    uploadPercentage.textContent = '0%';
    uploadSpeedText.textContent = '0 MB/s';

    // Calculate total size
    let totalSize = 0;
    for (let i = 0; i < files.length; i++) {
        totalSize += files[i].size;
    }
    uploadSizeText.textContent = `0 MB / ${(totalSize / (1024 * 1024)).toFixed(2)} MB`;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
    }

    const xhr = new XMLHttpRequest();
    const uploadPath = currentPath === '' ? '/' : currentPath;
    xhr.open('POST', `/api/upload${uploadPath}`, true);

    let lastTime = Date.now();
    let lastLoaded = 0;

    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100);
            uploadProgressBar.style.width = percentComplete + '%';
            uploadPercentage.textContent = percentComplete + '%';

            // Calculate Speed
            const now = Date.now();
            const timeDiff = (now - lastTime) / 1000; // in seconds
            if (timeDiff > 0.5) { // update speed every 500ms
                const bytesDiff = e.loaded - lastLoaded;
                const speedBps = bytesDiff / timeDiff;
                window._upSpeed = speedBps;
                const speedMbps = (speedBps / (1024 * 1024)).toFixed(2);
                uploadSpeedText.textContent = `${speedMbps} MB/s`;

                lastTime = now;
                lastLoaded = e.loaded;
            }

            // Update loaded size txt + ETA (v2.1)
            uploadSizeText.textContent = `${(e.loaded / (1024 * 1024)).toFixed(2)} MB / ${(e.total / (1024 * 1024)).toFixed(2)} MB`;
            const etaEl = document.getElementById('upload-eta');
            if (etaEl) {
                if (window._upSpeed > 0 && e.loaded < e.total) {
                    const remain = Math.ceil((e.total - e.loaded) / window._upSpeed);
                    etaEl.textContent = remain > 1 ? `~${formatUptime(remain)} left` : '';
                } else {
                    etaEl.textContent = '';
                }
            }
        }
    };

    xhr.onload = () => {
        activeUploads--;
        if (activeUploads === 0) releaseWakeLock();
        
        if (xhr.status === 200) {
            uploadStatusText.textContent = 'Upload Complete!';
            uploadProgressBar.classList.replace('from-[#3B82F6]', 'from-emerald-500');
            uploadProgressBar.classList.replace('to-[#EC4899]', 'to-green-500');
            showToast('Files uploaded successfully!', 'success');

            // Wait a sec then hide and refresh
            setTimeout(() => {
                uploadContainer.classList.add('hidden');
                uploadContainer.classList.remove('flex');
                const etaEl = document.getElementById('upload-eta');
                if (etaEl) etaEl.textContent = '';
                // reset bar color
                uploadProgressBar.classList.replace('from-emerald-500', 'from-[#3B82F6]');
                uploadProgressBar.classList.replace('to-green-500', 'to-[#EC4899]');
                loadFiles(currentPath);
            }, 2000);
        } else {
            uploadStatusText.textContent = 'Upload Failed';
            showToast('Failed to upload files', 'error');
            setTimeout(() => {
                uploadContainer.classList.add('hidden');
                uploadContainer.classList.remove('flex');
                loadFiles(currentPath);
            }, 2000);
        }

        // Reset input so same files can be chosen again
        uploadInput.value = '';
    };

    xhr.onerror = () => {
        activeUploads--;
        if (activeUploads === 0) releaseWakeLock();
        
        uploadStatusText.textContent = 'Upload Error';
        showToast('Network error during upload', 'error');
        setTimeout(() => {
            uploadContainer.classList.add('hidden');
            uploadContainer.classList.remove('flex');
        }, 3000);
        uploadInput.value = '';
    };

    xhr.send(formData);
}

// Start
document.addEventListener('DOMContentLoaded', init);
