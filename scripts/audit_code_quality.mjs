#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

/**
 * 🛸 Enterprise Code Quality & Security Auditor
 * Zero-dependency automated scanner for TypeScript/JavaScript projects.
 * 
 * Usage:
 *   node audit-code-quality.mjs [targetDirectory] [--json] [--markdown] [--output=report.md] [--github-summary] [--comment-pr] [--fail-under=60]
 */

const args = process.argv.slice(2);
let targetDir = process.cwd();
let outputFile = null;
let failUnder = null;
let isJson = false;
let isMarkdown = false;
let isGithubSummary = false;
let isCommentPr = false;

for (const arg of args) {
  if (arg === '--json') isJson = true;
  else if (arg === '--markdown') isMarkdown = true;
  else if (arg === '--github-summary') isGithubSummary = true;
  else if (arg === '--comment-pr') isCommentPr = true;
  else if (arg.startsWith('--output=')) outputFile = arg.split('=')[1];
  else if (arg.startsWith('--fail-under=')) failUnder = parseInt(arg.split('=')[1], 10);
  else if (!arg.startsWith('--')) targetDir = path.resolve(arg);
}

function walkDir(dir, filter = () => true, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.git', 'coverage', '.cache', 'build'].includes(entry.name)) {
        walkDir(fullPath, filter, fileList);
      }
    } else if (entry.isFile() && filter(fullPath)) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

const report = {
  projectDir: targetDir,
  timestamp: new Date().toISOString(),
  metrics: {
    totalFiles: 0,
    totalLines: 0,
    godFilesCount: 0,
    asAnyCount: 0,
    colonAnyCount: 0,
    emptyCatchCount: 0,
    missingEnvVars: [],
    unprotectedSchedulers: 0,
    securityIssues: [],
    frontendIssues: []
  },
  details: {
    godFiles: [],
    anyHeavyFiles: [],
    emptyCatchFiles: [],
    strayRootScripts: []
  },
  score: 100,
  grade: 'A'
};

const srcDir = path.join(targetDir, 'src');
const tsFiles = walkDir(srcDir, (f) => /\.(ts|tsx|js|jsx)$/.test(f) && !f.includes('/tests/') && !f.includes('.test.') && !f.includes('.spec.'));
report.metrics.totalFiles = tsFiles.length;

const anyByFile = new Map();
let totalLines = 0;

for (const file of tsFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  totalLines += lines.length;
  const relPath = path.relative(targetDir, file);

  // 1. God-files (>1000 lines)
  if (lines.length > 1000) {
    report.metrics.godFilesCount++;
    report.details.godFiles.push({
      file: relPath,
      lines: lines.length,
      severity: lines.length > 2500 ? 'CRITICAL' : 'HIGH'
    });
  }

  // 2. Any usage
  const asAnyMatches = (content.match(/\bas\s+any\b/g) || []).length;
  const colonAnyMatches = (content.match(/:\s*any\b/g) || []).length;
  report.metrics.asAnyCount += asAnyMatches;
  report.metrics.colonAnyCount += colonAnyMatches;

  if (asAnyMatches + colonAnyMatches > 5) {
    anyByFile.set(relPath, { asAny: asAnyMatches, colonAny: colonAnyMatches, total: asAnyMatches + colonAnyMatches });
  }

  // 3. Silent error catch blocks
  const emptyCatchMatches = content.match(/catch\s*(\([a-zA-Z0-9_]*\))?\s*\{\s*\}/g);
  if (emptyCatchMatches) {
    report.metrics.emptyCatchCount += emptyCatchMatches.length;
    report.details.emptyCatchFiles.push({
      file: relPath,
      count: emptyCatchMatches.length
    });
  }
}

report.metrics.totalLines = totalLines;
report.details.anyHeavyFiles = Array.from(anyByFile.entries())
  .map(([file, counts]) => ({ file, ...counts }))
  .sort((a, b) => b.total - a.total)
  .slice(0, 10);

report.details.godFiles.sort((a, b) => b.lines - a.lines);

// 4. Stray scripts directly in src/ root
if (fs.existsSync(srcDir)) {
  const srcRootFiles = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of srcRootFiles) {
    if (entry.isFile() && /^(test-|check-|debug-|fix-|migrate-|set-|clear-|update-).*\.ts$/.test(entry.name)) {
      report.details.strayRootScripts.push(path.join('src', entry.name));
    }
  }
}

