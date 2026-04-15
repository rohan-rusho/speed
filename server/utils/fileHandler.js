const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

/**
 * Ensures that a requested path is within the allowed root directory to prevent directory traversal attacks.
 */
function resolveSafePath(rootDir, requestedPath) {
    const safePath = path.normalize(path.join(rootDir, requestedPath));
    if (!safePath.startsWith(path.normalize(rootDir))) {
        throw new Error('Access denied: Invalid path');
    }
    return safePath;
}

/**
 * Gets the contents of a directory, including file stats (size, modified date, type).
 */
async function getDirectoryContents(dirPath) {
    const entries = await readdir(dirPath, { withFileTypes: true });

    const contents = await Promise.all(entries.map(async (entry) => {
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
            // Ignore files that can't be stat'd (e.g., due to permissions)
            return null;
        }
    }));

    // Filter out nulls and sort: directories first, then alphabetical
    return contents.filter(item => item !== null).sort((a, b) => {
        if (a.isDirectory === b.isDirectory) {
            return a.name.localeCompare(b.name);
        }
        return a.isDirectory ? -1 : 1;
    });
}

async function searchDirectoryRecursive(baseSearchDir, currentDir, query, currentDepth = 0, maxDepth = 4, maxResults = 100, results = []) {
    if (currentDepth > maxDepth || results.length >= maxResults) {
        return results;
    }

    try {
        const entries = await readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
            if (results.length >= maxResults) break;

            const fullPath = path.join(currentDir, entry.name);
            const matchesQuery = entry.name.toLowerCase().includes(query.toLowerCase());

            if (matchesQuery) {
                try {
                    const stats = await stat(fullPath);
                    // Generate a relative path so the UI shows 'subfolder/file.ext' 
                    // and handles paths correctly for the download API
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

            // Recurse into subdirectories
            if (entry.isDirectory()) {
                await searchDirectoryRecursive(baseSearchDir, fullPath, query, currentDepth + 1, maxDepth, maxResults, results);
            }
        }
    } catch (error) {
        console.error(`Search error traversing ${currentDir}:`, error);
    }

    // Only sort on the final return of the top-level call to save CPU
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
    getDirectoryContents,
    searchDirectoryRecursive
};
