const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const mime = require('mime-types');
const archiver = require('archiver');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);
// qrcode is optional: the server must still start on an existing install
// where `npm install` hasn't been re-run yet (e.g. after pulling v2.0).
let QRCode = null;
try {
    QRCode = require('qrcode');
} catch (e) {
    console.warn('[QR] qrcode module not installed — run `npm install` to enable QR codes.');
}
const { getDirectoryContents, searchDirectoryRecursive, resolveSafePath, validateFileName, uniquePath, INTERNAL_DIRS } = require('../utils/fileHandler');
const { counters, addDownloaded, addUploaded, uptimeSeconds } = require('../utils/counters');

const VERSION = '2.0.1';
const TRASH_DIR = '.speed-trash';
const CACHE_DIR = '.speed-cache';

function getLanUrl(port) {
    const ifaces = os.networkInterfaces();
    for (const list of Object.values(ifaces)) {
        for (const a of list || []) {
            if (a.family === 'IPv4' && !a.internal) return `http://${a.address}:${port}`;
        }
    }
    return `http://localhost:${port}`;
}

function srtToVtt(srt) {
    const lines = srt.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const out = ['WEBVTT', ''];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i].trim();
        if (!line) { i++; continue; }
        if (/^\d+$/.test(line)) { i++; continue; }
        if (line.includes('-->')) {
            out.push(line.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2'));
            i++;
            while (i < lines.length && lines[i].trim() !== '') { out.push(lines[i]); i++; }
            out.push('');
        } else {
            i++;
        }
    }
    return out.join('\n');
}

