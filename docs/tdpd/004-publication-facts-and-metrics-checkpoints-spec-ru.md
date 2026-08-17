# TDPD-004: Факт публикации и контрольные снимки метрик

Статус: approved for combined RED phase  
Режим: TDPD Deliver (совместно с TDPD-005)  
Метод: Test-Driven Product Development (TDPD), оригинальный метод Иннокентия Бодрова  
Версия: 0.1  
Дата: 2026-08-17

## 1. Бизнес-проблема

Планнер хранит задачи публикации, но не даёт надёжно восстановить, что действительно вышло и какой результат получило:

- workflow-статус `published` может сосуществовать с `publication_outcome = removed`;
- часть реальных публикаций сохраняется в операционных задачах, а не в номинальном канальном слоте;
- у обычных постов может отсутствовать фактическая ссылка;
- stories не имеют постоянной публичной ссылки и поэтому не укладываются в текущий `ba_confirm_publication`, где URL обязателен;
- существующие `MetricSnapshot` почти не заполняются, checkpoints не соответствуют требуемым T+24h и T+7d;
- отсутствие данных не отделено от наблюдаемого нуля и неподдерживаемой метрики;
- текущий campaign rollup суммирует несколько накопительных снимков одного материала и может задвоить просмотры, реакции и комментарии.

В результате недельный отчёт нельзя воспроизвести из планера без ручной сверки с живыми площадками.

### Акторы

- SMM/дистрибутор, подтверждающий факт публикации;
- контент-оператор, фиксирующий ручные метрики;
- growth-аналитик, строящий недельный отчёт;
- планнер, создающий checkpoints и хранящий историю;
- адаптеры площадок и Яндекс.Метрики как источники наблюдений;
- владелец проекта, проводящий приёмку (UAT).

### Сигналы успеха

- 100% новых фактически опубликованных материалов имеют нормализованный факт публикации;
- 0 задач с outcome, отличным от `published`, попадают в публикационные и метрические rollup;
- обычный публичный пост нельзя подтвердить без permalink или явно поддержанного исключения;
- story можно подтвердить без permalink, но нельзя без идентичности, времени, доказательства и состояния целевой ссылки;
- для каждого опубликованного материала автоматически создаются checkpoints T+24h и T+7d;
- каждое поле метрики различает наблюдаемое значение, `UNKNOWN` и `NOT_SUPPORTED`;
- повторный сбор одного checkpoint не создаёт дубль;
- недельный отчёт воспроизводится из сохранённых фактов и снимков без обращения к живой площадке.

## 2. Существующая основа и разрыв

### Уже существует

- `ContentItem.published_link`;
- `publication_outcome` внутри JSON `metrics` и `quality_report`;
- `MetricSnapshot` с уникальностью по проекту, content item, каналу и checkpoint;
- MCP `ba_record_metric_snapshot` и `ba_get_content_metrics`;
- отдельный `VkMetricSnapshot` и VK-сборщик;
- `ba_confirm_publication` для ручного подтверждения.

### Необходимо изменить

- перенести канонический факт публикации из дублирующихся JSON-полей в нормализованную модель;
- заменить предикаты вида `status === published || published_link` единым каноническим предикатом;
- разрешить nullable permalink только для типов без постоянной публичной ссылки;
- привести checkpoints к `t24h` и `t7d`;
- расширить снимок provenance, timestamp и статусами качества;
- прекратить объединять снимки через `Object.assign` и суммировать накопительные значения между checkpoint;
- создать очередь due-checkpoints и ручной интерфейс заполнения.

## 3. Граница первого слайса

### Входит

- нормализованный факт публикации;
- обратная совместимость с `ContentItem.published_link`;
- типы артефактов `post`, `article`, `story`, `email`, `comment`, `other`;
- checkpoints `t24h` и `t7d`;
- ручная запись универсальных метрик;
- создание ручных задач измерения для площадок без адаптера;
- автоматический сбор через уже существующие адаптеры, где он доступен;
- отдельная фиксация UTM-переходов;
- канонический фильтр outcome;
- UI факта публикации и карточек checkpoints;
- MCP и REST-контракты;
- миграция существующих опубликованных задач с отчётом неоднозначностей;
- недельный rollup без двойного счёта.

### Не входит

