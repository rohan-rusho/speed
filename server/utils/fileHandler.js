const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

// Internal directories that must never appear in listings or search results.
const INTERNAL_DIRS = ['.speed-trash', '.speed-cache'];

function isInternalName(name) {
    return INTERNAL_DIRS.includes(name);
}

/**
 * Ensures that a requested path is within the allowed root directory to prevent directory traversal attacks.
 * A path is safe only if it equals rootDir or starts with rootDir + path.sep.
 * (A plain startsWith(rootDir) check is wrong: /data/root-evil starts with /data/root.)
 */
function resolveSafePath(rootDir, requestedPath) {
    const normalizedRoot = path.normalize(rootDir);
    let safePath = path.normalize(path.join(normalizedRoot, requestedPath || ''));
    // Canonicalise: strip trailing separators so root + '/' compares equal to root
    // (path.normalize preserves a trailing slash, which broke root-equality checks).
    while (safePath.length > 1 && safePath.endsWith(path.sep)) safePath = safePath.slice(0, -1);
    if (safePath !== normalizedRoot && !safePath.startsWith(normalizedRoot + path.sep)) {
        throw new Error('Access denied: Invalid path');
    }
    return safePath;
}

function isPathInsideRoot(rootDir, candidatePath) {
    try {
        resolveSafePath(rootDir, path.relative(rootDir, candidatePath));
        return true;
    } catch {
        return false;
    }
}

// Validate a single file/folder name (no separators or Windows-illegal chars).
function validateFileName(name) {
    if (typeof name !== 'string') return false;
    const trimmed = name.trim();
    if (!trimmed || trimmed === '.' || trimmed === '..') return false;
    if (/[/\\:*?"<>|]/.test(trimmed)) return false;
    // Control characters are never valid in a name.
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(trimmed)) return false;
    return true;
}

// Return a non-colliding sibling path: "name (1).ext", "name (2).ext", ...
function uniquePath(targetPath) {
    if (!fs.existsSync(targetPath)) return targetPath;
    const dir = path.dirname(targetPath);
    const ext = path.extname(targetPath);
    const base = path.basename(targetPath, ext);
    let i = 1;
    let candidate;
    do {
        candidate = path.join(dir, `${base} (${i})${ext}`);
        i++;
    } while (fs.existsSync(candidate));
    return candidate;
}

/**
 * Gets the contents of a directory, including file stats (size, modified date, type).
 */
async function getDirectoryContents(dirPath) {
    const entries = await readdir(dirPath, { withFileTypes: true });

    const contents = await Promise.all(entries.map(async (entry) => {
        if (isInternalName(entry.name)) return null;
        const fullPath = path.join(dirPath, entry.name);
        try {
            const stats = await stat(fullPath);
            return {
                name: entry.name,
                isDirectory: entry.isDirectory(),
                size: stats.size,
                mtime: stats.mtime
            };
        } catch (error) {
            console.error(`Error getting stats for ${fullPath}:`, error);
            return null;
        }
    }));

    return contents.filter(item => item !== null).sort((a, b) => {
        if (a.isDirectory === b.isDirectory) {
            return a.name.localeCompare(b.name);
        }
        return a.isDirectory ? -1 : 1;
    });
}

async function searchDirectoryRecursive(baseSearchDir, currentDir, query, currentDepth = 0, maxDepth = 6, maxResults = 200, results = []) {
    if (currentDepth > maxDepth || results.length >= maxResults) {
        return results;
    }

    try {
        const entries = await readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
            if (results.length >= maxResults) break;
            if (isInternalName(entry.name)) continue;

            const fullPath = path.join(currentDir, entry.name);
            const matchesQuery = entry.name.toLowerCase().includes(query.toLowerCase());

            if (matchesQuery) {
                try {
                    const stats = await stat(fullPath);
                    const relativePath = path.relative(baseSearchDir, fullPath).replace(/\\/g, '/');
                    results.push({
                        name: relativePath,
                        isDirectory: entry.isDirectory(),
                        size: stats.size,
                        mtime: stats.mtime
                    });
                } catch (err) {
                    console.error(`Stat error on search match ${fullPath}:`, err);
                }
            }

            if (entry.isDirectory()) {
                await searchDirectoryRecursive(baseSearchDir, fullPath, query, currentDepth + 1, maxDepth, maxResults, results);
            }
        }
    } catch (error) {
        console.error(`Search error traversing ${currentDir}:`, error);
    }

    if (currentDepth === 0) {
        return results.sort((a, b) => {
            if (a.isDirectory === b.isDirectory) {
                return a.name.localeCompare(b.name);
            }
            return a.isDirectory ? -1 : 1;
        });
    }

    return results;
}

module.exports = {
    resolveSafePath,
    isPathInsideRoot,
    isInternalName,
    INTERNAL_DIRS,
    validateFileName,
    uniquePath,
    getDirectoryContents,
    searchDirectoryRecursive
};
