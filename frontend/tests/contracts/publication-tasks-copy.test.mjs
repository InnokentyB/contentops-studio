import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '../../src/pages/PublicationTasks.tsx'), 'utf8')

assert.match(source, /Нужен текст/)
assert.match(source, /Текст готов/)
assert.match(source, /Опубликовано/)
assert.match(source, /content_state/)

assert.match(source, /Проверьте текст\. Затем опубликуйте его и сохраните ссылку/)
assert.match(source, /Подготовить черновик/)
assert.match(source, /Зафиксировать факт публикации/)
assert.match(source, /Материалы и контекст/)
assert.match(source, /как увидит читатель/)
assert.doesNotMatch(source, /Что сделать сейчас/)
assert.doesNotMatch(source, /Prepare Handoff/)
assert.doesNotMatch(source, /Подтвердить live URL/)
