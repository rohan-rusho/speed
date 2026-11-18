// In-memory transfer counters + server start time (v2.0 stats).
const startedAt = Date.now();
const counters = { bytesDownloaded: 0, bytesUploaded: 0 };
function addDownloaded(n) { if (Number.isFinite(n) && n > 0) counters.bytesDownloaded += n; }
function addUploaded(n) { if (Number.isFinite(n) && n > 0) counters.bytesUploaded += n; }
function uptimeSeconds() { return Math.floor((Date.now() - startedAt) / 1000); }
module.exports = { counters, addDownloaded, addUploaded, uptimeSeconds, startedAt };
