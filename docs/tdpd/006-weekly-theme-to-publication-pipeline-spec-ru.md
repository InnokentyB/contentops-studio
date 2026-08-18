# TDPD-006: воскресная тема → семь проверенных публикаций

Статус: Slice A engineering complete, awaiting Human UAT
Режим: TDPD Plan
Метод: Test-Driven Product Development (TDPD), оригинальный метод Иннокентия Бодрова
Версия: 0.1
Дата: 2026-08-18
Пилот: Telegram-канал `@analysts_thinking`, planner project `10`

## 1. Результат одной строкой

Владелец передаёт планеру одну принятую воскресную тему, получает на утверждение семь тем постов на понедельник–воскресенье, после утверждения система проводит каждый материал через написание, anti-slop, главреда, генерацию изображения и публикацию без ручного переноса текста между чатами.

## 2. Бизнес-проблема

`@analysts_thinking` должен работать как автоматический тематический канал, но текущий планер хранит воскресную тему как обычный публикационный слот. Он не знает, что этот материал является входом для следующей недели, не создаёт из него семь предложений тем и не проводит производные материалы через обязательные проверки.

Фактическое состояние проекта 10 на 18.08.2026:

- у канала `analysts_thinking_tg` поле `week_theme_source` равно `null`;
- в недельном пакете W11 есть `0 content_write` и `0 content_review` WorkItem;
- активных service identity bindings нет;
- `/mcp/writer` описан, но не подключён к work queue;
- общий `content_review` не различает anti-slop и главреда;
- `ba_generate_image_asset` создаёт только запись с промптом и статусом, но не вызывает модель и не сохраняет файл/URL;
- `auto_canvas_generation` для канала выключен;
- dry-run публикации в Telegram-канал `111` проходит успешно.

Из-за этого владелец вручную переносит тему, темы постов, тексты, результаты проверок и изображения между чатами. Пропуск воскресного якоря обнаруживается только после того, как часть недели уже собрана.

## 3. Цель и сигналы успеха

### Цель

Сделать один наблюдаемый и возобновляемый pipeline:

```text
принятая воскресная тема
→ preview семи тем
→ утверждение недельного плана
→ семь текстов
→ anti-slop
→ главред
→ изображения
→ расписание
→ публикация
→ publication fact
```

### Сигналы успеха пилота

- из одной принятой темы создаётся ровно семь предложений, по одному на каждый день следующей недели;
- владелец утверждает или отклоняет весь preview одной версионированной операцией;
- до утверждения preview не создаются задания на написание и публикацию;
- 100% готовых текстов имеют два отдельных принятых отчёта: anti-slop и главред;
- публикация не может выйти с неутверждённой версией текста или без требуемого изображения;
- повтор команды или retry не создаёт второй материал, второй asset или вторую публикацию;
- все семь выходов видны в планере с источником темы, состоянием текущего этапа и причиной блокировки;
- ручная работа владельца на регулярную неделю — не более 15 минут: передать тему и утвердить preview/исключения.

## 4. Акторы и границы прав

| Актор | Отвечает за | Не может |
|---|---|---|
| Владелец / Штаб | тема, утверждение семи тем, исключения, UAT | незаметно обходить audit trail |
| `/mcp/planner` | тема, слоты, даты, preview, решение по недельному плану | менять тело публикации, публиковать напрямую |
| `/mcp/writer` | читать задание и источники, claim/complete написание | менять канал, тему, дату и режим публикации |
| Anti-slop reviewer | проверять актуальную версию текста и возвращать структурированный отчёт | менять слот или одобрять устаревшую версию |
| Chief editor | проводить смысловую и терминологическую приёмку актуальной версии | пропускать anti-slop gate |
| Visual worker | создать реальный asset по принятому тексту и визуальному контракту | менять текст и расписание |
| Delivery worker | доставить только полностью готовую версию в назначенный канал | публиковать до завершения обязательных gate |

Transport principal определяет project и actor. Caller не может расширить права через переданный `projectId`, `actorId` или `userId`.

## 5. Scope

### MVP пилота

