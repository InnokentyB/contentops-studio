# TDPD-007: единый Intelligence Hub организации → маршрутизация сигналов в проекты

Статус: Implementation / Input Gate PASS / Surface Gate PASS / production source smoke pending
Режим: TDPD Plan + Red
Метод: Test-Driven Product Development (TDPD), оригинальный метод Иннокентия Бодрова
Версия: 0.1
Дата: 2026-09-11

## 1. Результат одной строкой

Исследователь организации одним MCP-запросом ищет статьи, посты и комментарии сразу по нескольким общим источникам, получает одну дедуплицированную базу сигналов с отдельной оценкой применимости к каждому проекту и осознанно направляет выбранный сигнал в проект, не получая права публиковать или отвечать от имени этого проекта.

## 2. Бизнес-проблема

Сейчас исследования в Planner изолированы по проектам:

- parser API и UI требуют `projectId`;
- parser workspace вычисляется из проекта;
- MCP parser tools создают отдельный search job внутри проекта;
- один и тот же материал может быть найден и сохранён несколько раз;
- критерии проектов, общие источники и результаты не видны как портфель организации;
- поисковые подключения рискуют смешаться с аккаунтами, которые имеют право комментировать или публиковать.

Из-за этого агент повторяет поиск для каждого проекта, результаты фрагментируются, а перенос полезной находки в инициативу, кампанию или контент выполняется вручную.

## 3. Акторы и ожидаемый эффект

| Актор | Задача | Ограничение |
|---|---|---|
| Владелец организации | Управляет организацией, общими источниками и полномочиями | Не должен вручную переносить одинаковые сигналы между проектами |
| Исследователь организации | Запускает поиск, оценивает доказательства, предлагает маршрутизацию | Не может комментировать и публиковать от имени проектов |
| Владелец проекта | Настраивает project research profile и принимает сигнал в работу | Не получает секреты общих источников |
| Проектный агент | Видит направленные в его проект сигналы и использует их как источник | Не видит не направленные сигналы и чужие проекты |
| Source adapter | Выполняет read/search по одному источнику | Не получает project publication identity |

### Сигналы успеха MVP

- один вызов MCP создаёт один `ResearchRun` и fan-out по выбранным источникам;
- один внешний объект хранится как один `SourceSignal` внутри организации;
- один сигнал может иметь разные fit scores и решения для разных проектов;
- повтор команды с тем же ключом не создаёт второй run или сигнал;
- изменение project profile пересчитывает оценки существующих сигналов без нового внешнего поиска;
- поиск может завершиться `partial`, сохранив результаты доступных источников;
- направление сигнала не создаёт публикацию или инициативу без отдельной команды;
- ни один organization research credential не используется для комментария или публикации;
- исследователь выполняет регулярный поиск без цикла MCP-вызовов по каждому проекту.

## 4. Reliance-and-harm preflight

Уровень зависимости: средний. Система влияет на продуктовые и редакционные решения, но не должна принимать их автоматически.

Риски:

- ошибочная релевантность создаёт шум, но обратима;
- потеря provenance делает сигнал недоказуемым;
- смешение search и representational credentials может привести к публикации от неверного бренда;
- prompt injection внутри найденного текста может повлиять на агента;
- удаление или изменение внешнего материала может разрушить последующую проверку.

Обязательные меры:

- найденный контент всегда маркируется как внешние недоверенные данные;
- source URL, provider object ID, timestamps и snapshot hash сохраняются;
- fit score является рекомендацией, а не решением о публикации;
- representational action требует отдельной project-bound authority;
- MVP не публикует и не комментирует автоматически.

## 5. Scope

### Входит в MVP

- организация и членство в ней;
- привязка нескольких проектов к одной организации;
- organization-scoped read/search connections;
- единый multi-source `ResearchRun`;
- нормализация и дедупликация `SourceSignal`;
- отдельный `ProjectSignalAssessment` для каждого подходящего проекта;
- ручное направление сигнала в project inbox;
- явное продвижение направленного сигнала в инициативу, исследовательскую задачу или тему публикации;
- organization researcher MCP profile;
- UI `/intelligence`: Inbox, Search, Runs, Sources, Project fit;
- audit trail, idempotency, partial failure и cross-organization isolation.

