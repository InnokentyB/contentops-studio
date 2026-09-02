#!/usr/bin/env node
/**
 * mcp-connect — прописывает MCP-серверы во все установленные на машине клиенты сразу.
 *
 * Запускается на машине участника. Без зависимостей, без сборки, без npm install:
 *   node mcp-connect.mjs --url https://host/mcp/strategist --token mcp_xxx
 *
 * Режимы:
 *   --list                какие клиенты найдены на этой машине
 *   --print               ничего не писать, показать готовые конфиги
 *   --dry-run             показать, что изменится, без записи
 *   --only cursor,opencode   только эти клиенты
 *   --name contentops     имя сервера в конфигах (по умолчанию contentops)
 *   --manifest ./servers.json   несколько серверов разом:
 *                         [{ "name": "contentops", "url": "...", "token": "..." }]
 *
 * Существующие MCP-серверы в конфигах не трогаются: запись идёт слиянием по одному ключу,
 * и перед каждой записью рядом кладётся резервная копия.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const HOME = homedir();
const OS = platform();
const APPDATA = process.env.APPDATA || join(HOME, 'AppData', 'Roaming');

const pick = (mac, win, linux) => (OS === 'darwin' ? mac : OS === 'win32' ? win : linux);

/* ---------- клиенты ---------- */