- одна воскресная тема для одной следующей недели;
- ровно семь Telegram-публикаций, понедельник–воскресенье;
- preview семи тем до создания производственных WorkItem;
- одно решение владельца по версии preview;
- автоматическое создание `content_write` после approve;
- последовательные `anti_slop_review` и `chief_editor_review`;
- реальная генерация одного изображения на материал;
- ручное одобрение изображения во время пилота;
- постановка в расписание только после всех gate;
- автоматическая Telegram-доставка и canonical publication fact;
- retries, идемпотентность, аудит и наблюдаемые блокировки.

### Не входит

- адаптация одной темы на другие каналы;
- генерация нескольких визуальных вариантов;
- автоматическая оценка художественного вкуса;
- сбор T+24h/T+7d метрик — используется существующий контур;
- изменение стратегии или выбор темы без входа от Штаба;
- публикация недели без явного owner approval;
- ретроактивное восстановление пропущенной воскресной темы.

## 6. Архитектурные решения

### ADR-006-01: тема — версионированный upstream-артефакт

Воскресная тема хранится как `ContentItem` с типом `week_theme`. Следующий `WeekPackage` содержит ссылку `theme_source_content_item_id` и `theme_source_revision`.

Производные темы всегда указывают:

- `theme_source_content_item_id`;
- `theme_source_revision`;
- `day_index` от 1 до 7;
- `publish_at` в timezone пакета;
- функцию материала и краткое обоснование отличия от соседних дней.

Изменение принятой темы не переписывает существующий preview молча. Система создаёт новую версию плана и требует повторного решения владельца.

### ADR-006-02: preview не является опубликованным планом

Генерация семи тем создаёт proposal-версию внутри следующего `WeekPackage`. До `ba_decide_week_plan(approved)`:

- слоты не считаются утверждёнными;
- `content_write` не доступен;
- image и delivery WorkItem не создаются;
- UI явно показывает `awaiting_plan_approval`.

### ADR-006-03: один pipeline, отдельные WorkItem

Не создавать второй workflow рядом с TDPD-001. Расширить `WorkItem.kind`:

- `week_topic_generate`;
- `plan_review`;
- `content_write`;
- `anti_slop_review`;
- `chief_editor_review`;
- `image_generate`;
- `image_review`;
- `delivery`.

Каждый следующий этап открывается только после успешного завершения предыдущего для той же актуальной версии текста/asset.

### ADR-006-04: проверки привязаны к версии текста

Каждый review хранит:

- `content_revision`;
- `reviewer_kind`;
- `decision`;
- структурированный report;
- findings с severity;
- timestamp и actor;
- при отклонении — обязательный комментарий.

Любое изменение тела увеличивает `content_revision` и инвалидирует принятые downstream review для предыдущей версии. Устаревшее решение возвращает `STALE_CONTENT_REVISION`.

### ADR-006-05: image asset должен быть реальным

`image_generate` считается завершённым только если сохранены:

- стабильный storage URL или planner upload path;
- MIME type, размер и checksum;
- provider/model/prompt/prompt_version/seed;
- aspect ratio и alt text;
- связь с `content_item_id` и `content_revision`;
- состояние `candidate`.

Запись промпта без файла не считается генерацией и возвращает `IMAGE_BINARY_MISSING`.

### ADR-006-06: публикация использует снапшот принятой версии

Delivery payload фиксирует `content_revision` и `image_asset_version`. После постановки в delivery изменения текста или изображения переводят delivery в `stale` и требуют повторной подготовки. Delivery не читает «последнее значение» в момент отправки.

## 7. Пользовательский путь

1. До субботы 18:00 Штаб создаёт или обновляет воскресную тему.
2. Штаб принимает её версию.
3. Планер связывает тему с пакетом понедельник–воскресенье.
4. Планировщик запрашивает preview семи тем.
5. Планер возвращает один отчёт: тема недели, семь дней, тезис каждого дня, источник, риск повторения и предложенное время.
6. Владелец утверждает либо отклоняет preview целиком.
7. После approve создаются семь `content_write`.
8. Writer последовательно claim/complete каждое задание.
9. Для актуальной версии запускается anti-slop review.
10. При reject текст возвращается writer с findings; при approve открывается chief editor review.
11. Главред принимает или возвращает текст на переписывание.
12. После двух approve создаётся image generation.
13. Реальный image asset сохраняется и во время пилота утверждается владельцем.
14. Планер фиксирует текст, изображение и слот в delivery snapshot.
15. В `publish_at` delivery worker публикует материал один раз.
16. Планер записывает provider object ID, permalink, время, outcome и версию payload.

