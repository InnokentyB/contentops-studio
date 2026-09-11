import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pagePath = resolve(here, '../../src/pages/OrganizationIntelligence.tsx')
assert.equal(existsSync(pagePath), true, 'Organization Intelligence must have a dedicated UI surface')

const page = readFileSync(pagePath, 'utf8')
const app = readFileSync(resolve(here, '../../src/App.tsx'), 'utf8')
const api = readFileSync(resolve(here, '../../src/api.ts'), 'utf8')
const layout = readFileSync(resolve(here, '../../src/components/Layout.tsx'), 'utf8')

assert.match(app, /path="\/intelligence"/)
assert.match(layout, /\/intelligence/)
assert.match(api, /organizationIntelligenceApi/)
assert.match(page, /Intelligence Hub/)
assert.match(page, /Единый поиск|Unified search/)
assert.match(page, /Reddit/)
assert.match(page, /Indie Hackers/)
assert.match(page, /Project fit/)
assert.match(page, /Search history|История поисков/)
assert.match(page, /toggleSource/)
assert.match(api, /assessmentRevision/)
assert.match(api, /idempotencyKey: string/)
assert.match(page, /Partial|Частич/)
assert.match(page, /untrusted_external_content/)
assert.doesNotMatch(page, /publish_access_token|comment_access_token|ba_publish/)