### Не входит

- автоматические комментарии и ответы;
- автоматическая публикация найденного материала;
- автоматическое создание кампании без решения владельца проекта;
- синхронная гарантия ответа от всех внешних источников;
- биллинг и квоты между организациями;
- семантический поиск по полному архиву внешнего интернета;
- доказательство качества реальной выдачи через deterministic adapter.

## 6. Архитектурная граница

### ADR-007-01: организация — канонический tenant верхнего уровня

Каждый активный проект принадлежит ровно одной `Organization`. Организационное членство и проектное членство независимы. Доступ к организации не даёт права менять проект, если это явно не разрешено ролью.

Существующие проекты мигрируются без изменения публикационных данных. Для проекта с одним однозначным owner создаётся/используется personal organization этого owner. Неоднозначная ownership-конфигурация блокируется для ручного mapping, а не объединяется автоматически.

### ADR-007-02: централизуется evidence, а не identity

`ResearchConnection` имеет capability allowlist. В MVP разрешены только `search`, `read`, `monitor`. Project `SocialChannel` и его credentials остаются отдельными и используются для `comment`, `publish`, `metrics` только через существующие project permissions.

Запрещено:

- копировать organization credential в `SocialChannel.config`;
- использовать search connection в publication adapter;
- считать наличие аккаунта источника разрешением отвечать от имени проекта.

### ADR-007-03: сигнал хранится один раз, применимость — много раз

Канонический `SourceSignal` принадлежит организации и не принадлежит одному проекту. Проектная применимость хранится отдельно как `ProjectSignalAssessment`.

Дедупликационный ключ:

1. `(organization_id, source_type, provider_object_id)`, если provider identity доступна;
2. иначе `(organization_id, source_type, normalized_url_hash)`;
3. текстовый similarity может предложить merge, но не объединяет записи автоматически в MVP.

### ADR-007-04: один MCP-вызов — один оркестрированный run

`ba_search_organization_intelligence` принимает organization scope, query, sources и project scope. Он создаёт один `ResearchRun`, а сервер сам создаёт source child runs и project assessments.

Вызов может:

- вернуть завершённый результат в пределах `waitMs`;
- либо вернуть `queued/running`, стабильный `researchRunId` и следующую read-команду.

Агент не обязан вызывать поиск отдельно для каждого проекта или источника.

### ADR-007-05: routing и promotion — разные события

`route` помещает сигнал в inbox проекта и фиксирует решение. Он не создаёт `ContentItem`, `Initiative`, `Campaign` или публикационную задачу.

`promote` — отдельная owner/editor-authorized команда с target type и idempotency key. Созданная сущность содержит provenance на `SourceSignal` и assessment revision.

### ADR-007-06: specialized UI — проекция канонического lifecycle

`/intelligence` не хранит собственные параллельные статусы. Он показывает канонические `ResearchRun`, `SourceSignal`, `ProjectSignalAssessment` и `ProjectSignalRoute`.

## 7. Модель данных

### `Organization`

- `id`, `name`, `slug`;
- `created_at`, `updated_at`;
- `is_archived`, `archived_at`.

### `OrganizationMember`

- `organization_id`, `user_id`;
- role: `owner | researcher | viewer`;
- unique `(organization_id, user_id)`.

### `ResearchConnection`

- `organization_id`, `source_type`, `name`;
- encrypted configuration;
- `capabilities[]`;
- `is_active`, `last_verified_at`, `last_error_code`;
- secret values никогда не возвращаются через API/MCP/UI.

### `ProjectResearchProfile`

- `project_id`, `revision`;
- audience, problems, themes, products, competitors;
- include/exclude terms;
- languages, geographies, source weights;
- `updated_by`, `updated_at`.

### `ResearchRun`

- `organization_id`, actor, query, normalized query;
- requested sources and project scope snapshot;
- status: `queued | running | partial | completed | failed`;
- child source outcomes;
- idempotency key unique within organization and actor;
- timestamps and counts.

