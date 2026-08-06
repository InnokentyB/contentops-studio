import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '../../src/pages/PublicationTasks.tsx'), 'utf8')

assert.match(source, /Что сделать сейчас/)
assert.match(source, /Сначала подготовьте текст публикации/)
assert.match(source, /Подготовить черновик/)
assert.match(source, /Подтвердить ссылку на опубликованный пост/)
assert.match(source, /После публикации вставьте ссылку на пост/)
assert.doesNotMatch(source, /Prepare Handoff/)
assert.doesNotMatch(source, /Подтвердить live URL/)