const CLIENTS = [
    {
        id: 'cursor',
        title: 'Cursor',
        file: join(HOME, '.cursor', 'mcp.json'),
        detect: () => existsSync(join(HOME, '.cursor')),
        entry: s => ({ url: s.url, headers: { Authorization: `Bearer ${s.token}` } }),
        root: 'mcpServers'
    },
    {
        id: 'opencode',
        title: 'opencode',
        file: join(HOME, '.config', 'opencode', 'opencode.json'),
        detect: () => existsSync(join(HOME, '.config', 'opencode')),
        // timeout по умолчанию у opencode 5000 мс. tools/list этого сервера великоват,
        // и на холодном старте в пять секунд не укладывается — отсюда обрывы загрузки.
        entry: s => ({ type: 'remote', url: s.url, enabled: true, timeout: 30000, headers: { Authorization: `Bearer ${s.token}` } }),
        root: 'mcp',
        seed: { $schema: 'https://opencode.ai/config.json' },
        note: 'timeout поднят до 30 с — у opencode по умолчанию 5 с'
    },
    {
        id: 'cline',
        title: 'Cline (VS Code)',
        file: pick(
            join(HOME, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
            join(APPDATA, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
            join(HOME, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json')
        ),
        detect(){ return existsSync(dirname(this.file)); },
        entry: s => ({ type: 'streamableHttp', url: s.url, headers: { Authorization: `Bearer ${s.token}` } }),
        root: 'mcpServers'
    },
    {
        id: 'claude-desktop',
        title: 'Claude (приложение)',
        file: pick(
            join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
            join(APPDATA, 'Claude', 'claude_desktop_config.json'),
            join(HOME, '.config', 'Claude', 'claude_desktop_config.json')
        ),
        detect(){ return existsSync(dirname(this.file)); },
        // Файл приложения понимает только stdio, поэтому удалённый сервер идёт через мост.
        entry: s => ({
            command: 'npx',
            args: ['-y', 'mcp-remote', s.url, '--header', `Authorization: Bearer ${s.token}`]
        }),
        root: 'mcpServers',
        note: 'через мост mcp-remote; напрямую удалённый сервер добавляется в Settings → Connectors'
    }
];

/* ---------- клиенты со своей командой ---------- */

const CLI_CLIENTS = [
    {
        id: 'claude-code',
        title: 'Claude Code',
        detect: () => which('claude'),
        command: s => ['claude', ['mcp', 'add', '--transport', 'http', s.name, s.url,
            '--header', `Authorization: Bearer ${s.token}`]]
    }
];

/* ---------- клиенты, которым только печатаем ---------- */

const PRINT_ONLY = [
    {
        id: 'codex',
        title: 'Codex',
        file: join(HOME, '.codex', 'config.toml'),
        detect: () => existsSync(join(HOME, '.codex')),
        render: s => `[mcp_servers.${s.name}]
command = "npx"
args = ["-y", "mcp-remote", "${s.url}", "--header", "Authorization: Bearer ${s.token}"]`,
        note: 'TOML не трогаем автоматически — впишите блок сами'
    }
];

/* ---------- утилиты ---------- */

function which(bin) {
    try {
        execFileSync(OS === 'win32' ? 'where' : 'which', [bin], { stdio: 'pipe' });
        return true;
    } catch { return false; }
}

function readJson(file) {
    if (!existsSync(file)) return { data: {}, existed: false };
    const raw = readFileSync(file, 'utf8').trim();
    if (!raw) return { data: {}, existed: true };
    try { return { data: JSON.parse(raw), existed: true }; }
    catch (e) { return { data: null, existed: true, error: e.message }; }
}

function backup(file) {
    const dest = `${file}.mcp-connect-backup-${Date.now()}`;
    copyFileSync(file, dest);
    return dest;
}

function parseArgs(argv) {
    const out = { only: null, servers: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--list') out.list = true;
        else if (a === '--print') out.print = true;
        else if (a === '--dry-run') out.dryRun = true;
        else if (a === '--url') out.url = argv[++i];
        else if (a === '--token') out.token = argv[++i];
        else if (a === '--name') out.name = argv[++i];
        else if (a === '--manifest') out.manifest = argv[++i];
        else if (a === '--only') out.only = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
        else if (a === '--help' || a === '-h') out.help = true;
    }
    return out;
}

const C = {
    dim: s => `\x1b[2m${s}\x1b[0m`,
    b: s => `\x1b[1m${s}\x1b[0m`,
    ok: s => `\x1b[32m${s}\x1b[0m`,
    warn: s => `\x1b[33m${s}\x1b[0m`,
    err: s => `\x1b[31m${s}\x1b[0m`
};

/* ---------- основное ---------- */

const args = parseArgs(process.argv.slice(2));

if (args.help) {
    console.log(readFileSync(new URL(import.meta.url)).toString().split('*/')[0].replace('#!/usr/bin/env node', '').replace('/**', ''));
    process.exit(0);
}

const fileClients = CLIENTS.filter(c => !args.only || args.only.includes(c.id));
const cliClients = CLI_CLIENTS.filter(c => !args.only || args.only.includes(c.id));
const printClients = PRINT_ONLY.filter(c => !args.only || args.only.includes(c.id));
const all = [...fileClients, ...cliClients, ...printClients];

if (args.list) {
    console.log(`\n${C.b('Клиенты на этой машине')}\n`);
    for (const c of all) {
        const found = c.detect();
        console.log(`  ${found ? C.ok('есть   ') : C.dim('нет    ')} ${c.title.padEnd(22)} ${C.dim(c.file || 'команда claude')}`);
    }
    console.log();
    process.exit(0);
}

let servers = [];
if (args.manifest) {
    servers = JSON.parse(readFileSync(args.manifest, 'utf8'));
} else if (args.url && args.token) {
    servers = [{ name: args.name || 'contentops', url: args.url, token: args.token }];
} else {
    console.error(C.err('\nНужно --url и --token, либо --manifest. Список клиентов: --list\n'));
    process.exit(1);
}

for (const s of servers) {
    if (!s.name || !s.url || !s.token) {
        console.error(C.err(`Пропущено: у сервера нет name, url или token — ${JSON.stringify(s)}`));
        process.exit(1);
    }
}

const mode = args.print ? 'print' : args.dryRun ? 'dry-run' : 'write';
console.log(`\n${C.b('mcp-connect')} ${C.dim(`режим: ${mode}`)}\n`);

let touched = 0;

for (const client of fileClients) {
    if (!client.detect()) { console.log(`${C.dim('пропуск')} ${client.title} ${C.dim('— не найден')}`); continue; }

    const { data, existed, error } = readJson(client.file);
    if (error) {
        console.log(`${C.err('ошибка ')} ${client.title} — конфиг не разбирается как JSON: ${error}`);
        console.log(`${C.dim('        файл не тронут, впишите вручную:')}`);
        for (const s of servers) console.log(C.dim(`        "${s.name}": ${JSON.stringify(client.entry({ ...s }))}`));
        continue;
    }

    const next = { ...(client.seed || {}), ...data };
    next[client.root] = { ...(data[client.root] || {}) };
    const added = [];
    for (const s of servers) {
        const replacing = Boolean(next[client.root][s.name]);
        next[client.root][s.name] = client.entry(s);
        added.push(`${s.name}${replacing ? ' (заменён)' : ''}`);
    }

    const kept = Object.keys(data[client.root] || {}).filter(k => !servers.some(s => s.name === k));

    if (mode === 'print') {
        console.log(`\n${C.b(client.title)} ${C.dim(client.file)}`);
        if (client.note) console.log(C.warn(`  ${client.note}`));
        console.log(JSON.stringify(next, null, 2));
        continue;
    }

    console.log(`${mode === 'dry-run' ? C.warn('изменит') : C.ok('записан')} ${client.title.padEnd(22)} ${C.dim(client.file)}`);
    console.log(`         ${C.dim(`+ ${added.join(', ')}${kept.length ? `; сохранено без изменений: ${kept.join(', ')}` : ''}`)}`);
    if (client.note) console.log(`         ${C.warn(client.note)}`);

    if (mode === 'write') {
        if (existed) console.log(`         ${C.dim('копия: ' + backup(client.file))}`);
        mkdirSync(dirname(client.file), { recursive: true });
        writeFileSync(client.file, JSON.stringify(next, null, 2) + '\n');
        touched++;
    }
}

for (const client of cliClients) {
    if (!client.detect()) { console.log(`${C.dim('пропуск')} ${client.title} ${C.dim('— команда не найдена')}`); continue; }
    for (const s of servers) {
        const [bin, argv] = client.command(s);
        if (mode !== 'write') {
            console.log(`${C.warn('команда')} ${client.title.padEnd(22)} ${C.dim(bin + ' ' + argv.join(' '))}`);
            continue;
        }
        try {
            execFileSync(bin, argv, { stdio: 'pipe' });
            console.log(`${C.ok('записан')} ${client.title.padEnd(22)} ${C.dim('через ' + bin + ' mcp add')}`);
            touched++;
        } catch (e) {
            const msg = (e.stderr || e.stdout || Buffer.from('')).toString().trim() || e.message;
            console.log(`${C.err('ошибка ')} ${client.title} — ${msg.split('\n')[0]}`);
        }
    }
}

for (const client of printClients) {
    if (!client.detect()) { console.log(`${C.dim('пропуск')} ${client.title} ${C.dim('— не найден')}`); continue; }
    console.log(`\n${C.b(client.title)} ${C.dim(client.file)}`);
    if (client.note) console.log(C.warn(`  ${client.note}`));
    for (const s of servers) console.log(client.render(s));
}

console.log();
if (mode === 'write' && touched) console.log(C.ok(`Готово: ${touched}. Перезапустите клиентов, чтобы они перечитали конфиг.\n`));
if (mode === 'dry-run') console.log(C.dim('Это был dry-run. Уберите --dry-run, чтобы записать.\n'));
