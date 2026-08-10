# Implementation Brief: TDPD-001 / Red Gate A → Green

Статус: approved implementation packet  
Адресат: кодирующий агент  
Владелец спецификации, тестов и приёмки: основной агент Codex  
Дата: 2026-08-09

## 1. Задача кодирующего агента

Сделать минимальную production-реализацию MCP-очереди двухпроходного недельного контент-производства, которая переводит утверждённые тесты Red Gate A из red в green.

Кодирующий агент реализует код, но не принимает продуктовые, архитектурные и тестовые решения.

Источники истины в порядке приоритета:

1. `docs/tdpd/001-mcp-weekly-production-spec-ru.md`;
2. `tests/tdpd/work-queue-mcp.e2e.test.js`;
3. этот implementation brief;
4. существующие безопасные паттерны проекта.

Если источники противоречат друг другу, остановиться и сообщить точный конфликт. Не менять тест или трактовку молча.

## 2. Разделение ответственности

### Кодирующий агент может

- изменять production-код, Prisma schema и миграции в пределах TDPD-001;
- добавлять внутренние unit/integration tests только для диагностики реализации;
- запускать утверждённые проверки;
- сообщать о найденной неоднозначности или техническом блокере.

### Кодирующий агент не может

- менять `tests/tdpd/work-queue-mcp.e2e.test.js`;
- ослаблять assertions, пропускать сценарии или подменять e2e mocks;
- менять продуктовые требования или MCP-контракт;
- расширять реализацию на автопостинг, изображения, кампании, метрики или UI;
- смешивать производственный workflow с `ContentItem.status`;
- использовать рабочую/production-базу для test fixtures;
- коммитить секреты, `.env`, DB dumps, generated logs или `.DS_Store`;
- объявлять TDPD-задачу завершённой: Green Gate подтверждает основной агент, UAT — владелец продукта.

## 3. Точный scope Red Gate A

Обязательные сценарии:

- E2E-001 / SC-001 — одобренный недельный план создаёт объяснимую очередь;
- E2E-002 / SC-002 — просроченная доступная работа сортируется первой;
- E2E-003 / SC-003 — claim → context → complete создаёт одну версию и открывает review;
- E2E-006 / SC-006 — одобрение связано с актуальной версией результата;
- E2E-009 / SC-009 — недоступный host-only источник блокирует работу объяснимо;
- E2E-010 / SC-010 — просрочка контента не смешивается с пропущенной публикацией;
- E2E-014 / SC-014 — актор другого проекта не читает и не изменяет работу.

Не реализовывать в этом цикле сценарии второго red-пакета: конкурентный claim, автоматическое восстановление истёкшего lease, reject/rewrite, stale approval, reschedule и расширенную идемпотентность. Архитектура не должна закрывать путь к ним.

## 4. Архитектурная граница

### ContentItem

Остаётся контентным артефактом и источником публикационных данных:

- `item_key`;
- тема, канал и формат;
- `content_due_at`;
- `publish_at`/существующий publication schedule;
- source refs;
- текущий текст и существующие publication-поля.

Не переносить MCP lease, approval history или audit events в JSON-поля `assets`, `metrics` или `quality_report`.

### WorkItem

Отдельная исполнимая работа:

- связь с project, WeekPackage и ContentItem;
- `kind`: минимум `content_write`, `content_review`; `plan_review` допустим только если реально используется;
- `state`: `pending`, `available`, `claimed`, `waiting_approval`, `blocked`, `completed`, `cancelled`;
- role, due_at, lease, context/result versions;
- reason code и missing resource refs.

### ApprovalDecision

Неизменяемое решение, привязанное к `work_item_id` и `result_version`.

### WorkflowEvent

Атомарный audit record для изменяющих команд. Не сохранять secrets, lease token целиком, тексты credential-полей или provider/channel config.

### Schedule projection

`schedule_health`, `is_overdue`, `overdue_seconds`, `reason_code` и `next_action` вычисляются на чтении с использованием `asOf` либо серверного времени. Не сохранять `overdue` как ручной статус.

## 5. Обязательная модель данных

Изменения должны поставляться Prisma migration, а не только правкой `schema.prisma`.

### Additive migration

- новые nullable-поля `ContentItem` для `item_key`, `content_due_at`, `publish_at`, source refs;
- новые таблицы `work_items`, `approval_decisions`, `workflow_events`;
- новые relations в `Project`, `WeekPackage`, `ContentItem`;
- индексы очереди по project/state/kind/due_at;
- внешние ключи с безопасной политикой удаления;
- ограничения идемпотентности и версий.

### Минимальные DB-инварианты

- один логический `content_write` и один `content_review` на ContentItem в рамках первой версии workflow;
- не более одного активного lease на WorkItem;
- `result_version >= 0`;
- ApprovalDecision не может существовать без WorkItem;
- идемпотентность scoped как минимум по project + actor + command + key, а не по непроверенному глобальному совпадению строки;
- повторный импорт одного `item_key` не создаёт второй комплект работ;
- удаление проекта каскадно удаляет workflow-данные;
- удаление/отвязка ContentItem не оставляет WorkItem, который можно выполнить без контекста.