- разработка новых API-интеграций со всеми социальными сетями;
- восстановление отсутствующих метрик задним числом;
- автоматическое редактирование живых постов;
- хранение скриншотов непосредственно в базе; хранится ссылка на asset/evidence;
- трактовка `UNKNOWN` как нуля;
- продуктовые рекомендации по качеству контента;
- рекламная атрибуция вне переданных источником полей.

## 4. Архитектурная граница для согласования

### 4.1. `PublicationFact`

Добавить модель, один актуальный факт на `ContentItem`:

| Поле | Тип | Правило |
|---|---|---|
| `id` | Int | PK |
| `project_id` | Int | обязательная изоляция проекта |
| `content_item_id` | Int | unique, FK |
| `channel_id` | Int | FK |
| `artifact_kind` | enum/string | `post/article/story/email/comment/other` |
| `outcome` | enum/string | `published/blocked/removed/restricted` |
| `published_at` | timestamptz nullable | обязательно только для `published` |
| `public_url` | text nullable | permalink обычного артефакта |
| `provider_object_id` | text nullable | ID поста/story/email у провайдера |
| `confirmation_mode` | enum/string | `automatic/manual/imported/reconciled` |
| `evidence_type` | enum/string nullable | `public_url/provider_id/screenshot/manual_note/api` |
| `evidence_ref` | text nullable | URL или asset ref, не бинарный файл |
| `target_url` | text nullable | фактическая CTA/story ссылка |
| `utm_status` | enum/string | `pass/not_applicable/missing/invalid/unknown` |
| `confirmed_by` | text | actor ID |
| `confirmed_at` | timestamptz | audit timestamp |
| `created_at`, `updated_at` | timestamps | стандартно |

`ContentItem.published_link` остаётся временной read-through/write-through проекцией `PublicationFact.public_url` на один релизный цикл. Новая бизнес-логика читает `PublicationFact`.

### 4.2. Канонический предикат публикации

```text
isActuallyPublished(item) :=
  publication_fact.outcome == "published"
  AND publication_fact.published_at IS NOT NULL
  AND identityRulePassed(publication_fact)
```

`ContentItem.status` описывает workflow и не участвует в подсчёте фактических публикаций.

### 4.3. Правило идентичности

- `post`, `article`, `comment`: обязательны `public_url` и `published_at`.
- `story`: обязательны `published_at`, `provider_object_id` или внутренний стабильный `story:<channel>:<timestamp>`, а также `evidence_ref` или API-подтверждение. `public_url` может быть `null`.
- `email`: обязательны `provider_object_id` кампании/письма и `published_at`; публичный URL не требуется.
- Исключение для платформы без permalink задаётся capability канала, а не произвольной ручной галочкой.

### 4.4. Эволюция `MetricSnapshot`

Сохранить существующую таблицу, расширить поля:

| Поле | Назначение |
|---|---|
| `checkpoint` | строго `t24h` или `t7d`; legacy значения мигрируются/помечаются |
| `scheduled_for` | ожидаемое время сбора |
| `captured_at` | фактическое время наблюдения |
| `collection_mode` | `automatic/manual/imported` |
| `source` | `provider_api/public_page/yandex_metrika/manual` |
| `collection_status` | `pending/collected/partial/unknown/not_supported/failed/overdue` |
| `metrics` | версионированный payload |
| `evidence_ref` | опциональная ссылка на скриншот/отчёт |
| `error_code`, `error_message` | безопасная причина без секретов |
| `idempotency_key` | обязательна для автоматического сбора |

Формат `metrics` v1:

```json
{
  "schema_version": 1,
  "values": {
    "views": { "value": 120, "status": "observed" },
    "impressions": { "value": null, "status": "not_supported" },
    "reactions": { "value": 4, "status": "observed" },
    "comments": { "value": 0, "status": "observed" },
    "reposts": { "value": null, "status": "unknown" },
    "platform_clicks": { "value": null, "status": "unknown" },
    "utm_visits": { "value": 9, "status": "observed" }
  }
}
```

Допустимые metric status: `observed`, `unknown`, `not_supported`, `invalid`. `observed: 0` отличается от `unknown: null`.

### 4.5. Checkpoint scheduling

После создания `PublicationFact(outcome=published)` планнер идемпотентно создаёт:

- `t24h`: `published_at + 24h`;
- `t7d`: `published_at + 7d`.

Для story платформенный T+24h собирается в последнем доступном окне до исчезновения, по умолчанию `published_at + 23h`, но сохраняется как checkpoint `t24h` с фактическим `captured_at`. UTM-визиты собираются за полное окно 24 часа. На T+7d неподдерживаемые платформенные story-метрики получают `not_supported`, а UTM-визиты могут быть собраны отдельно.

