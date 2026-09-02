import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(__dirname, '../..')
const html = readFileSync(resolve(frontendRoot, 'index.html'), 'utf8')
const login = readFileSync(resolve(frontendRoot, 'src/pages/Login.tsx'), 'utf8')
const layout = readFileSync(resolve(frontendRoot, 'src/components/Layout.tsx'), 'utf8')
const styles = readFileSync(resolve(frontendRoot, 'src/index.css'), 'utf8')
const manifest = JSON.parse(readFileSync(resolve(frontendRoot, 'public/site.webmanifest'), 'utf8'))

for (const surface of [html, login, layout]) {
  assert.match(surface, /ContentOps Studio/)
  assert.doesNotMatch(surface, /Project Alpha|Cognitive Assistant/)
}

assert.match(html, /name="description"/)
assert.match(html, /property="og:title"/)
assert.match(html, /name="twitter:card"/)
assert.match(html, /contentops-studio-mark\.svg/)
assert.doesNotMatch(html, /fonts\.googleapis\.com\/.*Material\+Symbols/)
assert.match(styles, /url\('\/fonts\/material-symbols-outlined\.woff2'\)/)
assert.match(styles, /font-feature-settings: 'liga'/)
assert.equal(manifest.name, 'ContentOps Studio')
assert.ok(existsSync(resolve(frontendRoot, 'public/contentops-studio-mark.svg')))
assert.ok(existsSync(resolve(frontendRoot, 'public/contentops-studio-og.png')))
assert.ok(existsSync(resolve(frontendRoot, 'public/fonts/material-symbols-outlined.woff2')))
