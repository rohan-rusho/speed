# Changelog

## 2.1.0 — 2026-11-18

Modern UI redesign. No API or behaviour changes — all v2.0 features work as before.

### Added
- Working light/dark theme toggle in the header (sun/moon button, `localStorage`, applied before first paint so there is no flash). Light theme is a first-class blue-white theme (pale-blue surfaces, blue accents, dark slate text); dark theme is deep navy-black with blue/cyan glass.
- `Ctrl`/`⌘K` focuses search, `Esc` clears it.
- Folder header row: current folder name, item count, total size, and a live "LAN Active · N online" status pill.
- Upload ETA ("~2m 10s left") in the upload progress card.
- `npm run build:css` script (`tailwindcss -i ./src/input.css -o ./server/public/css/style.css`); `@tailwindcss/cli` added as a dev dependency so the CSS can actually be rebuilt (tailwindcss v4 ships no binary).

### Changed
- **Glassmorphism throughout**: frosted-glass header, cards, toolbar, stats strip, modals, toasts, selection bar and setup card — translucent gradient surfaces, `backdrop-blur`, 1px light borders, soft inner highlights, layered depth. Page backgrounds are lit by soft blue/violet (light) and blue/cyan (dark) glows so the glass has something to refract.
- **Thumbnails are the hero**: grid cards are dominated by a large 4:3 preview area on top (real `/api/thumb` image/video preview, `object-cover`, size badge, hover play overlay); filename and meta live in a slim strip below. Folders/docs keep a large tinted tile with a big icon.
- Header is a single slim sticky glass bar: logo, centred pill search, QR / Trash / theme / settings. The big hero and separate search section are gone.
- Filter chips are a segmented pill control; sort + view toggle are a compact segmented control; Upload is a solid accent pill, New Folder a ghost pill; breadcrumbs are pill crumbs.
- Selection toolbar is a floating glass pill at the bottom centre.
- Loading uses skeleton shimmer cards; empty state has a proper illustration-style icon, message and Upload/Clear-search action; error state has a Retry button.
- Toasts are glass panels that slide in from the right; media modal has a cleaner gradient header and keyboard hints (← → / Esc / Space).
- Cards have a staggered fade-up entrance, hover lift (-2px) and soft shadow, cyan ring + tint when selected; list rows are 44px glass rows with hairline dividers.
- Motion respects `prefers-reduced-motion` (entrance/shimmer/hover animations disabled); focus-visible rings added for keyboard users.
- Tailwind tokens refined: near-black `#0B0D17`, larger radii (20–24px cards), Inter system stack, tighter heading tracking, softer violet `#8B5CF6`.

### Fixed
- Theme toggle button referenced by `app.js` did not exist in `index.html` — it does now, and `dark:` variants are class-based (`@custom-variant`), so toggling works in both themes.
- `online-count` element referenced by the stats poller did not exist in `index.html` — it is now in the status pill.
- View-toggle buttons no longer get hardcoded `text-white`/`text-gray-500` classes from JS — the active look is owned by `.view-toggle.active` in CSS, so it works in the light theme too.

## 2.0.2 — 2026-11-18

### Fixed
- Server window closed instantly on startup errors with no readable message. Added a friendly `EADDRINUSE` handler in `server/index.js` (port already in use — usually an old Speed server still running) and `uncaughtException` / `unhandledRejection` handlers that print the error instead of a bare stack trace, plus a clear "Server stopped" message in `Start-Server.bat` so the window stays open on the error.

## 2.0.1 — 2026-11-18

### Fixed
- Server crashed on startup with `Cannot find module 'qrcode'` on existing installs, because `Start-Server.bat` only ran `npm install` when `node_modules` did not exist at all, so the new v2.0 dependency was never installed. The bat file now also runs `npm install` when `node_modules\qrcode` is missing.
- `qrcode` is now optional in `server/routes/api.js`: if it is missing, the server still starts and `/api/qr` returns 503 with a helpful message (and the QR button shows a toast) instead of crashing the whole server.

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