Если адаптер поддерживает аналитику — создаётся автоматическая job. Если нет — `WorkItem(kind=metric_capture, assignee_role=metrics_operator)`.

### 4.6. Rollup

- Материал участвует только при каноническом `outcome=published`.
- Для накопительных платформенных метрик недельный срез использует последнее доступное наблюдаемое значение выбранного checkpoint, а не сумму T+24h и T+7d.
- Суммирование разрешено между разными публикациями, но не между checkpoints одной публикации.
- UTM-визиты хранятся как значение окна (`window_start`, `window_end`) и не складываются при пересечении окон.
- `removed`, `blocked`, `restricted` исключаются даже при workflow-статусе `published` и наличии старой ссылки.
- Отчёт содержит coverage: опубликовано, ожидается checkpoints, собрано полностью, partial, unknown, overdue.

## 5. Детерминированные правила

### R-PFM-001 — обычный пост без permalink

Подтверждение `artifact_kind=post/article/comment`, `outcome=published` без `public_url` отклоняется с `PUBLIC_URL_REQUIRED`.

### R-PFM-002 — story без публичной ссылки

Story допускает `public_url=null`, если есть `published_at`, стабильный ID, channel, confirmation mode и evidence. Отсутствие любого обязательного элемента даёт `STORY_EVIDENCE_REQUIRED`.

### R-PFM-003 — outcome старше workflow-статуса

`outcome=removed/blocked/restricted` исключает задачу из rollup независимо от `ContentItem.status`, `published_link` и legacy JSON.

### R-PFM-004 — неизменяемый исторический факт

После создания `published` факт нельзя молча перезаписать импортом плана. Исправление permalink, времени или идентичности создаёт audit event с actor, old/new и reason.

### R-PFM-005 — checkpoints создаются один раз

Повторное подтверждение или retry не создаёт второй `t24h`/`t7d` для того же content item и канала.

### R-PFM-006 — отсутствие данных

Пустое поле, ошибка API или неподдерживаемая метрика не превращаются в ноль. Ноль допустим только как `value=0, status=observed`.

### R-PFM-007 — запоздалый ручной снимок

Снимок после due-time сохраняет реальный `captured_at` и получает `collection_status=collected` плюс `late=true`. Он не притворяется измерением ровно в checkpoint.

### R-PFM-008 — частичный сбор

Успешные метрики сохраняются независимо от ошибок других источников. Snapshot имеет `partial`; каждое поле сохраняет собственный status.

### R-PFM-009 — story T+7d

Если площадка не предоставляет архивную story-аналитику, платформенные значения T+7d — `not_supported`, но checkpoint остаётся и хранит доступную UTM-часть.

### R-PFM-010 — target URL и UTM

Если опубликованный артефакт содержит target URL на отслеживаемый домен, `utm_status` обязан быть `pass`, `missing`, `invalid` или `unknown`. `not_applicable` разрешён только при отсутствии target URL или для внутренней ссылки.

### R-PFM-011 — консолидация

`ba_get_content_metrics` возвращает snapshots отдельно и вычисленный `latest_by_metric` с provenance. Метод не объединяет payload через безусловный `Object.assign`.

### R-PFM-012 — проектная изоляция

Все read/write/rollup запросы проверяют membership проекта. Известный ID чужой задачи не раскрывает факт публикации, URL, evidence или метрики.

## 6. Пользовательские сценарии

### SC-PFM-001 — подтверждение обычного поста

**Начальное состояние:** задача одобрена, но факта публикации нет.  
**Действие:** оператор указывает permalink и фактическое время.  
**Результат:** создаётся `PublicationFact(published)`, legacy `published_link` синхронизируется, создаются T+24h и T+7d.  
**Критерий:** после перезагрузки видны факт и два pending checkpoint без дублей.

### SC-PFM-002 — попытка подтвердить пост без ссылки

**Действие:** оператор подтверждает обычный post без permalink.  
**Результат:** форма и API отклоняют запрос с `PUBLIC_URL_REQUIRED`; статус задачи не меняется.  
**Критерий:** ложный факт и checkpoints не созданы.

### SC-PFM-003 — подтверждение Telegram/VK story