### `SourceSignal`

- immutable source identity and canonical URL;
- title, excerpt/snapshot, author identity if public;
- source timestamps and observed timestamps;
- provenance, snapshot hash and access classification;
- normalized metadata and untrusted-content marker.

### `ProjectSignalAssessment`

- `signal_id`, `project_id`, `profile_revision`;
- fit score 0–100;
- reasons, matched dimensions, risks;
- state: `suggested | routed | dismissed`;
- assessment adapter/version and timestamp.

### `ProjectSignalRoute`

- `signal_id`, `project_id`, assessment revision;
- decision, actor, note, timestamps;
- unique active route per signal/project;
- optional promotion reference after a separate command.

## 8. Permissions

| Capability | Org owner | Org researcher | Org viewer | Project owner/editor | Project-only viewer |
|---|---:|---:|---:|---:|---:|
| Read organization signals | ✓ | ✓ | ✓ | Только routed в свой project | Только routed в свой project |
| Run organization search | ✓ | ✓ | — | — | — |
| Configure shared sources | ✓ | — | — | — | — |
| Route signal to project | ✓ | ✓ | — | Только в свой project, если уже видит signal | — |
| Promote routed signal | ✓ при project role | — | — | ✓ | — |
| Publish/comment | Только через project authority | — | — | По существующим project rules | — |

Все transport principals bind `organizationId`, `userId`, profile и capability set. Caller не может расширить scope входным `organizationId` или `projectIds`.

## 9. MCP-контракт MVP

Названия являются контрактными для RED.

### `ba_get_organization_intelligence_context`

Read-only. Возвращает организацию, доступные проекты, profile revisions, источники без секретов, разрешённые capabilities и counts inbox.

### `ba_search_organization_intelligence`

Вход:

- `organizationId`;
- `query`;
- `sources[]`;
- `projectScope: { mode: all_active | selected, projectIds? }`;
- optional filters and `waitMs`;
- обязательный `idempotencyKey`.

Выход:

- `researchRunId`, status;
- source outcomes;
- deduplicated signals;
- project assessments grouped by signal;
- counts: fetched, deduplicated, assessed, routed;
- warnings and next action.

### `ba_get_organization_research_run`

Read-only. Возвращает актуальный snapshot run, partial failures, сигналы и assessments. Не повторяет внешний поиск.

### `ba_route_organization_signal`

Вход: organization, signal, project, assessment revision, decision/note, idempotency key.

Выход: route identity, state and audit event. Не создаёт downstream project artifact.

### `ba_promote_project_signal`

Вход: project, routed signal, target `initiative | research_task | publication_theme`, title/brief overrides, idempotency key.

Выход: canonical created artifact and provenance. Повтор возвращает тот же artifact.

### Profile `/mcp/organization-researcher`

Allowlist содержит только organization context/search/read/route tools. Publication, schedule, content mutation, channel configuration и provider-secret tools отсутствуют в discovery и dispatch.

## 10. Детерминированные правила

- **R-OIH-001:** каждый project имеет один organization owner scope.
- **R-OIH-002:** один search command создаёт один run независимо от числа sources/projects.
- **R-OIH-003:** idempotency scope = organization + actor + command + key.
- **R-OIH-004:** provider identity/URL dedupe действует внутри организации, но не смешивает tenants.
- **R-OIH-005:** один signal имеет независимые assessments по project/profile revision.
- **R-OIH-006:** profile update может re-assess существующие signals без source fetch.
- **R-OIH-007:** partial source failure не удаляет успешные results.
- **R-OIH-008:** all_active исключает archived projects.
- **R-OIH-009:** route не создаёт downstream artifact.
- **R-OIH-010:** promotion разрешён только после route и отдельно идемпотентен.
- **R-OIH-011:** search-only credential невозможно использовать для representational action.
- **R-OIH-012:** project-only principal не читает общий inbox или assessments чужих проектов.
- **R-OIH-013:** найденный payload маркируется untrusted и сохраняет provenance/hash.
- **R-OIH-014:** secret configuration маскируется на всех read surfaces и не пишется в logs.
- **R-OIH-015:** найденный сигнал без project match сохраняется как unrouted evidence.
- **R-OIH-016:** deterministic adapter проверяет lifecycle, но не открывает production capability.