## 8. MCP-контракт

Названия предварительные; поведение и границы обязательны.

### Planner profile

#### `ba_upsert_week_theme`

Вход: project, target week, title/body, source refs, expected revision, idempotency key.
Выход: `theme_content_item_id`, `theme_revision`, состояние и target package.

#### `ba_generate_week_topic_preview`

Вход: project, week package, theme item/revision, timezone, schedule template, idempotency key.
Выход: `plan_version`, ровно семь proposals и warnings.
Команда не создаёт `content_write` и не публикует ничего.

#### `ba_decide_week_plan`

Существующую команду добавить в allowlist `/mcp/planner`. Решение применяется только к актуальной `plan_version`.

#### `ba_get_week_pipeline`

Возвращает для семи дней текущий этап, версии текста/изображения, gate decisions, расписание, блокировку и next action.

### Writer profile

Добавить в allowlist `/mcp/writer`:

- `ba_list_work_items` только для `content_write`;
- `ba_claim_work_item`;
- `ba_get_work_item_context`;
- `ba_complete_work_item`;
- `ba_block_work_item`;
- `ba_release_work_item`.

Writer остаётся неспособен менять slot shell. `ba_update_publication_content` сохраняется для ручной правки с optimistic concurrency, но такая правка создаёт новую revision и инвалидирует downstream gate.

### Reviewer/visual/delivery identities

Можно использовать owner endpoint на первом пилоте, но service identity bindings обязательны. Предпочтительно добавить отдельные capability profiles либо worker credentials с минимальными scope.

## 9. Детерминированные требования

- **R-006-001.** Одна принятая тема может быть активным источником только одной версии конкретного недельного пакета.
- **R-006-002.** Preview содержит ровно семь уникальных локальных дат от понедельника до воскресенья без пропусков и дублей.
- **R-006-003.** Каждый proposal содержит тезис, функцию, источник, отличие от соседних тем и `publish_at`.
- **R-006-004.** Preview не создаёт производственных WorkItem до approve.
- **R-006-005.** Approve актуальной версии создаёт ровно семь `content_write`; retry не создаёт дубли.
- **R-006-006.** Reject не создаёт write/image/delivery и сохраняет комментарий.
- **R-006-007.** Пропущенная, непринятая или опоздавшая тема блокирует автоматическую сборку с машинной причиной.
- **R-006-008.** Writer получает только назначенный проект и полный разрешённый контекст.
- **R-006-009.** Завершение текста открывает anti-slop, а не общий review и не image generation.
- **R-006-010.** Chief editor недоступен до approve anti-slop на той же revision.
- **R-006-011.** Изменение тела после любой проверки инвалидирует проверки старой revision.
- **R-006-012.** Chief editor approve создаёт один `image_generate`.
- **R-006-013.** Image generation сохраняет реальный файл/URL и provenance; metadata-only результат отклоняется.
- **R-006-014.** Во время пилота delivery блокируется до approve image asset.
- **R-006-015.** Delivery snapshot использует принятые content/image versions и не подменяет их latest-значениями.
- **R-006-016.** Публикация выполняется не более одного раза на logical delivery key.
- **R-006-017.** Успех публикации создаёт canonical publication fact; ошибка сохраняет attempt и допускает безопасный retry.
- **R-006-018.** `/mcp/planner` не может менять body; `/mcp/writer` не может менять тему, канал, schedule или publish.
- **R-006-019.** Все mutating operations создают WorkflowEvent и требуют idempotency key.
- **R-006-020.** Legacy/imported publication tasks продолжают работать без миграции в новый pipeline до явного включения feature flag.

## 10. Ошибки и восстановление

| Ситуация | Поведение |
|---|---|
| Тема не принята до дедлайна | пакет `blocked`, код `WEEK_THEME_NOT_APPROVED`; публикации не создаются |
| Generator вернул не семь дней | весь preview отклонён, `INVALID_WEEK_TOPIC_COUNT` |
| Два дня имеют одну локальную дату | preview отклонён, `DUPLICATE_LOCAL_DAY` |
| Повтор generation с тем же key | возвращается исходный preview |
| Тема изменилась после preview | preview `stale`; approve запрещён |
| Writer потерял lease | результат не принимается; задание возвращается в очередь |
| Reviewer решает по старой revision | `STALE_CONTENT_REVISION`, состояние не меняется |
| Anti-slop или главред отклонил | новая попытка write с findings; старый текст сохраняется в истории |
| Provider картинки недоступен | `image_generate` retryable; delivery остаётся blocked |
| Получены metadata без файла | `IMAGE_BINARY_MISSING`; candidate не создаётся |
| Публикация упала после remote success | reconciliation по provider object ID до retry |
| Retry после успешной публикации | возвращается существующий publication fact, второй пост не создаётся |