// 5. Database Pool Resilience Check
const dbFile = path.join(srcDir, 'db.ts');
if (fs.existsSync(dbFile)) {
  const dbContent = fs.readFileSync(dbFile, 'utf8');
  if (dbContent.includes('new Pool') && !dbContent.includes("pool.on('error'")) {
    report.metrics.securityIssues.push({
      id: 'DB_POOL_UNHANDLED_ERROR',
      title: 'PostgreSQL Pool lacks error event listener (pool.on("error"))',
      severity: 'HIGH',
      description: 'Dropped idle connections (e.g. Supabase pooler reset) will emit unhandled EventEmitter errors.'
    });
  }
}

// 6. Security Headers & CORS in Server
const serverFiles = [path.join(srcDir, 'server.ts'), path.join(srcDir, 'server.js'), path.join(srcDir, 'index.ts'), path.join(srcDir, 'app.ts')];
const activeServerFile = serverFiles.find(f => fs.existsSync(f));
if (activeServerFile) {
  const serverContent = fs.readFileSync(activeServerFile, 'utf8');
  
  if (!serverContent.includes('helmet') && !serverContent.includes('@fastify/helmet')) {
    report.metrics.securityIssues.push({
      id: 'MISSING_SECURITY_HEADERS',
      title: 'No Helmet security headers registered',
      severity: 'MEDIUM',
      description: 'App lacks X-Content-Type-Options, X-Frame-Options, HSTS, and Referrer-Policy protections.'
    });
  }

  if (serverContent.includes('origin: true')) {
    report.metrics.securityIssues.push({
      id: 'PERMISSIVE_CORS_ORIGIN',
      title: 'CORS configured with wildcard (origin: true)',
      severity: 'MEDIUM',
      description: 'Any external site can make cross-origin requests; should restrict origin in production.'
    });
  }

  // Check for setInterval without concurrency lock
  if (/setInterval\s*\(\s*async/g.test(serverContent) && !serverContent.includes('isSchedulerRunning') && !serverContent.includes('isRunning') && !serverContent.includes('isPublishing')) {
    report.metrics.unprotectedSchedulers++;
    report.metrics.securityIssues.push({
      id: 'UNPROTECTED_ASYNC_SCHEDULER',
      title: 'Async setInterval scheduler without overlap/concurrency guard',
      severity: 'HIGH',
      description: 'Long-running asynchronous jobs can overlap with subsequent ticks, causing race conditions.'
    });
  }

  // Check for database disconnect in graceful shutdown
  if (serverContent.includes('gracefulShutdown') && !serverContent.includes('$disconnect')) {
    report.metrics.securityIssues.push({
      id: 'MISSING_DB_SHUTDOWN',
      title: 'Database connection pool not closed during graceful shutdown',
      severity: 'LOW',
      description: 'SIGTERM/SIGINT does not disconnect Prisma or pg pool, leaving hanging connections.'
    });
  }
}

// 7. Auth Route Rate Limiting & Input Validation
const authRoutesFile = path.join(srcDir, 'routes', 'auth.routes.ts');
if (fs.existsSync(authRoutesFile)) {
  const authContent = fs.readFileSync(authRoutesFile, 'utf8');
  if (!authContent.includes('rateLimit') && !authContent.includes('RateLimit')) {
    report.metrics.securityIssues.push({
      id: 'AUTH_MISSING_RATE_LIMIT',
      title: 'Auth endpoints (/register, /login) lack brute-force rate-limiting',
      severity: 'HIGH',
      description: 'Endpoints are vulnerable to credential stuffing and registration spam.'
    });
  }
  if (authContent.includes('request.body as any') || !authContent.includes('Schema')) {
    report.metrics.securityIssues.push({
      id: 'AUTH_UNTYPED_PAYLOAD',
      title: 'Auth routes use untyped body payloads without Zod schema validation',
      severity: 'HIGH',
      description: 'Passwords of length 1 or invalid emails can be passed directly to the service layer.'
    });
  }
}

// 8. Environment Variables Check vs .env.example
const envExampleFile = path.join(targetDir, '.env.example');
if (fs.existsSync(envExampleFile)) {
  const envExampleContent = fs.readFileSync(envExampleFile, 'utf8');
  const usedEnvVars = new Set();
  
  for (const file of tsFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const matches = content.matchAll(/process\.env\.([A-Z0-9_]+)/g);
    for (const match of matches) {
      usedEnvVars.add(match[1]);
    }
  }

  const ignoredVars = new Set(['NODE_ENV', 'PORT', 'PWD', 'PATH', 'HOME', 'SHELL', 'LANG', 'CI', 'RAILWAY_ENVIRONMENT', 'RAILWAY_PUBLIC_DOMAIN', 'PGOPTIONS']);
  for (const v of usedEnvVars) {
    if (!ignoredVars.has(v) && !envExampleContent.includes(v)) {
      report.metrics.missingEnvVars.push(v);
    }
  }
}

// 9. Frontend Code-Splitting Check
const frontendApp = path.join(targetDir, 'frontend', 'src', 'App.tsx');
if (fs.existsSync(frontendApp)) {
  const appContent = fs.readFileSync(frontendApp, 'utf8');
  const staticImports = (appContent.match(/^import\s+[A-Z][a-zA-Z0-9]+\s+from\s+['"]\.\/pages\/.*['"]/gm) || []).length;
  const lazyImports = (appContent.match(/lazy\s*\(\s*\(\)\s*=>\s*import\(/g) || []).length;
  
  if (staticImports > 5 && lazyImports <= 2) {
    report.metrics.frontendIssues.push({
      id: 'FE_MONOLITHIC_PAGES_IMPORT',
      title: `${staticImports} pages statically imported in App.tsx without React.lazy()`,
      severity: 'MEDIUM',
      description: 'Entire frontend app is bundled into a single oversized JS chunk (>800kB). Code-splitting with lazy() is recommended.'
    });
  }
}

// Score computation
let penalty = 0;
penalty += report.details.godFiles.length * 5;
penalty += Math.min(25, Math.floor(report.metrics.asAnyCount / 20));
penalty += report.metrics.emptyCatchCount * 2;
penalty += report.metrics.securityIssues.filter(s => s.severity === 'CRITICAL').length * 15;
penalty += report.metrics.securityIssues.filter(s => s.severity === 'HIGH').length * 10;
penalty += report.metrics.securityIssues.filter(s => s.severity === 'MEDIUM').length * 5;
penalty += report.details.strayRootScripts.length * 2;
penalty += report.metrics.missingEnvVars.length * 1;

report.score = Math.max(10, 100 - penalty);
if (report.score >= 90) report.grade = 'A';
else if (report.score >= 75) report.grade = 'B';
else if (report.score >= 60) report.grade = 'C';
else if (report.score >= 45) report.grade = 'D';
else report.grade = 'F';

/**
 * Generate Markdown formatted audit report
 */
function generateMarkdown(rep) {
  const gradeEmoji = rep.grade === 'A' ? '🟢' : rep.grade === 'B' ? '🔵' : rep.grade === 'C' ? '🟡' : '🔴';
  
  let md = `## 🛸 Code Quality & Security Audit Report\n\n`;
  md += `| Metric | Status | Details |\n`;
  md += `| :--- | :---: | :--- |\n`;
  md += `| **Overall Health** | ${gradeEmoji} **Grade: ${rep.grade}** | **Score: ${rep.score}/100** |\n`;
  md += `| **Strict Typing** | ${rep.metrics.asAnyCount > 0 ? '⚠️' : '✅'} | ${rep.metrics.asAnyCount} \`as any\`, ${rep.metrics.colonAnyCount} \`: any\` |\n`;
  md += `| **God-Files (>1000 lines)** | ${rep.details.godFiles.length > 0 ? '🔴' : '✅'} | ${rep.details.godFiles.length} monolithic files |\n`;
  md += `| **Security & Infrastructure** | ${rep.metrics.securityIssues.length > 0 ? '🔴' : '✅'} | ${rep.metrics.securityIssues.length} issues detected |\n`;
  md += `| **Silent Catch Blocks** | ${rep.metrics.emptyCatchCount > 0 ? '⚠️' : '✅'} | ${rep.metrics.emptyCatchCount} empty catch blocks |\n`;
  md += `| **Environment Sync** | ${rep.metrics.missingEnvVars.length > 0 ? '⚠️' : '✅'} | ${rep.metrics.missingEnvVars.length} undocumented vars |\n`;
  if (rep.metrics.frontendIssues.length > 0) {
    md += `| **Frontend Performance** | 🟡 | Code-splitting needed (${rep.metrics.frontendIssues.length} issues) |\n`;
  }
  md += `\n`;

  md += `<details>\n<summary><b>🔍 View Detailed Findings & Remediation Checklist</b></summary>\n\n`;

  if (rep.metrics.securityIssues.length > 0) {
    md += `### 🛡️ Security & Infrastructure Findings\n`;
    rep.metrics.securityIssues.forEach(s => {
      const icon = s.severity === 'CRITICAL' ? '🔴' : s.severity === 'HIGH' ? '🟠' : '🟡';
      md += `- ${icon} **[${s.severity}] ${s.title}**\n  - *Impact:* ${s.description}\n`;
    });
    md += `\n`;
  }

  if (rep.details.godFiles.length > 0) {
    md += `### 🏛️ God-Files (>1,000 lines)\n`;
    rep.details.godFiles.forEach(g => {
      md += `- ✖ \`${g.file}\` — **${g.lines} lines** (${g.severity})\n`;
    });
    md += `\n`;
  }

  if (rep.details.anyHeavyFiles.length > 0) {
    md += `### 📊 Top Untyped Files ('any')\n`;
    rep.details.anyHeavyFiles.slice(0, 5).forEach(f => {
      md += `- \`${f.file}\`: **${f.total}** (\`as any\`: ${f.asAny}, \`: any\`: ${f.colonAny})\n`;
    });
    md += `\n`;
  }

  if (rep.details.emptyCatchFiles.length > 0) {
    md += `### 🔇 Silent Error Catch Blocks\n`;
    rep.details.emptyCatchFiles.forEach(ec => {
      md += `- \`${ec.file}\`: ${ec.count} empty \`catch (e) {}\`\n`;
    });
    md += `\n`;
  }

  if (rep.metrics.missingEnvVars.length > 0) {
    md += `### 📦 Undocumented Environment Variables\n`;
    md += `\`${rep.metrics.missingEnvVars.slice(0, 15).join('`, `')}${rep.metrics.missingEnvVars.length > 15 ? '...' : ''}\`\n\n`;
  }

  if (rep.details.strayRootScripts.length > 0) {
    md += `### 📂 Stray Scripts in \`src/\`\n`;
    md += `${rep.details.strayRootScripts.slice(0, 8).map(s => `\`${s}\``).join(', ')}${rep.details.strayRootScripts.length > 8 ? '...' : ''}\n\n`;
  }

  md += `</details>\n\n`;
  md += `*Report generated automatically by Enterprise Code Quality & Security Auditor.*`;
  return md;
}

const markdownReport = generateMarkdown(report);

if (outputFile) {
  fs.writeFileSync(outputFile, markdownReport, 'utf8');
}

if (isGithubSummary && process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${markdownReport}\n`, 'utf8');
}

// Post comment to Pull Request if running in GitHub Actions and flag is set
if (isCommentPr && process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY) {
  async function postPrComment() {
    try {
      let prNumber = process.env.PR_NUMBER;
      if (!prNumber && process.env.GITHUB_EVENT_PATH && fs.existsSync(process.env.GITHUB_EVENT_PATH)) {
        const eventData = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
        prNumber = eventData.pull_request?.number || eventData.issue?.number;
      }

      if (!prNumber) {
        console.log('[Audit] Not a pull request event. Skipping PR comment.');
        return;
      }

      const repo = process.env.GITHUB_REPOSITORY;
      const token = process.env.GITHUB_TOKEN;
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Enterprise-Code-Auditor'
      };

      // 1. Fetch existing comments to update instead of spamming
      const commentsRes = await fetch(`https://api.github.com/repos/${repo}/issues/${prNumber}/comments`, { headers });
      if (commentsRes.ok) {
        const comments = await commentsRes.json();
        const existing = comments.find(c => c.body?.includes('## 🛸 Code Quality & Security Audit Report'));
        if (existing) {
          console.log(`[Audit] Updating existing PR comment #${existing.id}...`);
          await fetch(`https://api.github.com/repos/${repo}/issues/comments/${existing.id}`, {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: markdownReport })
          });
          return;
        }
      }

      // 2. Create new comment
      console.log(`[Audit] Creating new comment on PR #${prNumber}...`);
      await fetch(`https://api.github.com/repos/${repo}/issues/${prNumber}/comments`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: markdownReport })
      });
    } catch (err) {
      console.error('[Audit] Failed to post PR comment:', err);
    }
  }

  postPrComment();
}

