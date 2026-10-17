const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

function readSource(file) {
    if (path.isAbsolute(file) || file.split(/[\\/]/).some(part => part === '..'))
        throw new Error('INVALID_SOURCE_PATH');
    let current = process.cwd();
    for (const part of file.split('/')) {
        current = path.join(current, part);
        if (fs.lstatSync(current).isSymbolicLink())
            throw new Error('TRACKED_SOURCE_SYMLINK_UNSUPPORTED:' + file);
    }
    const relative = path.relative(fs.realpathSync(process.cwd()), fs.realpathSync(current));
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('SOURCE_OUTSIDE_REPOSITORY');
    if (!fs.lstatSync(current).isFile()) throw new Error('SOURCE_NOT_REGULAR');
    return fs.readFileSync(current, 'utf8');
}

function repositoryFiles(includeUntracked = false) {
    const prefix = cp.execFileSync('git', ['rev-parse', '--show-prefix'], {encoding: 'utf8'}).trim();
    if (prefix) throw new Error('RUN_FROM_REPOSITORY_ROOT');
    const args = ['ls-files', '-z'];
    if (includeUntracked) args.push('--cached', '--others', '--exclude-standard');
    return [...new Set(cp.execFileSync('git', args, {encoding: 'utf8'}).split('\0').filter(Boolean))].sort();
}

function classify(file) {
    if (/(?:^|\/)(?:tests?|fixtures|__tests__|migrations)\//.test(file) || /\.(test|spec|fixture)\./.test(file)) return 'fixture';
    if (/(?:^|[\/_-])seed(?:[\/_-]|\.)/.test(file)) return 'seed';
    if (/^(?:docs|\.tdpd|skill-updates|skills)\//.test(file) || file.startsWith('ops/sql/')) return 'historical';
    if (/package-lock\.json$/.test(file)) return 'lock';
    return 'operational';
}

module.exports = {readSource, repositoryFiles, classify};