**Действие:** оператор выбирает story, указывает канал, время, target URL или `NO_LINK`, внутренний story ID и evidence screenshot/ref.  
**Результат:** story фиксируется без публичного permalink; создаются T+24h/T+7d.  
**Критерий:** story попадает в список фактических размещений как отдельный артефакт.

### SC-PFM-004 — story без evidence

**Действие:** оператор отправляет story только с текстовой пометкой «опубликовано».  
**Результат:** `STORY_EVIDENCE_REQUIRED`; факт не создаётся.  
**Критерий:** ручное слово без идентичности не считается публикацией.

### SC-PFM-005 — задача `published + removed`

**Начальное состояние:** legacy status равен `published`, outcome равен `removed`.  
**Действие:** аналитик открывает недельный rollup.  
**Результат:** задача отсутствует в количестве публикаций и метриках, но видна в разделе исключённых.  
**Критерий:** итог не меняется при наличии `published_link`.

### SC-PFM-006 — ручной T+24h с наблюдаемым нулём

**Действие:** оператор вводит views=120, reactions=0, comments=0, clicks неизвестны.  
**Результат:** нули сохранены как observed, clicks как unknown.  
**Критерий:** UI и API не превращают unknown clicks в 0.

### SC-PFM-007 — автоматический retry checkpoint

**Начальное состояние:** T+24h уже собран.  
**Внешнее событие:** worker повторяет ту же job/idempotency key.  
**Результат:** второй snapshot не создаётся.  
**Критерий:** один checkpoint, одна актуальная запись, audit retry доступен в логах.

### SC-PFM-008 — частичная ошибка источников

**Начальное состояние:** платформа дала views/reactions, Метрика временно недоступна.  
**Результат:** platform values observed, UTM visits unknown, snapshot partial.  
**Критерий:** доступные числа сохраняются и не стираются retry-ошибкой.

### SC-PFM-009 — T+7d без поддержки story analytics

**Действие:** наступает T+7d story.  
**Результат:** platform fields not_supported, UTM visits collected или unknown.  
**Критерий:** checkpoint закрывается честно и не остаётся вечным pending.

### SC-PFM-010 — недельный rollup двух checkpoints

**Начальное состояние:** один пост имеет 100 views T+24h и 180 views T+7d.  
**Действие:** строится отчёт.  
**Результат:** вклад поста — 180, а не 280.  
**Критерий:** накопительные checkpoint не суммируются.

### SC-PFM-011 — ручной снимок просрочен

**Начальное состояние:** T+24h overdue на двое суток.  
**Действие:** оператор вводит данные.  
**Результат:** сохраняется реальный captured_at и late marker.  
**Критерий:** отчёт показывает запоздание и не приписывает снимок исходному часу.

### SC-PFM-012 — импорт плана после публикации

**Начальное состояние:** есть подтверждённый факт и snapshots.  
**Действие:** delta import содержит старый planned slot без runtime данных.  
**Результат:** факт и snapshots сохраняются неизменными.  
**Критерий:** импорт не откатывает runtime truth.

### SC-PFM-013 — исправление ошибочного permalink

**Действие:** уполномоченный оператор исправляет URL с обязательной причиной.  
**Результат:** факт обновлён, audit event содержит old/new/actor/reason; checkpoints не дублируются.  
**Критерий:** история изменения воспроизводима.

### SC-PFM-014 — изоляция проектов

**Действие:** пользователь проекта A запрашивает факт или metrics задачи проекта B.  
**Результат:** ответ эквивалентен отсутствующему ресурсу.  
**Критерий:** URL, evidence и числа не раскрываются.

## 7. E2E/test matrix — сначала RED

| Test ID | Сценарий | Уровень | Ожидаемый RED до реализации |
|---|---|---|---|
| E2E-PFM-001 | SC-001 | API + DB | факт и два checkpoints не создаются как контракт |
| E2E-PFM-002 | SC-002 | API | текущий confirm принимает/требует URL без artifact rules |
| E2E-PFM-003 | SC-003 | UI + API | story нельзя подтвердить без URL |
| E2E-PFM-004 | SC-004 | API | нет обязательного evidence contract |
| E2E-PFM-005 | SC-005 | rollup | `published + removed` может быть посчитан |
| E2E-PFM-006 | SC-006 | MCP + DB | нет per-metric статусов |
| E2E-PFM-007 | SC-007 | worker + DB | checkpoints не создаются/не исполняются по новому расписанию |
| E2E-PFM-008 | SC-008 | service | partial provenance не моделируется |
| E2E-PFM-009 | SC-009 | worker | story T+7d не закрывается как not_supported |
| E2E-PFM-010 | SC-010 | rollup | текущий rollup суммирует snapshots |
| E2E-PFM-011 | SC-011 | UI + DB | late capture не различается |
| E2E-PFM-012 | SC-012 | import | проверить сохранение новой relation |
| E2E-PFM-013 | SC-013 | API + audit | нет versioned correction workflow |
| E2E-PFM-014 | SC-014 | auth | проверить project membership на новых endpoints |