Если Prisma не выражает частичный unique index для активного lease, атомарность обеспечивается транзакционным conditional update и проверяется integration test. Не имитировать гарантию предварительным `findFirst` без защиты от гонки.

### Rollback

Миграция должна быть аддитивной и не менять существующие публикационные данные. Rollback-план:

1. отключить регистрацию новых MCP tools;
2. остановить создание WorkItem при импорте;
3. удалить новые relations/tables/nullable columns отдельной обратной миграцией только после подтверждения отсутствия нужных workflow-данных.

Не выполнять автоматический destructive rollback.

## 6. Импорт недельного плана

Расширить существующий `publication_plan.service`, не создавать второй импортёр.

Для каждого action:

1. нормализовать `item_key` с fallback на `action.id`;
2. сохранить `content_due_at` и публикационный timestamp отдельно;
3. сохранить source refs в структурированном поле;
4. upsert ContentItem по стабильной идентичности плана и `item_key`;
5. создать или переиспользовать `content_write` и `content_review`;
6. определить доступность источников без блокирующего чтения host-only path;
7. вернуть `project.id` и `week_package.id`.

### Состояния после импорта

- недельный пакет ожидает явного решения `ba_decide_week_plan`;
- write с полным inline/URL/snapshot-контекстом после approve становится `available`;
- write с недоступным локальным source становится `blocked` с `SOURCE_UNAVAILABLE` и точным `missing_resource_refs`;
- review остаётся `pending` до успешного completion связанного write.

### Совместимость delta-safe

- повторный импорт не создаёт дубли;
- completed/claimed workflow не сбрасывается;
- сохранённая версия результата не переписывается входным планом;
- существующие legacy публикационные задачи продолжают работать;
- текущие runtime-locked статусы сохраняют прежнюю защиту.

## 7. MCP-команды Red Gate A

Зарегистрировать и реализовать ровно контракт спеки и тестов:

- `ba_decide_week_plan`;
- `ba_get_week_execution_summary`;
- `ba_list_work_items`;
- `ba_get_work_item`;
- `ba_get_work_item_context`;
- `ba_claim_work_item`;
- `ba_complete_work_item`;
- `ba_decide_approval`;
- `ba_list_schedule_exceptions`.

Дополнительные команды `block`, `release`, `reschedule` можно зарегистрировать только если они уже нужны внутренней целостности, но их полное поведение не является Green Gate A.

### Ответы

- возвращать `structuredContent`, а не только текст;
- использовать названия полей из e2e-тестов;
- даты возвращать ISO 8601 UTC;
- ошибки должны быть машинно различимы;
- не раскрывать existence/context чужого проекта;
- `asOf` поддерживать для детерминированной проверки времени.

## 8. Сервисные правила

Рекомендуемая граница: отдельный `work_queue.service.ts`, вызываемый MCP adapter. MCP registration валидирует форму входа, сервис отвечает за authorization, business rules и транзакции.

### ba_decide_week_plan

- проверить project membership;
- проверить принадлежность WeekPackage проекту;
- проверить version;
- атомарно сохранить решение и разблокировать допустимые write items;
- blocked sources оставить blocked;
- повтор с тем же idempotency key вернуть исходный результат.

### ba_list_work_items

- фильтровать только внутри доступного проекта;
- учитывать истёкший lease как доступный projection, не обязательно мутируя запись в Red Gate A;
- сортировать `overdue` → `due_at` → priority → stable ID;
- вернуть schedule projection и next action.

### ba_claim_work_item

- разрешать только `available` либо истёкший claim;
- выполнять conditional update атомарно;
- вернуть непрозрачный криптографически случайный lease token;
- хранить token в виде hash, если это не ломает минимальную реализацию; как минимум не логировать его;
- ограничить `leaseSeconds` диапазоном 60–3600, default 1800.

### ba_get_work_item_context

- возвращать week frame, item metadata и разрешённые resources;
- соблюдать `maxChars` и явно помечать truncation;
- inline snapshot и HTTP/HTTPS URL являются допустимым контекстом;
- недоступный path не читать бесконечно и не выдавать пустой успешный context.

### ba_complete_work_item

- проверить project, actor и действующий lease token;
- work item должен быть claimed и lease не истёк;
- создать новую неизменяемую result version;
- сохранить body как канонический текущий draft ContentItem;
- завершить write и открыть review в одной транзакции;
- повтор с тем же key не создаёт вторую версию.

### ba_decide_approval

- проверить project membership и роль reviewer/editor;
- принимать решение только для актуальной версии;
- approved завершает review;
- immutable ApprovalDecision и audit event создаются атомарно;
- rejected относится к Red Gate B, но не должен молча вести себя как approved.

### ba_list_schedule_exceptions