if (isJson) {
  console.log(JSON.stringify(report, null, 2));
} else if (isMarkdown) {
  console.log(markdownReport);
} else {
  // Terminal Output
  const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
  };

  console.log(`\n${c.bold}${c.cyan}══════════════════════════════════════════════════════════════════════${c.reset}`);
  console.log(`${c.bold}${c.cyan}      🛸 ENTERPRISE CODE QUALITY & SECURITY AUDITOR REPORT           ${c.reset}`);
  console.log(`${c.bold}${c.cyan}══════════════════════════════════════════════════════════════════════${c.reset}`);
  console.log(`Target Directory: ${c.bold}${targetDir}${c.reset}`);
  console.log(`Total Source Files: ${report.metrics.totalFiles}  |  Total Lines: ${report.metrics.totalLines}`);

  const gradeColor = report.grade === 'A' ? c.green : report.grade === 'B' ? c.cyan : report.grade === 'C' ? c.yellow : c.red;
  console.log(`\nOverall Grade: ${c.bold}${gradeColor}[ ${report.grade} ]${c.reset}  (Score: ${report.score}/100)\n`);

  console.log(`${c.bold}📊 1. Strict Typing & Type Safety${c.reset}`);
  console.log(`   - 'as any' occurrences: ${report.metrics.asAnyCount > 0 ? c.red : c.green}${report.metrics.asAnyCount}${c.reset}`);
  console.log(`   - ': any' occurrences:  ${report.metrics.colonAnyCount > 0 ? c.yellow : c.green}${report.metrics.colonAnyCount}${c.reset}`);
  if (report.details.anyHeavyFiles.length > 0) {
    console.log(`   Top files with 'any':`);
    report.details.anyHeavyFiles.slice(0, 5).forEach(f => {
      console.log(`     • ${f.file.padEnd(45)} total: ${f.total} (as any: ${f.asAny}, : any: ${f.colonAny})`);
    });
  }

  console.log(`\n${c.bold}🏛️ 2. Architectural God-Files (>1000 lines)${c.reset}`);
  if (report.details.godFiles.length === 0) {
    console.log(`   ${c.green}✔ No god-files detected!${c.reset}`);
  } else {
    report.details.godFiles.forEach(g => {
      const col = g.severity === 'CRITICAL' ? c.red : c.yellow;
      console.log(`   ${col}✖ [${g.severity}] ${g.file} (${g.lines} lines)${c.reset}`);
    });
  }

  console.log(`\n${c.bold}🛡️ 3. Security & Infrastructure Findings${c.reset}`);
  if (report.metrics.securityIssues.length === 0) {
    console.log(`   ${c.green}✔ No critical infrastructure vulnerabilities detected.${c.reset}`);
  } else {
    report.metrics.securityIssues.forEach(s => {
      const col = s.severity === 'CRITICAL' ? c.red : s.severity === 'HIGH' ? c.yellow : c.blue;
      console.log(`   ${col}✖ [${s.severity}] ${s.title}${c.reset}`);
      console.log(`     └─ ${s.description}`);
    });
  }

  console.log(`\n${c.bold}🔇 4. Error Observability & Silent Catches${c.reset}`);
  if (report.metrics.emptyCatchCount === 0) {
    console.log(`   ${c.green}✔ No empty catch blocks found.${c.reset}`);
  } else {
    console.log(`   ${c.yellow}✖ Found ${report.metrics.emptyCatchCount} empty catch (e) {} blocks that swallow errors silently:${c.reset}`);
    report.details.emptyCatchFiles.forEach(ec => {
      console.log(`     • ${ec.file} (${ec.count} empty catch blocks)`);
    });
  }

  console.log(`\n${c.bold}📦 5. Environment & Misplaced Scripts${c.reset}`);
  if (report.metrics.missingEnvVars.length > 0) {
    console.log(`   ${c.yellow}✖ Undocumented environment variables missing from .env.example:${c.reset}`);
    console.log(`     ${report.metrics.missingEnvVars.slice(0, 10).join(', ')}${report.metrics.missingEnvVars.length > 10 ? '...' : ''}`);
  } else {
    console.log(`   ${c.green}✔ .env.example is synchronized.${c.reset}`);
  }
  if (report.details.strayRootScripts.length > 0) {
    console.log(`   ${c.yellow}✖ ${report.details.strayRootScripts.length} stray scripts found in src/ root (should be in scripts/):${c.reset}`);
    console.log(`     ${report.details.strayRootScripts.slice(0, 6).join(', ')}${report.details.strayRootScripts.length > 6 ? '...' : ''}`);
  }

  if (report.metrics.frontendIssues.length > 0) {
    console.log(`\n${c.bold}⚡ 6. Frontend Performance & Bundle${c.reset}`);
    report.metrics.frontendIssues.forEach(fe => {
      console.log(`   ${c.yellow}✖ [${fe.severity}] ${fe.title}${c.reset}`);
      console.log(`     └─ ${fe.description}`);
    });
  }

  console.log(`\n${c.bold}${c.cyan}══════════════════════════════════════════════════════════════════════${c.reset}\n`);
}

if (failUnder !== null && report.score < failUnder) {
  console.error(`\n❌ Quality gate failed: Score ${report.score} is below threshold ${failUnder}.\n`);
  process.exit(1);
}