Дополнительные unit/contract tests:

- `isActuallyPublished` для всех outcome/status/link комбинаций;
- schema validation metric payload v1;
- story identity validation;
- checkpoint scheduling в timezone проекта и на DST;
- выбор latest observed value без двойного счёта;
- непересекающиеся и пересекающиеся UTM windows;
- idempotent migration и backfill.

## 8. API и MCP

### 8.1. Подтверждение факта

Расширить `ba_confirm_publication` с обратной совместимостью либо ввести `ba_record_publication_fact` и объявить старый метод deprecated.

Предпочтительный новый контракт:

```json
{
  "projectId": 10,
  "taskId": 751,
  "actorId": "growth_ops",
  "artifactKind": "story",
  "outcome": "published",
  "publishedAt": "2026-08-15T18:30:00+01:00",
  "publicUrl": null,
  "providerObjectId": "story:vk_group:20260815T183000",
  "evidence": { "type": "screenshot", "ref": "asset://..." },
  "targetUrl": "https://analystcraft.ru/...?utm_source=vk_group&...",
  "confirmationMode": "manual",
  "note": "Опубликовано вручную"
}
```

### 8.2. Запись snapshot

`ba_record_metric_snapshot` принимает строгие поля checkpoint/source/status и metric payload v1. Произвольный checkpoint для новых записей запрещён.

### 8.3. Чтение

- `ba_get_publication_fact(projectId, taskId)`;
- `ba_list_metric_checkpoints(projectId, status?, dueBefore?, channelId?)`;
- `ba_get_content_metrics` возвращает `publication_fact`, snapshots, `latest_by_metric`, coverage;
- `ba_rollup_campaign_metrics` принимает период и checkpoint policy, исключает non-published outcome;
- REST endpoints повторяют те же правила и authorization.

## 9. UI

### Карточка факта публикации

Показывать:

- outcome отдельно от workflow status;
- тип артефакта;
- permalink или маркировку «нет постоянной ссылки»;
- provider ID;
- published_at;
- evidence;
- target URL и UTM status;
- кто и когда подтвердил;
- audit history исправлений.

### Карточки T+24h и T+7d

Для каждого checkpoint:

- due time и фактический captured_at;
- status и late marker;
- источник каждого набора данных;
- поля views/impressions/reactions/comments/reposts/platform clicks/UTM visits;
- явные `UNKNOWN` и `NOT_SUPPORTED`;
- действие «Записать вручную» или «Повторить сбор»;
- evidence ref.

### Очередь измерений

Отдельный фильтр:

- due today;
- overdue;
- partial/failed;
- awaiting T+7d;
- stories expiring soon.

## 10. Миграция

1. Создать `PublicationFact` и расширить `MetricSnapshot` без удаления legacy полей.
2. Backfill кандидатов из `ContentItem`:
   - outcome брать с приоритетом из канонически выбранного JSON-источника;
   - `removed/blocked/restricted` переносить без факта published;
   - published с валидным permalink переносить автоматически;
   - story/manual handoff без URL отправлять в reconciliation queue;
   - конфликт outcome между `metrics` и `quality_report` не разрешать молча.
3. Выдать migration report: migrated, excluded, ambiguous, missing identity.
4. Один релиз писать одновременно в relation и legacy поля.
5. Перевести read paths и rollup на новую модель.
6. После UAT прекратить запись канонического outcome в два JSON-поля; оставить read compatibility на оговорённый срок.

Rollback: новая таблица и поля additive. При откате старые read paths продолжают использовать `ContentItem`; миграция не удаляет legacy значения и snapshots.

## 11. Безопасность и эксплуатация