- до publish_at возвращать `content_overdue`, если content_due_at прошёл;
- после publish_at для неопубликованного материала добавлять `publication_missed`;
- blocked source остаётся видимым с `SOURCE_UNAVAILABLE`;
- блокировка и просрочка могут сосуществовать;
- граница: `now == due_at` ещё не overdue, `now > due_at` — overdue.

## 9. Авторизация и threat boundary

### Обязательно сейчас

- из `actorId: user:<id>` получить user ID только после строгой валидации формата;
- каждый read/write проверяет membership проекта;
- owner/editor может изменять workflow; viewer только читает;
- проверять, что WorkItem и WeekPackage принадлежат переданному projectId;
- ошибки чужого проекта не содержат topic, source, item_key или другие защищённые данные;
- не возвращать channel/provider secrets.

### Ограничение текущего MCP

В stdio-контуре caller считается доверенным и самостоятельно передаёт actorId. Это даёт project-level guardrails, но не криптографическую идентификацию пользователя: caller может подставить другой `user:<id>`.

Для remote MCP actor должен выводиться из аутентифицированного transport principal, а не приниматься из payload. Не объявлять remote authorization production-ready в рамках TDPD-001.

Это hard stop перед публичным или многопользовательским remote deployment, но не блокирует локальный trusted-stdio Green Gate A.

## 10. Транзакции и идемпотентность

Следующие операции атомарны вместе с audit event:

- approve/reject week plan;
- claim;
- complete write + result version + unlock review;
- approval decision + completion review.

Идемпотентный replay возвращает тот же публичный результат команды. Нельзя реализовать replay как поиск любого события по одному idempotency key без проверки project, actor и command.

При ошибке внутри транзакции не должно оставаться частичного result payload, version increment, approval или state transition.

## 11. Порядок реализации для кодирующего агента

1. Зафиксировать текущий red output без изменения теста.
2. Добавить Prisma schema и именованную migration.
3. Проверить migration на отдельной тестовой PostgreSQL-базе.
4. Расширить publication-plan normalization/import.
5. Реализовать service read projections и authorization.
6. Реализовать атомарные commands.
7. Зарегистрировать MCP tools.
8. Запустить Red Gate A с отдельной test DB и двумя test users.
9. Добавить узкие unit/integration tests для time boundary, ordering, transaction/idempotency и access checks.
10. Запустить broader backend regression.
11. Передать diff и evidence основному агенту, не объявляя UAT completion.

## 12. Тестовое окружение

Не использовать `.env` DATABASE_URL для TDPD fixtures.

Обязательные переменные:

- `TDPD_TEST_DATABASE_URL` — отдельная disposable PostgreSQL database;
- `TDPD_TEST_USER_ID` — owner/editor fixture;
- `TDPD_TEST_OTHER_USER_ID` — пользователь без membership целевого проекта.

Перед green-run применить миграции к этой базе и убедиться, что оба user fixtures существуют. Тестовый план создаёт уникальный project; cleanup должен архивировать или удалять только проект с известным test identifier. Не использовать широкие delete/truncate.

## 13. Обязательные проверки перед handoff

```bash
npm run build:backend
node scripts/test_mcp_server.js --skip-db
TDPD_TEST_DATABASE_URL=... TDPD_TEST_USER_ID=... TDPD_TEST_OTHER_USER_ID=... npm run test:tdpd:red
node --test dist/tests/publication_runtime.helpers.test.js
node --test dist/tests/publication_plan_import.test.js
```

Дополнительно запустить все backend tests, если они не требуют реальных внешних API/Redis. Не скрывать unrelated failures; разделить их на relevant и pre-existing с доказательством.

## 14. Формат handoff от кодирующего агента

Кодирующий агент возвращает:

1. список изменённых production-файлов;
2. имя и назначение migration;
3. mapping `E2E ID → implementation evidence`;
4. точные команды и результаты тестов;
5. известные ограничения;
6. security/authorization note;
7. rollback note;
8. все отклонения от brief — только как запрос решения, не как свершившийся факт.

## 15. Green Gate review основного агента

Основной агент отдельно проверит:

- тесты не изменены и не ослаблены;
- migration существует и совместима;
- все изменяющие операции авторизованы и атомарны;
- idempotency scoped корректно;
- нет secret leakage;
- Red Gate A зелёный на отдельной test DB;
- существующие publication/import сценарии не сломаны;
- generated `dist` соответствует принятой в репозитории политике;
- UI-файл `frontend/src/pages/PublicationTasks.tsx` не был случайно перезаписан;
- TDPD-статус остаётся «engineering complete, awaiting UAT» до решения владельца.

## 16. Текущее состояние рабочего дерева

На момент подготовки brief в shared workspace уже присутствует незавершённая реализация `work_queue.service.ts`, изменения Prisma и регистрации MCP, вероятно созданные кодирующим агентом параллельно. Считать их draft, а не подтверждённой реализацией.

Кодирующий агент должен сверить текущий draft с этим brief и red-тестами, добавить отсутствующую migration и устранить расхождения. Основной агент не принимает текущий draft без полного Green Gate review.
