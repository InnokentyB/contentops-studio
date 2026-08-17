import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(path.resolve('src/pages/PublicationTasks.tsx'), 'utf8')
const api = fs.readFileSync(path.resolve('src/api.ts'), 'utf8')

assert.match(source, /Факт подтверждён/)
assert.match(source, /Story без постоянной ссылки/)
assert.match(source, /Контрольные снимки/)
assert.match(source, /T\+24 часа/)
assert.match(source, /неизвестное значение не считается нулём/)
assert.match(source, /weekPackageId/)
assert.match(api, /recordPublicationFact/)
assert.match(api, /recordMetricCheckpoint/)
assert.match(api, /listWeeks/)

console.log('publication fact/checkpoint UI contract passed')
