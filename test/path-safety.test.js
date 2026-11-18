const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveSafePath, validateFileName, uniquePath } = require('../server/utils/fileHandler');

const ROOT = path.normalize('/srv/root');

test('resolveSafePath: file directly under root is allowed', () => {
    assert.equal(resolveSafePath(ROOT, 'movie.mp4'), path.join(ROOT, 'movie.mp4'));
    assert.equal(resolveSafePath(ROOT, 'sub/dir/file.txt'), path.join(ROOT, 'sub/dir/file.txt'));
    assert.equal(resolveSafePath(ROOT, ''), ROOT);
    assert.equal(resolveSafePath(ROOT, '/'), ROOT);
});

test('resolveSafePath: plain traversal is rejected', () => {
    assert.throws(() => resolveSafePath(ROOT, '../etc/passwd'), /Access denied/);
    assert.throws(() => resolveSafePath(ROOT, '../../etc/passwd'), /Access denied/);
    assert.throws(() => resolveSafePath(ROOT, 'sub/../../etc/passwd'), /Access denied/);
});

test('resolveSafePath: sibling-prefix attack is rejected (root-evil != root)', () => {
    assert.throws(() => resolveSafePath(ROOT, '../root-evil/x'), /Access denied/);
    assert.throws(() => resolveSafePath(ROOT, '../root2/secret.txt'), /Access denied/);
});

test('resolveSafePath: an absolute-looking input is joined under root, never escapes it', () => {
    assert.equal(resolveSafePath(ROOT, '/etc/passwd'), path.join(ROOT, 'etc/passwd'));
});

test('validateFileName: rejects separators, illegal chars, empty and dot names', () => {
    for (const bad of ['', '   ', '.', '..', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', null, undefined, 42]) {
        assert.equal(validateFileName(bad), false, JSON.stringify(bad));
    }
    for (const good of ['New Folder', 'movie (1).mp4', 'my-file_v2.txt', 'a.b.c']) {
        assert.equal(validateFileName(good), true, good);
    }
});

test('uniquePath: returns the path itself when free, otherwise (1), (2), ...', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speed-test-'));
    try {
        const target = path.join(dir, 'file.txt');
        assert.equal(uniquePath(target), target);
        fs.writeFileSync(target, 'x');
        assert.equal(uniquePath(target), path.join(dir, 'file (1).txt'));
        fs.writeFileSync(path.join(dir, 'file (1).txt'), 'x');
        assert.equal(uniquePath(target), path.join(dir, 'file (2).txt'));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
