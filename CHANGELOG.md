# Changelog

## 2.0.0 — 2026-11-18

Premium v2.0 upgrade.

### Added
- File manager: New Folder, Rename, and Delete-to-Trash (with Trash list, Restore, and Empty Trash — nothing is permanently deleted until the trash is emptied).
- Multi-select with checkboxes and a selection toolbar: Bulk Download (fast Zip of the selection) and Bulk Delete to trash.
- Thumbnails for images and videos (`/api/thumb`, cached in `.speed-cache/thumbs/`).
- Subtitles: sibling `.srt`/`.vtt` files are listed (`/api/subtitles`) and served as WebVTT (`/api/subtitle-file`, `.srt` converted on the fly), wired into Plyr as caption tracks.
- Resume playback: Plyr position is saved every 5s to localStorage and restored on reopen (if >10s and <95% of duration).
- Text/code preview in the media modal for txt/md/json/js/css/html/py and more.
- Drag & drop upload overlay.
- QR code button in the header (`/api/qr`) showing the LAN URL as a scannable PNG.
- Live stats strip polling `/api/stats` every 5s: connections, uptime, downloaded/uploaded MB, disk-free bar.
- Health endpoint `GET /api/health` (`{ok, version, uptime}`) and extended stats (uptimeSeconds, bytesDownloaded, bytesUploaded, disk free/total, connections).
- Bulk zip endpoint `POST /api/download-zip`.
- Uploads never silently overwrite: colliding files are auto-renamed to `name (1).ext`, `(2)`, … and the returned filenames are reported.

### Changed
- Search is deeper and bigger: depth 6 (was 4), max 200 results (was 100).
- Zip downloads are much faster: archiver compression level 1 (was 9), for both folder downloads and bulk zips.
- Streaming is standards-compliant: suffix ranges (`bytes=-500`), invalid ranges return 416 with `Content-Range: bytes */total`, HEAD requests, ETag + Last-Modified (304 support), Cache-Control, Accept-Ranges, and 1 MB stream chunks.
- Config: the server now respects `config.json` port, then `PORT` env, default 3001 (config port fixed to 3001).
- Security headers on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`.

### Fixed
- Directory-traversal check: a path must now equal the root or start with root + separator (previously a sibling like `root-evil` passed the prefix check) — fixed in both `server/routes/api.js` and `server/utils/fileHandler.js`.
- Internal directories `.speed-trash` and `.speed-cache` are hidden from listings and search.

### Tests
- `npm test` runs `test/path-safety.test.js` (node:test): safe-path, sibling-prefix attack, traversal, filename validation, and auto-rename cases.
- Note: the test script is `node --test "test/*.test.js"` — `node --test test/` fails on Node 24.22 (it treats the directory as a module path).

## 1.0.0
- Initial release: browse, search, download/zip, 10 GB uploads, range streaming, FFmpeg dual-audio transcoding, Plyr player.