## 11. Пользовательские сценарии

### SC-OIH-001 — один запрос по всем активным проектам

Given исследователь состоит в организации с двумя активными проектами и профилями, When он запускает один поиск по Reddit и Indie Hackers, Then создаётся один run, каждый source вызывается один раз, сигналы дедуплицируются и получают отдельные оценки для обоих проектов.

### SC-OIH-002 — повтор команды

Given завершённый run, When тот же actor повторяет команду с тем же idempotency key, Then возвращается тот же run и не возникает новых source calls/signals/assessments.

### SC-OIH-003 — один материал найден повторно

Given source object уже существует, When следующий run возвращает его снова, Then обновляется observation metadata, но canonical signal остаётся один.

### SC-OIH-004 — один источник недоступен

Given Reddit отвечает, а Indie Hackers завершается timeout, When run заканчивается, Then status=`partial`, Reddit evidence и assessments доступны, а источник ошибки и безопасный retry видимы.

### SC-OIH-005 — изменение профиля проекта

Given сохранённые signals и assessment profile revision 1, When owner принимает revision 2, Then создаются новые assessments без внешнего source fetch, а старые остаются audit history.

### SC-OIH-006 — сигнал направлен в проект

Given researcher видит релевантный signal, When он выбирает route, Then сигнал появляется в project inbox, но число `ContentItem` и `Initiative` не меняется.

### SC-OIH-007 — явное продвижение

Given signal routed и actor является project owner/editor, When он promotes в initiative, Then создаётся одна initiative с provenance; повтор команды возвращает её же.

### SC-OIH-008 — project-only пользователь

Given пользователь состоит только в Project A, When он пытается открыть organization inbox или signal Project B, Then получает access denied без утечки counts/title/excerpt.

### SC-OIH-009 — research credential не даёт право говорить

Given connection capabilities=`search,read`, When organization researcher пытается вызвать comment/publish tool или передать этот connection ID, Then tool отсутствует в profile либо dispatch возвращает capability denied.

### SC-OIH-010 — сигнал не подходит ни одному проекту

Given источник вернул доказуемый материал без fit выше threshold, Then signal сохраняется в organization inbox как unrouted; публикационные сущности не создаются.

### SC-OIH-011 — архивный проект

Given один из проектов archived, When project scope=`all_active`, Then он не получает assessment/route, но исторические assessments остаются доступны согласно permission rules.

### SC-OIH-012 — UI организации

Given участник с organization access открывает `/intelligence`, Then он видит один общий Search, Runs, Inbox, Sources и Project fit; loading, empty, partial, permission и stale-profile states имеют явное восстановление.

## 12. RED test matrix

| Test | Rule/scenario | Level | Expected RED reason |
|---|---|---|---|
| E2E-007-001 | SC-001, R-002/005 | MCP + DB + deterministic adapter | organization tools/model отсутствуют |
| E2E-007-002 | SC-002, R-003 | MCP + DB | idempotent org run отсутствует |
| E2E-007-003 | SC-003, R-004 | MCP + DB | canonical signal dedupe отсутствует |
| E2E-007-004 | SC-006, R-009 | MCP + DB | route lifecycle отсутствует |
| E2E-007-005 | SC-007, R-010 | MCP + DB | explicit promotion отсутствует |
| E2E-007-006 | SC-008/009, R-011/012 | MCP auth | org profile/capability boundary отсутствует |
| E2E-007-007 | SC-004, R-007 | service integration | partial result contract отсутствует |
| E2E-007-008 | SC-005, R-006 | service + DB | re-assessment lifecycle отсутствует |
| E2E-007-009 | SC-011, R-008 | service + DB | all_active scope отсутствует |
| UI-007-001 | SC-012 | Playwright | `/intelligence` surface отсутствует |
| SEC-007-001 | R-014 | API/MCP/log contract | secret masking отсутствует |