- project membership обязателен для всех facts, evidence и snapshots;
- evidence ref не должен раскрывать приватный bucket без signed URL;
- не хранить access tokens, cookies или полный provider payload в metric JSON;
- ручные исправления факта требуют actor и reason;
- worker имеет bounded retry/backoff и не создаёт бесконечные jobs;
- ошибки внешних API сохраняются в безопасном нормализованном виде;
- timestamps хранятся в UTC, due time отображается в timezone проекта;
- удаление ContentItem каскадно удаляет facts/snapshots только в рамках существующей политики удаления проекта; UI не предоставляет destructive delete как часть этого слайса.

## 12. Наблюдаемость

Системные метрики:

- `publication_facts_created_total{artifact_kind,confirmation_mode}`;
- `metric_checkpoints_due_total{checkpoint}`;
- `metric_checkpoints_overdue_total{channel}`;
- `metric_collection_total{source,status}`;
- `publication_reconciliation_total{reason}`;
- `rollup_excluded_total{outcome}`;
- latency от `scheduled_for` до `captured_at`.

Audit events:

- fact created/corrected;
- outcome changed;
- checkpoint created/collected/retried/closed unsupported;
- migration conflict classified.

## 13. Приёмка (UAT)

Владелец проекта выполняет четыре реалистичных прохода:

1. Подтверждает обычный пост по permalink и видит два checkpoints.
2. Подтверждает Telegram/VK story без permalink, но с evidence и UTM target.
3. Вводит T+24h: observed zero для реакции, unknown для clicks; после перезагрузки различие сохраняется.
4. Открывает недельный отчёт с задачей `published + removed` и постом с двумя checkpoints; removed исключён, views не задвоены.

UAT verdict: `accepted`, `accepted_with_followups` или `rejected` с записью нового сценария/решения.

## 14. Traceability

| Проблема | Правила | Сценарии | Тесты |
|---|---|---|---|
| ложные публикации | R-001–005 | SC-001–005, 012–013 | E2E-001–005, 012–013 |
| пустые/ложные метрики | R-005–009, 011 | SC-006–011 | E2E-006–011 |
| двойной счёт | R-003, R-011 | SC-005, 010 | E2E-005, 010 |
| stories без permalink | R-002, R-009–010 | SC-003–004, 009 | E2E-003–004, 009 |
| изоляция данных | R-012 | SC-014 | E2E-014 |

## 15. Открытые решения до Input gate

1. Утвердить новую `PublicationFact` как канонический источник вместо очередного JSON-блока.
2. Выбрать: расширять `ba_confirm_publication` или вводить новый метод с deprecation старого. Рекомендация — новый контракт и адаптер совместимости.
3. Утвердить правило story T+24h: сбор в +23h как ближайшая наблюдаемая точка до исчезновения.
4. Утвердить срок dual-write legacy полей: рекомендация один стабильный релиз после UAT.
5. Определить первый набор автоматических адаптеров. Рекомендация: использовать существующий VK; остальные площадки начать с ручного checkpoint.
6. Определить источник UTM-визитов в MVP: ручной импорт из Метрики или сервисная интеграция. Рекомендация: ручной ввод в первом слайсе, API-интеграция отдельным инкрементом.

### Решение владельца от 17.08.2026

Все шесть рекомендаций утверждены как единая архитектурная граница первого слайса:

- `PublicationFact` — канонический источник;
- вводится `ba_record_publication_fact`, старый confirm остаётся адаптером совместимости;
- story T+24h планируется на `published_at + 23h`;
- dual-write legacy-полей сохраняется один стабильный релиз после UAT;
- автоматический адаптер первого слайса — существующий VK, остальные checkpoints ручные;
- UTM-визиты первого слайса вводятся вручную.

Реализация выполняется одним delivery-проходом с TDPD-005. Инварианты WPI защищают `PublicationFact`, snapshots и остальной runtime от delta-импорта.

## 16. Gate status

- Business problem gate: **PASS** — подтверждён недельным разбором 10–16.08.
- Specification gate: **PASS**.
- Input gate: **PASS** — архитектурные решения утверждены владельцем 17.08.2026.
- Red gate: **PASS** — acceptance-набор подтвердил отсутствие канонического факта до реализации.
- Green gate: **PASS** — 66/66 DB-backed TDPD-сценариев и 58/58 backend-регрессий.
- Output/UAT gate: **READY FOR OWNER ACCEPTANCE** — локально подтверждены карточка факта, T+24/T+7 и ручной снимок с observed zero/unknown; визуальные доказательства сохранены рядом со спекой.

Production deployment остаётся отдельным решением владельца после UAT.