## 11. E2E-сценарии Red Gate

| ID | Сценарий | Наблюдаемый критерий |
|---|---|---|
| E2E-006-001 | Принятая тема создаёт preview | семь уникальных дней, одна plan version, ноль write items |
| E2E-006-002 | Повтор generation идемпотентен | те же IDs/version, дублей нет |
| E2E-006-003 | Тема изменилась до approve | старый preview нельзя утвердить |
| E2E-006-004 | Владелец отклоняет preview | комментарий сохранён, write/image/delivery отсутствуют |
| E2E-006-005 | Владелец утверждает preview | создаётся ровно семь доступных `content_write` |
| E2E-006-006 | Непривязанный writer пытается claim | access denied без утечки контекста |
| E2E-006-007 | Writer завершает текст | создаётся anti-slop review актуальной revision |
| E2E-006-008 | Anti-slop reject | новый write с findings, chief editor не открыт |
| E2E-006-009 | Anti-slop approve | открывается chief editor для той же revision |
| E2E-006-010 | Главред решает по старой версии | решение отклонено, актуальная версия не меняется |
| E2E-006-011 | Два review приняты | создаётся один image generation work item |
| E2E-006-012 | Реальная картинка создана | есть доступный URL/path, checksum и provenance |
| E2E-006-013 | Provider вернул только metadata | image gate не проходит |
| E2E-006-014 | Изображение принято | создаётся delivery snapshot с точными версиями |
| E2E-006-015 | Telegram delivery успешен | один remote post и один publication fact |
| E2E-006-016 | Retry после ambiguous failure | reconciliation не допускает двойную публикацию |
| E2E-006-017 | Воскресная тема отсутствует | недельная сборка blocked с точной причиной |
| E2E-006-018 | Проверка capability profiles | planner не меняет body, writer не меняет shell/publish |
| E2E-006-019 | Legacy-задача вне feature flag | поведение legacy-задачи не изменилось |

Red Gate считается честным, если тесты падают из-за отсутствующих topic generation, двух review gate, реального image output или оркестрации, а не из-за сломанной test DB.

## 12. Human UAT

Владелец выполняет один реальный цикл для `@analysts_thinking`:

1. Передаёт воскресную тему.
2. Получает семь различимых тем и проверяет, что они действительно развивают одну ось, а не повторяют один тезис.
3. Отклоняет preview с комментарием и убеждается, что публикационные задачи не появились.
4. Получает новую версию и утверждает её.
5. Проверяет один happy path до публикации.
6. На втором материале меняет текст после anti-slop и проверяет инвалидирование старого review.
7. На третьем имитирует ошибку image provider и безопасный retry.
8. Проверяет в UI семь дней, источники, gate, выбранные версии и permalink опубликованного материала.

Качество самих тем, текста и визуала остаётся человеческой UAT-оценкой. Зелёные e2e не доказывают редакторскую ценность.

## 13. Миграция и rollout

### Slice A — тема и недельный preview

- additive fields/relations для theme source и revision;
- preview endpoint и UI;
- plan approval через planner profile;
- E2E-006-001…005, 017, 018.

### Slice B — writer и два review gate

- service identity bindings для project 10;
- writer work-queue allowlist;
- `anti_slop_review` и `chief_editor_review`;
- revision invalidation и reports;
- E2E-006-006…011.

### Slice C — настоящий image pipeline

- provider adapter;
- storage/upload, checksum и provenance;
- image review;
- E2E-006-012…014.

### Slice D — delivery

- delivery snapshot;
- scheduled Telegram worker;
- reconciliation, idempotency и publication fact;
- E2E-006-015…016.

### Feature flag

`weekly_theme_pipeline_v1` включается только для project 10 и channel 111. Legacy/imported задачи не мигрируются автоматически. После двух недель без дублей, bypass gate и необъяснимых блокировок владелец решает, расширять ли pipeline.

### Rollback

