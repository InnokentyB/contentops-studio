import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(__dirname, '../..')
const app = readFileSync(resolve(frontendRoot, 'src/App.tsx'), 'utf8')
const landing = readFileSync(resolve(frontendRoot, 'src/pages/Landing.tsx'), 'utf8')
const styles = readFileSync(resolve(frontendRoot, 'src/pages/Landing.css'), 'utf8')

assert.match(app, /path="\/" element={<Landing \/>}/)
assert.match(app, /location\.pathname === '\/product'/)
assert.match(landing, /ContentOps Studio/)
assert.match(landing, /Accepted copy|Принятый текст/)
assert.match(landing, /Approved visual|Утверждённые визуалы/)
assert.match(landing, /object ID|provider ID|идентификатора публикации/)
assert.doesNotMatch(landing, /fetch\(|axios|\/api\//)
assert.doesNotMatch(landing, /[—–]/)
assert.match(styles, /prefers-reduced-motion/)
assert.match(styles, /color-scheme: light/)

for (const asset of [
  'public/robots.txt',
  'public/sitemap.xml',
  'public/landing/product-overview.webp',
  'public/landing/publication-workflow.webp'
]) {
  assert.ok(existsSync(resolve(frontendRoot, asset)), `Missing landing asset: ${asset}`)
}
