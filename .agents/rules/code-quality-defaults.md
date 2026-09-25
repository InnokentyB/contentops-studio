---
trigger: always_on
---

# 🛡️ Code Quality Defaults (v1.1)

> Auto-loaded rule. Applies to **every** code generation and modification task.
> Source: Enterprise Code Quality Audit & Multi-Agent Hardening, 25 Sep 2026.

---

## 1. Strict Typing — Zero-Any Policy

- **BLOCK**: Never emit `as any`, `: any`, or `<any>`. No exceptions.
- Use `unknown` + type narrowing for catch blocks: `catch (error: unknown)`.
- React event handlers must use precise types (`React.ChangeEvent<HTMLInputElement>`).
- External APIs without types → create an `interface` or use `z.infer<typeof Schema>`.
- All exported functions must have explicit parameter types and return type annotations.

## 2. Architecture — Anti-God-File Guard

- **BLOCK**: New files must not exceed **400 lines**. Soft limit 600, hard limit 1 000.
- Before adding code to an existing file, check its size. If > 800 lines → propose decomposition first.
- Backend business logic → domain repositories (`lib/repositories/<domain>.ts` or `src/services/<domain>/`). Entry point stays a thin facade with re-exports.
- **Decomposition Structure**: Standard directory layout for decomposed modules:
  - `types.ts` — domain DTOs, parameters, and interfaces.
  - `helpers.ts` / `utils.ts` — pure functions without side-effects.
  - `<workflow/entity>.ts` — business operations and mutations.
  - `index.ts` — re-exporting the slice.
- UI components > 300 lines → split into sub-components in a subdirectory (`components/admin/`).
- **BLOCK**: Decomposition must preserve **100% backward compatibility** via re-export from the original file (Facade Pattern).
- **BLOCK (Source Contract Guard)**: Before decomposing any file, verify if tests inspect it directly via source code assertions (`grep -rn 'readFileSync.*<filename>' src/tests/`). The facade must retain required anchors (explicit registrations or method names) to prevent breaking AST/source-contract tests.
- Scripts (`test-*.ts`, `fix-*.ts`, `migrate-*.ts`) belong in `scripts/`, never in `src/`.

## 3. Security Hardening

- **BLOCK**: CORS — never use `origin: true` or `origin: '*'`. Bind to `process.env.FRONTEND_URL`.
- **BLOCK**: Secret comparison (tokens, API keys, passwords) — only via `crypto.timingSafeEqual()`. Implement a `safeCompare(a, b)` helper.
- Register `helmet` / `@fastify/helmet` on every HTTP server.
- Auth endpoints (`/login`, `/register`, `/forgot-password`) must have rate-limiting (5–10 req/min).
- **BLOCK**: All request bodies validated through a Zod schema **before** reaching the service layer. No `request.body as any`.
- Provider API keys stored in DB must be encrypted with AES-256-GCM. Never store plaintext.
- User-supplied file paths → canonicalize with `path.resolve()` + verify `startsWith(allowedBase)`.
- **BLOCK (Remote MCP Tenancy & Identity)**: In Remote MCP / Agent integrations, user identity and project scope (`userId`, `projectId`, `organizationId`) must be injected and verified strictly from the authenticated token/session. Caller/LLM-supplied tenant arguments must never override the token principal.
- **BLOCK (MCP Tool Annotations)**: All mutating MCP tools must explicitly define annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`).
- **BLOCK (Header & Cookie Sanitization)**: Validate user-supplied cookies/headers against RFC 6265 (prevent control chars `\u0000-\u001F`, enforce strict domain whitelist, prevent CRLF injection).

## 4. Observability & Error Handling

- **BLOCK**: No empty catch blocks `catch (e) {}`. Every catch must: (a) log with context, (b) rethrow, or (c) return an explicit fallback with a comment explaining why.
- Error logs in business-critical paths must include: `error.message`, `error.stack`, entity identifier (`userId`, `orderId`, `requestId`).
- Top-level async calls without try/catch → add `.catch()` or wrap in try/catch.

## 5. Environment Safety

- **BLOCK**: When adding any new `process.env.VAR_NAME` → **must** also add it to `.env.example` with an empty value and a descriptive comment.
- **BLOCK**: Never hardcode secrets, URLs, or API keys in source code. Only via `process.env`.
- When creating a new project → generate `.env.example` alongside the first config file.
- Group variables in `.env.example` by domain with comment separators.

## 6. Infrastructure Resilience

- **BLOCK**: Every `new Pool()` must have `pool.on('error', handler)` attached.
- Explicitly configure pool: `max`, `connectionTimeoutMillis`, `idleTimeoutMillis`.
- **BLOCK**: Every manual `const client = await pool.connect()` must have a guaranteed `finally { client.release(); }`.
- **BLOCK**: Inside `prisma.$transaction(async (tx) => ...)`, never invoke the global `prisma` client or raw `pool` for transactional state changes.
- **BLOCK**: Every `setInterval(async () => ...)` must have a concurrency guard flag (`let isRunning = false; if (isRunning) return;`).
- Persistent connections (Pool, Prisma, Redis) → mandatory graceful shutdown on `SIGTERM` / `SIGINT`.
- WebSocket connections in React `useEffect` → mandatory cleanup in the return function.
- **BLOCK (Browser / Puppeteer Cleanup)**: Every `browser.newPage()`, `puppeteer.launch()`, or headless browser context must have mandatory cleanup in `finally { await page.close().catch(...) }` to prevent zombie Chromium processes and memory leaks.

## 7. Testing Contract

- **BLOCK**: Every new feature/function must include at least one functional test.
- Tests are written **before or alongside** implementation (TDD or Test-Alongside).
- **BLOCK**: After any refactoring → run `npm test` and `npm run build` to verify nothing is broken.
- **BLOCK**: When decomposing a god-file → all existing tests must continue to pass without modification (backward compatibility via re-export).
- **BLOCK (Idempotent External Dispatch)**: All mutating external provider calls (publishing, payments, webhooks) must be guarded by an `idempotencyKey` and record uncertain provider outcomes without blind retry.

## 8. Documentation Hygiene

- Every exported function must have a JSDoc/Docstring comment.
- **BLOCK**: Existing comments and docstrings unrelated to current changes must not be deleted or rewritten.
- When creating a new module/repository → add a description to the root README or an ADR.

---

## Pre-Commit Quality Gate

Before declaring any task complete, verify:

1. `grep -rn 'as any\|: any'` returns **0** results in changed files.
2. No modified file exceeds **1 000 lines** (soft limit 600).
3. `grep -rn 'catch.*{}'` returns **0** empty catch blocks.
4. Every `process.env.X` is present in `.env.example`.
5. CORS is not wildcard; secrets use `timingSafeEqual`.
6. `pool.on('error')` is present; async schedulers have guards; manual pool clients released in `finally`.
7. Headless browser pages closed in `finally`.
8. `npm test && npm run build` pass.
9. All new exports have JSDoc.
10. Source-checking tests (`readFileSync` assertions) verified and intact.
11. `node ~/.gemini/config/skills/code-quality-auditor/scripts/audit-code-quality.mjs <project> --fail-under=90` passes.