- выключить feature flag;
- прекратить создание новых pipeline WorkItem;
- не удалять созданные темы, тексты, reviews, assets, delivery attempts и audit events;
- незавершённые публикации перевести в manual handoff;
- не выполнять destructive rollback данных.

## 14. Council check

- **Product/UX:** preview семи тем отделён от production; владелец принимает одно понятное решение до расходования ресурсов.
- **QA:** версии темы, текста и изображения входят в каждый gate; предусмотрены stale, retry, duplicate и partial-failure сценарии.
- **Architecture:** расширяется TDPD-001; второй workflow и параллельные статусы не создаются.
- **Security:** профили least privilege, project-bound principal, без caller-controlled расширения scope.
- **Operations:** feature flag на одном канале, безопасный manual fallback и неизменяемый audit trail.

## 15. Зависимости

- `docs/tdpd/001-mcp-weekly-production-spec-ru.md`;
- существующие WeekPackage, ContentItem, WorkItem, ApprovalDecision и WorkflowEvent;
- Telegram channel `111` и delivery adapter;
- image provider credentials и planner-owned storage;
- MCP remote profiles `/mcp/planner` и `/mcp/writer`;
- текущие publication fact и metric checkpoint механизмы.

## 16. Решения владельца перед Red Gate

Рекомендуемые значения для пилота, если владелец не изменит их:

1. Окно недели: понедельник–воскресенье, `Europe/Lisbon`.
2. Воскресная тема готова до субботы 18:00 и публикуется в воскресенье в 12:00.
3. Семь производных постов выходят ежедневно в 12:00; время остаётся настраиваемым шаблоном.
4. Preview утверждается целиком; редактирование одной темы создаёт новую plan version.
5. Изображение обязательно для всех семи публикаций и вручную утверждается в пилоте.
6. Anti-slop и главред являются двумя независимыми gate; пропуск запрещён.
7. После двух успешных недель отдельно решается автоматическое одобрение изображений.

### Решение владельца от 18.08.2026

Все семь рекомендуемых настроек приняты без изменений. Для исполняемых acceptance-тестов
генератор тем подменяется детерминированным fake-adapter через тестовое окружение; production
provider этим решением не определяется. Автоматические тесты проверяют структуру, даты,
версии, состояния, права и идемпотентность. Различимость и редакторская ценность семи тем
остаются Human UAT.

### Матрица RED Slice A

| Требование | Acceptance test | Приоритет | Уровень |
|---|---|---|---|
| R-006-001…004 | E2E-006-001: accepted theme → семь proposals, ноль production WorkItem | must-have | MCP + DB |
| R-006-002, 003 | E2E-006-001: Mon–Sun, уникальные local dates, thesis/function/source/difference/publish_at | must-have | MCP + DB |
| R-006-005, 019 | E2E-006-002/005: generation и approve replay не дублируют preview/write/audit | must-have | MCP + DB |
| R-006-001 | E2E-006-003: новая revision делает старый preview stale | must-have | MCP + DB |
| R-006-006 | E2E-006-004: reject сохраняет комментарий, production queue пуста | must-have | MCP + DB |
| R-006-007 | E2E-006-017: missing/unapproved/late theme блокирует сборку точным reason code | must-have | MCP + DB |
| R-006-018 | E2E-006-018: planner/writer capability profiles соблюдают least privilege | must-have | contract |
| R-006-020 | E2E-006-019: legacy task вне feature flag не меняется | should-have | MCP + DB |

## 17. Gate status

- Input Gate: **PASS** — семь настроек пилота утверждены владельцем 18.08.2026.
- Red Gate: **PASS** — 7/7 сценариев Slice A исполняются и честно падают на отсутствующих MCP-контрактах `ba_upsert_week_theme`, `ba_generate_week_topic_preview`, `ba_get_week_pipeline` и capability planner для `ba_upsert_week_theme`; test DB и MCP-транспорт работают.
- Green Gate: **PASS** — 7/7 Slice A acceptance-сценариев, 73/73 полных DB-backed TDPD-сценариев в последовательном режиме и 58/58 backend-регрессий проходят. Параллельный DB-runner заменён на последовательный: девять suite на одной test DB вызывали ложные 5-секундные transaction timeout.
- Output Gate / UAT: **не начат**.

Базовая регрессия перед Green: `npm test` — **58/58 PASS** (18.08.2026).
