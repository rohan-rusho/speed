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

// Initialize
async function init() {
    initTheme();
    setupEventListeners();
    await checkConfig();
    startStatsPolling();
}

// Stats Polling
function startStatsPolling() {
    // Poll every 3 seconds
    setInterval(async () => {
        try {
            const res = await fetch('/api/stats');
            if (res.ok) {
                const data = await res.json();
                if (onlineCountSpan) {
                    // TCP counts include the idle connections, so we subtract basic connections if we want exact unique user IPs, 
                    // but for a File server "HITS", raw TCP connections is often accurate enough or cooler looking.
                    onlineCountSpan.textContent = data.connections || 1;
                }
            }
        } catch (err) {
            // Silently fail, it will retry next tick
        }
    }, 3000);
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
        // Show a glorious custom smooth loader as requested
        fileContainer.innerHTML = `<div class="col-span-full flex flex-col items-center justify-center py-32 transition-opacity duration-500">
            <div class="relative w-16 h-16 mb-4">
                <div class="absolute inset-0 bg-brand-cyan blur-lg opacity-20 rounded-full animate-pulse"></div>
                <div class="absolute inset-0 border-4 border-transparent border-t-brand-cyan border-r-brand-purple rounded-full animate-spin"></div>
                <div class="absolute inset-0 flex items-center justify-center text-brand-cyan">
                    <i class="ph-fill ph-files text-2xl"></i>
                </div>
            </div>
            <h3 class="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-brand-cyan to-brand-purple animate-pulse">Loading files...</h3>
        </div>`;

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

        // Clear search so the new folder's contents aren't immediately filtered out
        if (searchInput) {
            searchInput.value = '';
        }

        updateBreadcrumbs();
        renderFiles();
    } catch (err) {
        showToast('Failed to load directory', 'error');
        fileContainer.innerHTML = '<div class="col-span-full text-center py-20 text-red-500"><i class="ph ph-warning-circle text-4xl mb-2"></i><p>Could not load files</p></div>';
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
            const { iconClass } = getFileIcon(false, ext);

            if (currentCategory === 'media') return iconClass.includes('video') || iconClass.includes('audio') || iconClass.includes('image');
            if (currentCategory === 'docs') return iconClass.includes('file-text') || iconClass.includes('pdf');
            if (currentCategory === 'archives') return iconClass.includes('archive');
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

    fileContainer.innerHTML = '';

    if (displayFiles.length === 0) {
        fileContainer.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
                <i class="ph ph-folder-open text-6xl mb-4"></i>
                <p class="text-lg">No files found</p>
            </div>
        `;
        return;
    }

    if (currentView === 'list') {
        fileContainer.className = 'flex flex-col gap-2 pb-10';
        fileContainer.innerHTML = `
            <div class="hidden md:flex items-center px-4 py-3 text-xs font-semibold text-gray-500 tracking-wider uppercase border-b border-dark-border mb-2">
                <div class="w-12"></div>
                <div class="flex-1 min-w-0">Name</div>
                <div class="w-48 px-2">Date Modified</div>
                <div class="w-24 text-right px-2">Size</div>
                <div class="w-20"></div>
            </div>
        `;
    } else {
        fileContainer.className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6 pb-10';
    }

    displayFiles.forEach(file => {
        const fullPath = currentPath === '' ? `/${file.name}` : `${currentPath}/${file.name}`;
        const fileExt = file.isDirectory ? '' : file.name.split('.').pop().toLowerCase();
        const { svg, iconColorClass } = getFileIcon(file.isDirectory, fileExt);
        const colorOnly = iconColorClass.split(' ').find(c => c.startsWith('text-')) || 'text-gray-400';
        const formattedSize = file.isDirectory ? '--' : formatBytes(file.size);
        const dateModified = formatDate(file.mtime);

        const card = document.createElement('div');

        if (currentView === 'list') {
            card.className = 'flex items-center gap-3 p-3 rounded-xl bg-dark-card border border-dark-border hover:bg-dark-hover transition-colors cursor-pointer group';

            card.innerHTML = `
                <div class="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center ${colorOnly} bg-dark-bg group-hover:scale-110 transition-transform">
                    <div class="w-6 h-6">${svg}</div>
                </div>
                <div class="flex-1 min-w-0">
                    <h3 class="font-medium text-white truncate" title="${file.name}">${file.name}</h3>
                    <p class="text-xs text-gray-400 md:hidden mt-0.5">${formattedSize} • ${dateModified}</p>
                </div>
                <div class="w-48 hidden md:block text-sm text-gray-400 px-2 truncate">
                    ${dateModified}
                </div>
                <div class="w-24 hidden md:block text-sm text-gray-400 text-right px-2 whitespace-nowrap">
                    ${formattedSize}
                </div>
                <div class="w-20 shrink-0 flex flex-row items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    ${file.isDirectory ?
                    `<button class="w-8 h-8 rounded border border-dark-border text-gray-300 hover:text-white hover:bg-dark-hover flex items-center justify-center transition-colors" title="Open"><i class="ph ph-arrow-right"></i></button>`
                    :
                    `<a href="/api/download${fullPath}" download class="w-8 h-8 rounded border border-primary-500/30 text-primary-500 flex items-center justify-center hover:bg-primary-500/10 transition-colors" title="Download"><i class="ph ph-download-simple"></i></a>`
                }
                </div>
            `;
        } else {
            // High-End Premium Grid Card
            card.className = 'file-card bg-dark-card border border-dark-border rounded-3xl p-5 flex flex-col items-center justify-center text-center cursor-pointer relative overflow-hidden h-56 w-full group/card transition-all duration-500 hover:border-white/20 shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:-translate-y-2';

            const ext = file.isDirectory ? '' : file.name.split('.').pop().toLowerCase();
            const { svg, iconColorClass } = getFileIcon(file.isDirectory, ext);
            
            // "icon-something text-color" -> extract "text-color"
            const colorOnly = iconColorClass.split(' ').find(c => c.startsWith('text-')) || 'text-gray-400';
            const glowColor = colorOnly.replace('text-', '');
            
            card.innerHTML = `
                <!-- Huge Subtle Radiant Glow Background with Pulse -->
                <div class="absolute inset-0 opacity-0 group-hover/card:opacity-100 transition-opacity duration-700 pointer-events-none bg-gradient-to-b from-transparent to-${glowColor.replace('text-', 'bg-')}/30 group-hover/card:animate-pulse"></div>
                <div class="absolute -top-10 -right-10 w-32 h-32 opacity-0 group-hover/card:opacity-100 transition-opacity duration-700 pointer-events-none rounded-full blur-[40px] ${glowColor.replace('text-', 'bg-')}/40 group-hover/card:animate-pulse"></div>
                
                <!-- Main Animated Icon Box -->
                <div class="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${colorOnly.replace('text-', 'bg-').split(' ')[0]}/10 border border-${glowColor.replace('text-', 'bg-')}/20 ${colorOnly} transform group-hover/card:scale-110 transition-all duration-500 relative z-10 shadow-[0_0_15px_rgba(0,0,0,0.5)] overflow-hidden">
                    <div class="w-10 h-10 relative z-10 transition-all duration-300 group-hover/card:-translate-y-10 group-hover/card:opacity-0">${svg}</div>
                    
                    <!-- File Format & Size Overlay on Hover -->
                    <div class="absolute inset-0 rounded-2xl overflow-hidden bg-dark-bg/90 backdrop-blur-md opacity-0 group-hover/card:opacity-100 transition-all duration-300 flex flex-col items-center justify-center transform translate-y-full group-hover/card:translate-y-0 z-20">
                        <span class="text-[10px] font-black tracking-widest uppercase text-${glowColor}">${file.isDirectory ? 'DIR' : ext}</span>
                        <span class="text-[11px] font-bold text-white mt-1 whitespace-nowrap drop-shadow-md">${file.isDirectory ? '--' : formatBytes(file.size, 0)}</span>
                    </div>
                </div>
                
                <!-- Expanded File Name Area -->
                <div class="w-full z-10 relative flex flex-col items-center flex-1 justify-between transition-all duration-300">
                    <div class="w-full">
                        <h3 class="font-bold text-[0.95rem] leading-tight text-white line-clamp-2 w-full px-1 group-hover/card:text-${glowColor.split('-')[0]}-300 transition-colors drop-shadow-md" title="${file.name}">${file.name}</h3>
                    </div>
                    <!-- Highly Visible Size Badge -->
                    <div class="mt-2 bg-dark-bg/60 border border-white/5 rounded-full px-3 py-1 shadow-inner opacity-80 group-hover/card:opacity-100 group-hover/card:border-white/20 transition-all min-w-[max-content]">
                        <p class="text-[0.7rem] uppercase tracking-wider text-gray-300 font-extrabold">${file.isDirectory ? 'Directory' : formattedSize}</p>
                    </div>
                </div>

                <!-- Hidden Overlay Actions (Download/Play) -->
                <div class="absolute inset-x-3 bottom-3 translate-y-12 opacity-0 group-hover/card:translate-y-0 group-hover/card:opacity-100 transition-all duration-400 z-20 flex gap-2">
                    <button class="flex-1 py-2 bg-white text-black hover:bg-gray-200 rounded-xl text-xs font-bold transition-all shadow-[0_0_20px_rgba(255,255,255,0.3)] flex items-center justify-center gap-1" onclick="handleCardAction(event, ${file.isDirectory}, '${fullPath.replace(/'/g, "\\'")}', '${fileExt}', '${file.name.replace(/'/g, "\\'")}')">
                        ${file.isDirectory ? '<i class="ph-bold ph-folder-open text-sm"></i> Open' : '<i class="ph-bold ph-play text-sm"></i> Play'}
                    </button>
                    ${!file.isDirectory ?
                    `<a href="/api/download${fullPath}" download class="w-10 h-10 flex items-center justify-center bg-dark-bg/80 backdrop-blur border border-white/20 hover:border-brand-cyan hover:text-brand-cyan text-white rounded-xl transition-all shadow-lg font-bold" title="Download directly" onclick="event.stopPropagation()"><i class="ph-bold ph-download-simple text-lg"></i></a>`
                    : ''}
                </div>
            `;
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
    if (['mp4', 'mkv', 'webm', 'mp3', 'wav', 'ogg'].includes(ext)) {
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
    const linkUrl = window.location.origin + (['mp4', 'mkv', 'webm', 'mp3', 'wav', 'ogg'].includes(ext) ? streamUrl : downloadUrl);
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

    // Update Gallery State if media
    const isMedia = ['mp4', 'mkv', 'webm', 'mp3', 'wav', 'ogg', 'jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
    if (isMedia) {
        // Create an array of all media files in the current folder, sorting alphabetically for simplicity
        currentMediaList = currentFiles.filter(f => {
            if (f.isDirectory) return false;
            const fExt = f.name.split('.').pop().toLowerCase();
            return ['mp4', 'mkv', 'webm', 'mp3', 'wav', 'ogg', 'jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fExt);
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

    if (['mp4', 'mkv', 'webm'].includes(ext)) {
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
                type: `video/${ext === 'mkv' ? 'webm' : ext}`,
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

            // 3. Mount Player HTML
            mediaContainer.innerHTML = `<video id="plyr-video" crossorigin playsinline autoplay></video>`;
            
            // 4. Init Plyr with tracks
            if (window.plyrInstance) window.plyrInstance.destroy();
            
            window.plyrInstance = new Plyr('#plyr-video', {
                controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'captions', 'settings', 'pip', 'airplay', 'fullscreen'],
                settings: ['quality', 'speed', 'loop'],
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
                sources: sources
            };

            // Inject Custom Audio Selection UI into Plyr Controls if Multiple Tracks Exist
            if (info.audio && info.audio.length > 1) {
                window.plyrInstance.once('ready', () => {
                    // Small delay to ensure DOM is fully rendered by Plyr
                    setTimeout(() => {
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
                                
                                // Reboot player with custom FFmpeg mapped stream and time skip
                                window.plyrInstance.source = {
                                    type: 'video',
                                    sources: [{
                                        src: `/api/stream-custom${encodeURIComponent(path)}?audio=${audioIdx}&time=${Math.floor(currentTime)}`,
                                        type: 'video/mp4',
                                        size: origHeight
                                    }]
                                };
                                
                                // Call play directly. Play promises resolve when buffering permits it.
                                setTimeout(() => {
                                    const playPromise = window.plyrInstance.play();
                                    if (playPromise !== undefined) {
                                        playPromise.catch(error => console.log('Autoplay prevented:', error));
                                    }
                                }, 200);
                            };
                        });
                    }, 100); // Close setTimeout
                });
            }

        } catch (err) {
            console.error(err);
            mediaContainer.innerHTML = `<div class="p-8 text-center text-red-500"><i class="ph ph-warning-circle text-4xl mb-4"></i><p>Failed to load media info. Falling back to default player.</p></div>`;
            setTimeout(() => {
                mediaContainer.innerHTML = `<video id="plyr-video" crossorigin playsinline autoplay><source src="${streamUrl}" type="video/${ext === 'mkv' ? 'webm' : ext}"></video>`;
                window.plyrInstance = new Plyr('#plyr-video');
            }, 1000);
        }
    } else if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) {
        // Audio player (Plyr UI & space styling)
        let t = ext === 'm4a' ? 'mp4' : ext;
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
            controls: ['play', 'progress', 'current-time', 'mute', 'volume']
        });
    } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
        // Image preview (using download link for raw file since it's just HTTP GET)
        mediaContainer.innerHTML = `<img src="${downloadUrl}" alt="${file.name}">`;
        openModal();
    } else if (ext === 'pdf') {
        // PDF preview iframe
        mediaContainer.innerHTML = `<iframe src="${downloadUrl}" class="w-full h-full rounded-lg bg-white" frameborder="0"></iframe>`;
        openModal();
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
    homeBtn.className = 'text-gray-500 hover:text-brand-cyan font-medium whitespace-nowrap px-2 py-1 rounded transition-colors';
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
        chevron.className = 'text-gray-400 mx-1';
        chevron.innerHTML = '<i class="ph ph-caret-right"></i>';
        breadcrumbsContainer.appendChild(chevron);

        // Crumb
        const crumb = document.createElement('button');
        crumb.className = `whitespace-nowrap px-2 py-1 rounded font-medium transition-colors ${isLast
            ? 'text-white bg-dark-hover cursor-default'
            : 'text-gray-500 hover:text-brand-cyan'
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
            svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full drop-shadow-[0_4px_12px_rgba(139,92,246,0.6)]"><path d="M19.5 7.5h-5.22l-2.06-2.57A2.25 2.25 0 0 0 10.47 4.2H4.5A2.25 2.25 0 0 0 2.25 6.45v11.1a2.25 2.25 0 0 0 2.25 2.25h15a2.25 2.25 0 0 0 2.25-2.25v-7.8a2.25 2.25 0 0 0-2.25-2.25Z"/></svg>`,
            iconColorClass: 'icon-folder text-brand-purple'
        };
    }

    const extLower = (ext || '').toLowerCase();

    // 1. Hardware/Platform Binaries
    if (['exe', 'msi', 'bat'].includes(extLower)) {
        return { // Windows Logo
            svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full drop-shadow-[0_4px_12px_rgba(59,130,246,0.6)]"><path d="M22.5 11.25V3a.75.75 0 0 0-1.157-.63l-9.75 6.25A.75.75 0 0 0 11.25 9.25v2H22.5ZM1.5 12v6.75a.75.75 0 0 0 1.157.63l8.25-5.25a.75.75 0 0 0 .343-.63V12H1.5Zm9.75-2.75v-4.5a.75.75 0 0 0-1.157-.63l-8.25 5.25A.75.75 0 0 0 1.5 10v2h9.75ZM22.5 12.75h-11.25v6.5a.75.75 0 0 0 .343.63l9.75 6.25a.75.75 0 0 0 1.157-.63V12.75Z"/></svg>`,
            iconColorClass: 'icon-app text-blue-500' // Distinct vibrant blue for Windows tools
        };
    }
    if (['apk', 'aab'].includes(extLower)) {
        return { // Android Bot representation
            svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full drop-shadow-[0_4px_12px_rgba(16,185,129,0.7)]"><path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM9 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm7.5 1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" clip-rule="evenodd" /><path d="M12 4.5a.75.75 0 0 1 .75.75v1.656a5.256 5.256 0 0 1 2.246.791l1.107-1.107a.75.75 0 0 1 1.06 1.061l-1.037 1.037c1.378 1.442 2.124 3.4 2.124 5.562H5.75c0-2.162.746-4.12 2.124-5.562l-1.037-1.037a.75.75 0 0 1 1.06-1.061l1.107 1.107c.692-.472 1.44-.755 2.246-.791V5.25A.75.75 0 0 1 12 4.5Z" /></svg>`,
            iconColorClass: 'icon-app text-emerald-500' // Google green
        };
    }
    if (['dmg', 'app', 'pkg', 'ipa'].includes(extLower)) {
        return { // Apple/Mac
            svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full drop-shadow-[0_4px_12px_rgba(209,213,219,0.5)]"><path d="M18.75 19.5c0 1.243-1.007 2.25-2.25 2.25H7.5c-1.243 0-2.25-1.007-2.25-2.25v-15c0-1.243 1.007-2.25 2.25-2.25h9.56l5.69 5.69v11.56ZM17.25 7.5V3.375l3.875 3.875h-3.875ZM8.25 12a1.5 1.5 0 0 0-1.5 1.5v3A1.5 1.5 0 0 0 8.25 18h7.5a1.5 1.5 0 0 0 1.5-1.5v-3a1.5 1.5 0 0 0-1.5-1.5h-7.5Z"/></svg>`,
            iconColorClass: 'icon-app text-gray-300' // Sleek aluminum silver
        };
    }
    
    // 2. Media / Standard types
    const icons = {
        video: ['mp4', 'mkv', 'avi', 'mov', 'webm'],
        audio: ['mp3', 'wav', 'ogg', 'm4a', 'flac'],
        image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'],
        pdf: ['pdf'],
        archive: ['zip', 'rar', '7z', 'tar', 'gz'],
        code: ['js', 'json', 'html', 'css', 'ts', 'py', 'java', 'xml', 'php'],
        doc: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'md', 'csv']
    };

    if (icons.video.includes(extLower)) return { svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full drop-shadow-[0_4px_12px_rgba(6,182,212,0.6)]"><path fill-rule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm14.024-.983a1.125 1.125 0 0 1 0 1.966l-5.603 3.113A1.125 1.125 0 0 1 9 15.113V8.887c0-.857.921-1.4 1.671-.983l5.603 3.113Z" clip-rule="evenodd" /></svg>`, iconColorClass: 'icon-video text-brand-cyan' };
    if (icons.audio.includes(extLower)) return { svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full drop-shadow-[0_4px_12px_rgba(217,70,239,0.7)]"><path fill-rule="evenodd" d="M19.36 2.766a.75.75 0 0 0-1.002-.511l-9 3A.75.75 0 0 0 8.85 6v10.518A2.99 2.99 0 0 0 6.75 16.5a3 3 0 1 0 3 3V9.697l7.5-2.5v9.32a2.99 2.99 0 0 0-2.1 0 3 3 0 1 0 3 3V2.766Z" clip-rule="evenodd"/></svg>`, iconColorClass: 'icon-audio text-fuchsia-500' };
    if (icons.image.includes(extLower)) return { svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full drop-shadow-[0_4px_12px_rgba(251,191,36,0.6)]"><path fill-rule="evenodd" d="M1.5 6a2.25 2.25 0 0 1 2.25-2.25h16.5A2.25 2.25 0 0 1 22.5 6v12a2.25 2.25 0 0 1-2.25 2.25H3.75A2.25 2.25 0 0 1 1.5 18V6ZM3 16.06V18c0 .414.336.75.75.75h16.5A.75.75 0 0 0 21 18v-1.94l-2.69-2.689a1.5 1.5 0 0 0-2.12 0l-.88.879.97.97a.75.75 0 1 1-1.06 1.06l-5.16-5.159a1.5 1.5 0 0 0-2.12 0L3 16.061Zm10.125-7.81a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0Z" clip-rule="evenodd"/></svg>`, iconColorClass: 'icon-image text-amber-400' };
    if (icons.pdf.includes(extLower)) return { svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full drop-shadow-[0_4px_12px_rgba(244,63,94,0.6)]"><path d="M19.5 22.5a3 3 0 0 0 3-3v-8.104a3 3 0 0 0-.879-2.121l-5.12-5.121A3 3 0 0 0 14.38 3.25H6a3 3 0 0 0-3 3v2.25a.75.75 0 0 0 1.5 0V6.25a1.5 1.5 0 0 1 1.5-1.5h8.25a.75.75 0 0 0 .53-.22l5.12-5.121a.75.75 0 0 1 .22.53v8.104a1.5 1.5 0 0 1-1.5 1.5h-7.5a3 3 0 0 0-3 3v4.5H6.25a1.5 1.5 0 0 1-1.5-1.5V15a.75.75 0 0 0-1.5 0v5.5a3 3 0 0 0 3 3H19.5Zm-8.25-5.25v4.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5v-4.5a1.5 1.5 0 0 0-1.5-1.5h-6a1.5 1.5 0 0 0-1.5 1.5Z" /></svg>`, iconColorClass: 'icon-pdf text-rose-500' };
    if (icons.archive.includes(extLower)) return { svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full drop-shadow-[0_4px_12px_rgba(234,179,8,0.7)]"><path fill-rule="evenodd" d="M4.25 12a.75.75 0 0 1 .75-.75h14a.75.75 0 0 1 0 1.5H5a.75.75 0 0 1-.75-.75Zm0 4.5a.75.75 0 0 1 .75-.75h14a.75.75 0 0 1 0 1.5H5a.75.75 0 0 1-.75-.75Zm0-9a.75.75 0 0 1 .75-.75h14a.75.75 0 0 1 0 1.5H5a.75.75 0 0 1-.75-.75Z" clip-rule="evenodd"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2h11A2.5 2.5 0 0 1 20 4.5v15a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 19.5v-15ZM6.5 3.5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-15a1 1 0 0 0-1-1h-11Z"/></svg>`, iconColorClass: 'icon-archive text-yellow-500' };
    if (icons.code.includes(extLower)) return { svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full drop-shadow-[0_4px_12px_rgba(249,115,22,0.6)]"><path fill-rule="evenodd" d="M14.447 3.026a.75.75 0 0 1 .527.921l-4.5 16.5a.75.75 0 0 1-1.448-.394l4.5-16.5a.75.75 0 0 1 .921-.527ZM16.72 6.22a.75.75 0 0 1 1.06 0l5.25 5.25a.75.75 0 0 1 0 1.06l-5.25 5.25a.75.75 0 1 1-1.06-1.06L21.44 12l-4.72-4.72a.75.75 0 0 1 0-1.06Zm-9.44 0a.75.75 0 0 1 0 1.06L2.56 12l4.72 4.72a.75.75 0 0 1-1.06 1.06l-5.25-5.25a.75.75 0 0 1 0-1.06l5.25-5.25a.75.75 0 0 1 1.06 0Z" clip-rule="evenodd" /></svg>`, iconColorClass: 'icon-code text-orange-500' };
    if (icons.doc.includes(extLower)) return { svg: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full opacity-70"><path fill-rule="evenodd" d="M4.5 2.25h9l6 6v11.25a2.25 2.25 0 0 1-2.25 2.25h-12.75A2.25 2.25 0 0 1 2.25 19.5v-15A2.25 2.25 0 0 1 4.5 2.25Zm8.25 1.5v4.5h4.5l-4.5-4.5ZM3.75 19.5a.75.75 0 0 0 .75.75h12.75a.75.75 0 0 0 .75-.75v-9H12a1.5 1.5 0 0 1-1.5-1.5v-6H4.5a.75.75 0 0 0-.75.75v15Z" clip-rule="evenodd" /></svg>`, iconColorClass: 'icon-doc text-gray-300' };

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
    const bgColors = {
        success: 'bg-emerald-500',
        error: 'bg-red-500',
        info: 'bg-blue-500'
    };

    toast.className = `toast-enter text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 w-80 ${bgColors[type]}`;

    const icons = {
        success: 'ph-check-circle',
        error: 'ph-warning-circle',
        info: 'ph-info'
    };

    toast.innerHTML = `
        <i class="ph-fill ${icons[type]} text-xl"></i>
        <div class="flex-1 font-medium text-sm break-words">${message}</div>
        <button class="shrink-0 hover:bg-black/20 p-1 rounded transition-colors" onclick="this.parentElement.remove()">
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
                    fileContainer.innerHTML = '<div class="col-span-full flex justify-center py-20 text-gray-500"><div class="animate-spin text-3xl"><i class="ph ph-circle-notch"></i></div><p class="mt-4 text-gray-400">Searching subfolders...</p></div>';

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

            // Update UI state
            viewToggles.forEach(t => t.classList.remove('active', 'text-white'));
            viewToggles.forEach(t => t.classList.add('text-gray-500'));

            btn.classList.add('active');
            btn.classList.remove('text-gray-500');

            renderFiles();
        };

        // Init active state securely
        if (btn.dataset.view === currentView) {
            btn.classList.add('active');
            btn.classList.remove('text-gray-500');
        } else {
            btn.classList.add('text-gray-500');
        }
    });

    // Upload Event Listeners
    if (uploadBtn && uploadInput) {
        uploadBtn.onclick = () => uploadInput.click();
        uploadInput.onchange = uploadFiles;
    }

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
    const files = event.target.files;
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
                const speedMbps = (speedBps / (1024 * 1024)).toFixed(2);
                uploadSpeedText.textContent = `${speedMbps} MB/s`;

                lastTime = now;
                lastLoaded = e.loaded;
            }

            // Update loaded size txt
            uploadSizeText.textContent = `${(e.loaded / (1024 * 1024)).toFixed(2)} MB / ${(e.total / (1024 * 1024)).toFixed(2)} MB`;
        }
    };

    xhr.onload = () => {
        activeUploads--;
        if (activeUploads === 0) releaseWakeLock();
        
        if (xhr.status === 200) {
            uploadStatusText.textContent = 'Upload Complete!';
            uploadProgressBar.classList.replace('from-primary-500', 'from-green-500');
            uploadProgressBar.classList.replace('to-purple-500', 'to-emerald-500');
            showToast('Files uploaded successfully!', 'success');

            // Wait a sec then hide and refresh
            setTimeout(() => {
                uploadContainer.classList.add('hidden');
                uploadContainer.classList.remove('flex');
                // reset bar color
                uploadProgressBar.classList.replace('from-green-500', 'from-primary-500');
                uploadProgressBar.classList.replace('to-emerald-500', 'to-purple-500');
                loadFiles(currentPath);
            }, 2000);
        } else {
            uploadStatusText.textContent = 'Upload Failed';
            showToast('Failed to upload files', 'error');
            setTimeout(() => {
                uploadContainer.classList.add('hidden');
                uploadContainer.classList.remove('flex');
            }, 3000);
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
