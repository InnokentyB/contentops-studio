/**
 * Provision a pilot participant: user + own project + owner membership + strategist MCP token.
 *
 * The same result is reachable self-serve (register in the UI, then Settings -> MCP), so this
 * script exists for pre-baking a group before a session and for people who get stuck.
 *
 * Single:
 *   npx ts-node scripts/provision_pilot_user.ts --email a@b.com --name "Анна" --project "Мой продукт"
 * Batch (CSV with header: email,name,project):
 *   npx ts-node scripts/provision_pilot_user.ts --csv ./pilot.csv --days 45
 *
 * Options: --days <n> token lifetime, default 30. --profile <p> default strategist.
 *          --base-url <url> planner UI URL shown on the card.
 *          --mcp-url <url> remote MCP base, default $MCP_REMOTE_URL.
 */
import '../src/bootstrap-env';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import bcrypt from 'bcrypt';
import prisma from '../src/db';
import mcpAccessTokenService, { isManagedMcpProfile } from '../src/services/mcp_access_token.service';
import type { McpCapabilityProfile } from '../src/mcp/capabilities';

type Participant = { email: string; name: string; project?: string };

function parseArgs(argv: string[]) {
    const out: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const next = argv[i + 1];
        out[key] = !next || next.startsWith('--') ? 'true' : (i++, next);
    }
    return out;
}

function slugify(value: string) {
    const base = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `${base || 'project'}-${randomBytes(3).toString('hex')}`;
}

function readCsv(path: string): Participant[] {
    const lines = readFileSync(path, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return [];
    const header = lines[0].toLowerCase().split(',').map(h => h.trim());
    const idx = (name: string) => header.indexOf(name);
    const [iEmail, iName, iProject] = [idx('email'), idx('name'), idx('project')];
    if (iEmail < 0) throw new Error('CSV must have an "email" column');
    return lines.slice(1).map(line => {
        const cells = line.split(',').map(c => c.trim());
        return {
            email: cells[iEmail],
            name: (iName >= 0 && cells[iName]) || cells[iEmail].split('@')[0],
            project: iProject >= 0 ? cells[iProject] : undefined
        };
    }).filter(p => p.email);
}

async function provision(p: Participant, profile: McpCapabilityProfile, days: number) {
    const password = randomBytes(9).toString('base64url');
    const user = await prisma.user.upsert({
        where: { email: p.email },
        update: {},
        create: { email: p.email, name: p.name, password_hash: await bcrypt.hash(password, 10) }
    });
    const isNewUser = user.created_at.getTime() > Date.now() - 5000;

    let membership = await prisma.projectMember.findFirst({
        where: { user_id: user.id, role: 'owner' },
        include: { project: true }
    });

    if (!membership) {
        const projectName = p.project || `${p.name}: продвижение`;
        const project = await prisma.project.create({
            data: {
                name: projectName,
                slug: slugify(projectName),
                members: { create: { user_id: user.id, role: 'owner' } }
            }
        });
        membership = await prisma.projectMember.findFirstOrThrow({
            where: { user_id: user.id, project_id: project.id },
            include: { project: true }
        });
    }

    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const { token } = await mcpAccessTokenService.create(
        membership.project_id, user.id, profile, `pilot ${profile}`, expiresAt
    );

    return {
        email: p.email,
        name: p.name,
        password: isNewUser ? password : null,
        projectId: membership.project_id,
        projectName: membership.project.name,
        token,
        expiresAt
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const profile = (args.profile || 'strategist') as McpCapabilityProfile;
    if (!isManagedMcpProfile(profile)) throw new Error(`Unsupported profile: ${profile}`);

    const days = Number(args.days || 30);
    if (!Number.isFinite(days) || days <= 0) throw new Error('--days must be a positive number');

    const mcpBase = (args['mcp-url'] || process.env.MCP_REMOTE_URL || 'https://REPLACE-ME/mcp').replace(/\/+$/, '');
    const endpoint = `${mcpBase}/${profile.replace(/_/g, '-')}`;
    const baseUrl = args['base-url'] || process.env.APP_PUBLIC_URL || 'https://REPLACE-ME';

    const participants: Participant[] = args.csv
        ? readCsv(args.csv)
        : [{ email: args.email, name: args.name || (args.email || '').split('@')[0], project: args.project }];

    if (!participants.length || !participants[0].email) {
        throw new Error('Pass --email (and optionally --name, --project) or --csv <path>');
    }

    for (const participant of participants) {
        try {
            const r = await provision(participant, profile, days);
            console.log('\n' + '='.repeat(68));
            console.log(`  ${r.name}  <${r.email}>`);
            console.log('='.repeat(68));
            console.log(`  Проект:        ${r.projectName} (id ${r.projectId})`);
            console.log(`  Планнер:       ${baseUrl}`);
            if (r.password) console.log(`  Пароль:        ${r.password}   (сменить после входа)`);
            else console.log('  Пароль:        без изменений, пользователь уже существовал');
            console.log(`  MCP endpoint:  ${endpoint}`);
            console.log(`  Профиль:       ${profile}`);
            console.log(`  Токен:         ${r.token}`);
            console.log(`  Действует до:  ${r.expiresAt.toISOString().slice(0, 10)}`);
            console.log('\n  Проверка:');
            console.log(`    curl -s -X POST ${endpoint} \\`);
            console.log(`      -H "Authorization: Bearer ${r.token}" \\`);
            console.log('      -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \\');
            console.log(`      -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`);
        } catch (error: any) {
            console.error(`\n[FAILED] ${participant.email}: ${error?.message || error}`);
        }
    }

    console.log('\nТокены показываются один раз. Раздайте их лично, не через общий чат.\n');
}

main()
    .catch(error => { console.error(error); process.exitCode = 1; })
    .finally(async () => { await prisma.$disconnect(); });
