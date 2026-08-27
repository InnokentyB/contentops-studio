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

// Legacy/imported tasks may contain nulls or objects where older payloads promised arrays.
// The publication card must degrade to an empty source list instead of crashing React.
assert.match(source, /function asJsonRecordArray\(value: unknown\)/)
assert.match(source, /if \(!Array\.isArray\(value\)\) return \[\]/)
assert.match(source, /const handoffFiles = asJsonRecordArray\(/)
assert.match(source, /const resolvedAssets = asJsonRecordArray\(/)
assert.match(source, /const keyPoints = asJsonRecordArray\(/)

// Published content is a server-side status slice, so the readiness chip must
// switch that slice instead of combining an impossible "active + published" filter.
assert.match(source, /useState\('all'\)/)
assert.match(source, /if \(nextStatus === 'published'\)/)
assert.match(source, /Сбросить фильтры/)
assert.doesNotMatch(source, /hidePublished/)
assert.doesNotMatch(source, /Попробуй отключить режим `Только ручные`/)

assert.match(source, /Все статусы/)
assert.match(source, /statusCounts\.active/)
assert.match(source, /statusCounts\.published/)
assert.match(source, /statusCounts\.blocked/)
assert.match(source, /statusCounts\.removed/)
assert.match(source, /Дата вне недели/)
assert.match(source, /Из пакета №/)
assert.match(source, /publication_tasks_by_date/)
assert.match(source, /служебных/)
assert.match(source, /Номер #760, название или канал/)
assert.match(source, /Номер задачи \$\{task\.id\}/)
assert.match(source, /#\{task\.id\}/)
assert.match(source, /Открыть задачу #\$\{task\.id\}/)