function createApiRouter(getRootDir, opts = {}) {
    const router = express.Router();
    const getPort = opts.getPort || (() => 3001);
    const getServer = opts.getServer || (() => null);

    const PUBLIC_PATHS = new Set(['/health', '/stats', '/qr']);

    router.use((req, res, next) => {
        if (PUBLIC_PATHS.has(req.path)) return next();
        const rootDir = getRootDir();
        if (!rootDir) {
            return res.status(400).json({ error: 'Root directory not configured' });
        }
        try {
            req.requestedPath = decodeURIComponent(req.path.replace(/^\/(files|stream|download|upload|search|media-info|stream-custom|thumb|subtitles|subtitle-file)/, '') || '/');
            req.fullPath = resolveSafePath(rootDir, req.requestedPath);
            next();
        } catch (err) {
            res.status(400).json({ error: 'Invalid path' });
        }
    });

    router.get('/health', (req, res) => {
        res.json({ ok: true, version: VERSION, uptime: uptimeSeconds() });
    });

    router.get('/stats', async (req, res) => {
        const rootDir = getRootDir();
        let disk = { free: null, total: null };
        if (rootDir) {
            try {
                const s = await fs.promises.statfs(rootDir);
                disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
            } catch { /* disk info unavailable */ }
        }
        const server = getServer();
        const send = (connections) => res.json({
            connections,
            uptimeSeconds: uptimeSeconds(),
            bytesDownloaded: counters.bytesDownloaded,
            bytesUploaded: counters.bytesUploaded,
            diskFree: disk.free,
            diskTotal: disk.total,
        });
        if (server && typeof server.getConnections === 'function') {
            server.getConnections((err, count) => send(err ? 1 : count));
        } else {
            send(1);
        }
    });

    router.get('/qr', async (req, res) => {
        const url = getLanUrl(getPort());
        if (!QRCode) {
            return res.status(503).json({ error: 'QR codes unavailable — run `npm install` in the server folder, then restart.', url });
        }
        try {
            const dataUrl = await QRCode.toDataURL(url, { width: 256, margin: 1 });
            res.json({ dataUrl, url });
        } catch (e) {
            res.status(500).json({ error: 'Failed to generate QR code' });
        }
    });

    router.get(/^\/files(.*)$/, async (req, res) => {
        try {
            const stats = await fs.promises.stat(req.fullPath);
            if (stats.isDirectory()) {
                const contents = await getDirectoryContents(req.fullPath);
                res.json({
                    path: req.requestedPath === '/' ? '' : req.requestedPath,
                    isDirectory: true,
                    contents
                });
            } else {
                res.json({
                    name: path.basename(req.fullPath),
                    isDirectory: false,
                    size: stats.size,
                    mtime: stats.mtime,
                    mimeType: mime.lookup(req.fullPath) || 'application/octet-stream'
                });
            }
        } catch (error) {
            console.error(error);
            if (error.code === 'ENOENT') {
                res.status(404).json({ error: 'File or directory not found' });
            } else {
                res.status(500).json({ error: 'Internal server error' });
            }
        }
    });

    router.get(/^\/search(.*)$/, async (req, res) => {
        try {
            const query = req.query.q || '';
            if (query.trim().length === 0) {
                return res.json({ path: req.requestedPath, isSearch: true, contents: [] });
            }
            const stats = await fs.promises.stat(req.fullPath);
            if (!stats.isDirectory()) {
                return res.status(400).json({ error: 'Search path must be a directory' });
            }
            const searchResults = await searchDirectoryRecursive(req.fullPath, req.fullPath, query);
            res.json({
                path: req.requestedPath === '/' ? '' : req.requestedPath,
                isSearch: true,
                contents: searchResults
            });
        } catch (error) {
            console.error('Search API Error:', error);
            res.status(500).json({ error: 'Failed to execute search' });
        }
    });

    router.get(/^\/media-info(.*)$/, async (req, res) => {
        try {
            const filePath = req.fullPath;
            const stats = await fs.promises.stat(filePath);
            if (!stats.isFile()) {
                return res.status(400).json({ error: 'Target must be a file' });
            }
            ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) {
                    console.error('FFprobe Error:', err);
                    return res.status(500).json({ error: 'Failed to probe media' });
                }
                const info = { video: [], audio: [] };
                let audioIndexCounter = 0;
                metadata.streams.forEach(stream => {
                    if (stream.codec_type === 'video') {
                        info.video.push({ index: stream.index, width: stream.width, height: stream.height, codec: stream.codec_name });
                    } else if (stream.codec_type === 'audio') {
                        info.audio.push({ index: stream.index, customId: audioIndexCounter++, language: stream.tags ? (stream.tags.language || stream.tags.title || 'Unknown') : 'Unknown', codec: stream.codec_name, channels: stream.channels });
                    }
                });
                res.json(info);
            });
        } catch (error) {
            console.error('API /media-info error:', error);
            res.status(500).json({ error: 'Internal server error while probing media' });
        }
    });

    // ---- Thumbnails ----
    router.get('/thumb', async (req, res) => {
        const rootDir = getRootDir();
        try {
            const rel = req.query.path || '';
            const filePath = resolveSafePath(rootDir, rel);
            const stats = await fs.promises.stat(filePath);
            if (!stats.isFile()) return res.status(404).json({ error: 'Not a file' });
            const ext = path.extname(filePath).toLowerCase();
            const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].includes(ext);
            const isVideo = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'].includes(ext);
            if (!isImage && !isVideo) return res.status(404).json({ error: 'No thumbnail for this type' });
            const cacheDir = path.join(rootDir, CACHE_DIR, 'thumbs');
            await fs.promises.mkdir(cacheDir, { recursive: true });
            const key = crypto.createHash('sha1').update(filePath + ':' + stats.mtimeMs).digest('hex');
            const cacheFile = path.join(cacheDir, key + '.jpg');
            if (fs.existsSync(cacheFile)) {
                res.set('Cache-Control', 'public, max-age=86400');
                return res.sendFile(cacheFile, { dotfiles: 'allow' });
            }
            const tmpFile = cacheFile + '.tmp.jpg'; // keep a .jpg suffix so ffmpeg can infer the output format
            if (isVideo) {
                await new Promise((resolve, reject) => {
                    ffmpeg.ffprobe(filePath, (err, meta) => {
                        if (err) return reject(err);
                        const dur = (meta.format && meta.format.duration) || 0;
                        const at = Math.max(0, dur * 0.1);
                        ffmpeg(filePath).seekInput(at).outputOptions(['-vframes', '1', '-vf', 'scale=320:-1']).output(tmpFile)
                            .on('end', resolve).on('error', reject).run();
                    });
                });
            } else {
                await new Promise((resolve, reject) => {
                    ffmpeg(filePath).outputOptions(['-vf', 'scale=320:-1']).output(tmpFile)
                        .on('end', resolve).on('error', reject).run();
                });
            }
            await fs.promises.rename(tmpFile, cacheFile).catch(() => {});
            if (!fs.existsSync(cacheFile)) return res.status(404).json({ error: 'Thumbnail failed' });
            res.set('Cache-Control', 'public, max-age=86400');
            res.sendFile(cacheFile, { dotfiles: 'allow' });
        } catch (e) {
            console.error('Thumb error:', e.message);
            res.status(404).json({ error: 'Thumbnail unavailable' });
        }
    });

    // ---- Subtitles ----
    router.get('/subtitles', async (req, res) => {
        const rootDir = getRootDir();
        try {
            const filePath = resolveSafePath(rootDir, req.query.path || '');
            const stats = await fs.promises.stat(filePath);
            if (!stats.isFile()) return res.status(404).json({ error: 'Not a file' });
            const dir = path.dirname(filePath);
            const stem = path.basename(filePath, path.extname(filePath));
            const entries = await fs.promises.readdir(dir);
            const subs = entries
                .filter(n => (n === stem + '.srt' || n === stem + '.vtt') || (n.startsWith(stem + '.') && (n.endsWith('.srt') || n.endsWith('.vtt'))))
                .map(n => {
                    const rel = path.relative(rootDir, path.join(dir, n)).replace(/\\/g, '/');
                    const label = (n === stem + '.srt' || n === stem + '.vtt') ? 'Default' : n.slice(stem.length + 1, -path.extname(n).length);
                    return { name: n, path: '/' + rel, format: path.extname(n).slice(1), label };
                });
            res.json({ subtitles: subs });
        } catch (e) {
            res.status(404).json({ error: 'Subtitles not found' });
        }
    });

    router.get('/subtitle-file', async (req, res) => {
        const rootDir = getRootDir();
        try {
            const filePath = resolveSafePath(rootDir, req.query.path || '');
            const ext = path.extname(filePath).toLowerCase();
            if (ext !== '.vtt' && ext !== '.srt') return res.status(400).json({ error: 'Not a subtitle file' });
            const text = await fs.promises.readFile(filePath, 'utf8');
            res.set('Content-Type', 'text/vtt; charset=utf-8');
            res.send(ext === '.srt' ? srtToVtt(text) : text);
        } catch (e) {
            res.status(404).json({ error: 'Subtitle not found' });
        }
    });

    // ---- File manager ----
    router.post('/mkdir', async (req, res) => {
        const rootDir = getRootDir();
        try {
            const { path: parent = '/', name } = req.body || {};
            if (!validateFileName(name)) return res.status(400).json({ error: 'Invalid folder name' });
            // resolveSafePath itself enforces containment; join via it (parent '/' yields a trailing slash otherwise).
            const target = resolveSafePath(rootDir, `${(parent || '/').replace(/\/+$/, '')}/${name.trim()}`);
            await fs.promises.mkdir(target, { recursive: false });
            res.json({ success: true, name: name.trim() });
        } catch (e) {
            if (e.code === 'EEXIST') return res.status(409).json({ error: 'Already exists' });
            res.status(400).json({ error: e.message || 'Failed to create folder' });
        }
    });

    router.post('/rename', async (req, res) => {
        const rootDir = getRootDir();
        try {
            const { path: rel, newName } = req.body || {};
            if (!validateFileName(newName)) return res.status(400).json({ error: 'Invalid name: no / \\ : * ? " < > | and not empty or "."' });
            const src = resolveSafePath(rootDir, rel || '');
            if (path.normalize(src) === path.normalize(rootDir)) return res.status(400).json({ error: 'Cannot rename root' });
            const dest = path.join(path.dirname(src), newName.trim());
            if (fs.existsSync(dest)) return res.status(409).json({ error: 'A file with that name already exists' });
            await fs.promises.rename(src, dest);
            res.json({ success: true, name: newName.trim() });
        } catch (e) {
            res.status(400).json({ error: e.message || 'Failed to rename' });
        }
    });

    function trashDir(rootDir) { return path.join(rootDir, TRASH_DIR); }

    router.post('/delete', async (req, res) => {
        const rootDir = getRootDir();
        try {
            const paths = (req.body && req.body.paths) || [];
            if (!Array.isArray(paths) || paths.length === 0) return res.status(400).json({ error: 'paths[] required' });
            await fs.promises.mkdir(trashDir(rootDir), { recursive: true });
            const moved = [];
            for (const rel of paths) {
                const src = resolveSafePath(rootDir, rel);
                if (path.normalize(src) === path.normalize(rootDir)) return res.status(400).json({ error: 'Cannot delete root' });
                const base = path.basename(src);
                if (INTERNAL_DIRS.includes(base)) return res.status(403).json({ error: 'Cannot delete internal directory' });
                const stamp = new Date().toISOString().replace(/[:.]/g, '-');
                const dest = uniquePath(path.join(trashDir(rootDir), `${stamp}-${base}`));
                await fs.promises.rename(src, dest);
                moved.push(path.basename(dest));
            }
            res.json({ success: true, moved });
        } catch (e) {
            res.status(400).json({ error: e.message || 'Failed to delete' });
        }
    });

    router.get('/trash', async (req, res) => {
        const rootDir = getRootDir();
        try {
            const dir = trashDir(rootDir);
            if (!fs.existsSync(dir)) return res.json({ items: [] });
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            const items = [];
            for (const e of entries) {
                const full = path.join(dir, e.name);
                const s = await fs.promises.stat(full).catch(() => null);
                if (s) items.push({ name: e.name, isDirectory: e.isDirectory(), size: s.size, mtime: s.mtime });
            }
            items.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
            res.json({ items });
        } catch (e) {
            res.status(500).json({ error: 'Failed to list trash' });
        }
    });

    router.post('/trash/restore', async (req, res) => {
        const rootDir = getRootDir();
        try {
            const { name } = req.body || {};
            if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') return res.status(400).json({ error: 'Invalid trash name' });
            const src = path.join(trashDir(rootDir), name);
            if (src !== trashDir(rootDir) && !src.startsWith(trashDir(rootDir) + path.sep)) return res.status(403).json({ error: 'Access denied' });
            if (!fs.existsSync(src)) return res.status(404).json({ error: 'Not in trash' });
            const original = name.replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-/, '');
            const dest = uniquePath(path.join(rootDir, original));
            await fs.promises.rename(src, dest);
            res.json({ success: true, restored: path.basename(dest) });
        } catch (e) {
            res.status(400).json({ error: e.message || 'Failed to restore' });
        }
    });

    router.post('/trash/empty', async (req, res) => {
        const rootDir = getRootDir();
        try {
            const dir = trashDir(rootDir);
            if (fs.existsSync(dir)) {
                for (const e of await fs.promises.readdir(dir)) {
                    await fs.promises.rm(path.join(dir, e), { recursive: true, force: true });
                }
            }
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: 'Failed to empty trash' });
        }
    });

    // ---- Streaming with proper ranges, HEAD, ETag, 416 ----
    function serveStream(req, res) {
        const filePath = req.fullPath;
        fs.stat(filePath, (err, stats) => {
            if (err) {
                if (err.code === 'ENOENT') return res.status(404).send('File not found');
                return res.status(500).send('Error reading file');
            }
            if (stats.isDirectory()) return res.status(400).send('Cannot stream a directory');
            const total = stats.size;
            const mimeType = mime.lookup(filePath) || 'application/octet-stream';
            const etag = `"${total}-${stats.mtimeMs}"`;
            const lastModified = stats.mtime.toUTCString();
            const common = {
                'Accept-Ranges': 'bytes',
                'ETag': etag,
                'Last-Modified': lastModified,
                'Cache-Control': 'public, max-age=3600',
                'Content-Type': mimeType,
            };
            if (req.headers['if-none-match'] === etag) {
                return res.writeHead(304, common).end();
            }
            if (req.headers['if-modified-since'] && new Date(req.headers['if-modified-since']) >= stats.mtime) {
                return res.writeHead(304, common).end();
            }
            const range = req.headers.range;
            if (!range) {
                if (req.method === 'HEAD') return res.writeHead(200, { ...common, 'Content-Length': total }).end();
                addDownloaded(total);
                res.writeHead(200, { ...common, 'Content-Length': total });
                fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 }).pipe(res);
                return;
            }
            const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
            if (!m || (m[1] === '' && m[2] === '')) {
                return res.writeHead(416, { ...common, 'Content-Range': `bytes */${total}` }).end();
            }
            let start, end;
            if (m[1] === '') {
                const suffix = parseInt(m[2], 10);
                if (isNaN(suffix) || suffix <= 0) return res.writeHead(416, { ...common, 'Content-Range': `bytes */${total}` }).end();
                start = Math.max(0, total - suffix);
                end = total - 1;
            } else {
                start = parseInt(m[1], 10);
                end = m[2] === '' ? total - 1 : parseInt(m[2], 10);
            }
            if (isNaN(start) || isNaN(end) || start >= total || start > end || end >= total) {
                return res.writeHead(416, { ...common, 'Content-Range': `bytes */${total}` }).end();
            }
            const chunksize = (end - start) + 1;
            if (req.method === 'HEAD') {
                return res.writeHead(206, { ...common, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': chunksize }).end();
            }
            addDownloaded(chunksize);
            res.writeHead(206, { ...common, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': chunksize });
            const stream = fs.createReadStream(filePath, { start, end, highWaterMark: 1024 * 1024 });
            stream.pipe(res);
            stream.on('error', (streamErr) => { console.error(`Stream error for ${filePath}:`, streamErr); res.end(); });
        });
    }
    router.get(/^\/stream(.*)$/, serveStream);
    router.head(/^\/stream(.*)$/, serveStream);

    // Custom FFmpeg Live Transcoding Stream (unchanged behaviour)
    router.get(/^\/stream-custom(.*)$/, async (req, res) => {
        try {
            const filePath = req.fullPath;
            const stats = await fs.promises.stat(filePath);
            if (!stats.isFile()) return res.status(400).json({ error: 'Target must be a file' });
            const audioIndex = req.query.audio;
            const resHeight = req.query.res;
            const startTime = req.query.time;
            let command = ffmpeg(filePath);
            if (startTime && !isNaN(startTime)) command.seekInput(startTime);
            command.outputOptions(['-map 0:v:0']);
            if (audioIndex !== undefined && audioIndex !== null) command.outputOptions([`-map 0:a:${audioIndex}`]);
            else command.outputOptions(['-map 0:a:0']);
            if (resHeight) {
                command.videoCodec('libx264').outputOptions([`-vf scale=-2:${resHeight}`, '-preset ultrafast', '-tune zerolatency']);
            } else {
                command.videoCodec('copy');
            }
            command.audioCodec('aac').audioBitrate('192k').outputOptions(['-ac 2']);
            command.format('mp4').outputOptions(['-movflags frag_keyframe+empty_moov+default_base_moof']);
            res.contentType('video/mp4');
            command.on('error', (err) => {
                if (err.message && err.message.includes('Output stream closed')) return;
                console.error('FFmpeg streaming error:', err.message);
                if (!res.headersSent) res.status(500).end();
            });
            command.pipe(res, { end: true });
            req.on('close', () => { command.kill('SIGKILL'); });
        } catch (error) {
            console.error('Custom stream setup error:', error);
            res.status(500).json({ error: 'Failed to start Live Custom Stream' });
        }
    });

    router.get(/^\/download(.*)$/, (req, res) => {
        const filePath = req.fullPath;
        fs.stat(filePath, (err, stats) => {
            if (err) return res.status(404).send('File not found');
            if (stats.isDirectory()) {
                const archive = archiver('zip', { zlib: { level: 1 } });
                archive.on('error', function (err) { res.status(500).send({ error: err.message }); });
                const dirName = path.basename(filePath) || 'archive';
                res.attachment(`${dirName}.zip`);
                archive.pipe(res);
                archive.directory(filePath, false);
                archive.finalize();
            } else {
                addDownloaded(stats.size);
                const name = path.basename(filePath);
                res.set('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
                res.download(filePath, name);
            }
        });
    });

    router.post('/download-zip', async (req, res) => {
        const rootDir = getRootDir();
        try {
            const paths = (req.body && req.body.paths) || [];
            if (!Array.isArray(paths) || paths.length === 0) return res.status(400).json({ error: 'paths[] required' });
            const archive = archiver('zip', { zlib: { level: 1 } });
            archive.on('error', (err) => { if (!res.headersSent) res.status(500).json({ error: err.message }); });
            res.attachment('selection.zip');
            archive.pipe(res);
            for (const rel of paths) {
                const full = resolveSafePath(rootDir, rel);
                const s = await fs.promises.stat(full);
                const name = path.basename(full);
                if (s.isDirectory()) archive.directory(full, name);
                else archive.file(full, { name });
            }
            await archive.finalize();
        } catch (e) {
            if (!res.headersSent) res.status(400).json({ error: e.message || 'Failed to create zip' });
        }
    });

    const storage = multer.diskStorage({
        destination: function (req, file, cb) {
            fs.stat(req.fullPath, (err, stats) => {
                if (err || !stats.isDirectory()) {
                    console.error('Multer Destination Error - Path:', req.fullPath, 'Err:', err);
                    return cb(new Error(`Upload destination is not a valid directory: ${req.fullPath}`), null);
                }
                cb(null, req.fullPath);
            });
        },
        filename: function (req, file, cb) {
            const dest = uniquePath(path.join(req.fullPath, file.originalname));
            cb(null, path.basename(dest));
        }
    });
    const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 * 1024 } });

    router.post(/^\/upload(.*)$/, (req, res) => {
        upload.array('files')(req, res, function (err) {
            if (err instanceof multer.MulterError) {
                console.error('Multer Error:', err);
                return res.status(500).json({ error: 'Multer upload error: ' + err.message });
            } else if (err) {
                console.error('Unknown Upload Error:', err);
                return res.status(500).json({ error: 'Unknown upload error: ' + err.message });
            }
            try {
                if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
                const uploaded = req.files.map(f => { addUploaded(f.size); return f.filename; });
                res.json({ success: true, message: `Successfully uploaded ${req.files.length} files.`, files: uploaded });
            } catch (error) {
                console.error('Post-Upload Processing Error:', error);
                res.status(500).json({ error: 'Failed to process upload' });
            }
        });
    });

    return router;
}

module.exports = createApiRouter;
module.exports.VERSION = VERSION;