Файл первого executable RED: `tests/tdpd/organization-intelligence-hub.e2e.test.js`.

## 13. Human UAT

1. Владелец открывает Organization → Intelligence Hub.
2. Выбирает минимум два активных проекта.
3. Одним действием запускает один запрос минимум по двум реальным источникам.
4. Проверяет, что один материал не продублирован, но имеет разные project-fit объяснения.
5. Направляет один сигнал в Project A и убеждается, что Project B его не получил.
6. Убеждается, что route не создал публикацию.
7. Отдельно promotes сигнал в тему публикации Project A и видит provenance.
8. Под project-only пользователем убеждается, что общий inbox и Project B закрыты.
9. Проверяет partial state при одном временно недоступном источнике.
10. Проверяет, что ни одна кнопка organization researcher не позволяет ответить или опубликовать.

Качественная полезность найденных сигналов оценивается человеком отдельно от GREEN deterministic tests.

## 14. Rollout

### Slice A — tenant foundation

Organization, membership, project binding, migration preview и authorization. Существующее project поведение не меняется.

### Slice B — shared evidence

Research connections, run orchestration, canonical signals, dedupe и partial failure. Старые project parser endpoints работают через compatibility projection.

### Slice C — project fit and routing

Project profiles, assessments, route lifecycle, organization researcher MCP profile.

### Slice D — UI and promotion

Organization Intelligence Hub, project inbox и explicit promotion в существующие canonical entities.

### Slice E — production source gates

По одному bounded smoke на каждый реальный source adapter. Источник не показывается как ready до подтверждённого read/search результата.

## 15. Миграция и совместимость

- миграция сначала добавляет nullable organization binding;
- выполняется read-only preview mapping проектов по owners;
- ambiguous projects не объединяются автоматически;
- после подтверждения binding становится обязательным для active projects;
- существующие project parser jobs получают provenance legacy scope;
- compatibility endpoints могут читать organization evidence через project projection, но не создавать второй canonical signal;
- rollback отключает новый UI/MCP profile и сохраняет organization evidence; publication runtime не затрагивается.

## 16. Наблюдаемость

Каждый run фиксирует correlation ID, actor, organization, adapter versions, source latency/outcome, fetch/dedupe/assessment counts и retry lineage. Logs не содержат credentials, полный private payload или OAuth material.

Минимальные метрики:

- searches per organization;
- source success/partial/failure rate;
- duplicate reduction ratio;
- signals routed per project;
- route → promotion conversion;
- median time signal → project decision;
- reassessment count without refetch.

## 17. Open decisions для Input Gate

Решения владельца приняты 11.09.2026:

- personal organization создаётся автоматически;
- organization researcher маршрутизирует сигналы по организации, promotion требует проектной роли;
- порог suggested равен 60;
- сохраняются metadata, ограниченный excerpt и hash; полный внешний текст — только когда это разрешено;
- первый production smoke: Reddit + Indie Hackers.

## 18. Gate status

- Business problem: PASS.
- Reliance-and-harm: PASS с обязательным human decision до promotion/publication.
- Architecture boundary: PASS.
- Surface gate: PASS (`/intelligence` + organization signal inbox + project-fit projection).
- Evidence gate: N/A для deterministic RED; REQUIRED отдельно для реальных source adapters.
- Red gate: PASS; зафиксировано отсутствие capability до реализации.
- Green gate: PASS: все 28 миграций применены с нуля в изолированной PostgreSQL; DB-backed E2E 7/7, полный backend suite 184/184, frontend build/lint/UI contracts проходят.
- Output/UAT gate: PARTIAL: интерфейс, MCP и deterministic/DB paths готовы; bounded production smoke Reddit + Indie Hackers обнаружил внешний blocker Parser API — pooled connections не сохраняют `search_path`, поэтому `parser.idempotency_records` не находится. Исправление подготовлено отдельным коммитом Parser, но ещё не развёрнуто.
- Production gate: HOLD до развёртывания Parser fix, повторного bounded smoke обоих источников и явного решения владельца на deployment Planner migrations/app.
