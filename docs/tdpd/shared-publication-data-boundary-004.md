# SHARED-PUBLICATION-DATA-BOUNDARY-004

**Статус:** LOCK/QAR/ARCH/RISK утверждены владельцем; implementation in progress.
Прямой ответ «Да, разрешаю» проверен в Portfolio HQ
`01a041f1-23c2-7092-a53a-4d4141a55a62`, user message
`01a148bc-16c4-7931-817a-2814a1282d3a`, на вопрос о внедрении, тестировании и
выкладке 004. Это не повторный copy GO. X1113-NATIVE-002 не пересогласовывается.
Ни deployment, ни отправка этим статусом не подтверждены.

## Что уже разрешено и что именно ещё нужно решить

Прямой owner GO «Давай все 4 доведём до отправки» проверен в исходном чате
`01a041f1-23c2-7092-a53a-4d4141a55a62`, user message
`01a1466f-316d-78b2-bda4-5178168dbaf1`. Существуют точные инженерные одобрения
пакета #1103, DEVTO-DYNAMIC-BROWSER-001 и X1113-NATIVE-002. Утверждать тексты,
обложки или X-пакет повторно не требуется.

Утверждённое решение: вместо ещё одного зашитого task-ID маршрута перенести
готовые проверки в общий параметризованный video/browser lifecycle и добавить
company LinkedIn с утверждённым изображением. Это меняет общую границу
авторизации/состояний и архитектуру старого exact-Telegram PR, поэтому прежний
copy GO и одобрение его старой реализации не заменяют новый LOCK/QAR/ARCH/RISK.
Сообщение другого агента об утверждении не является прямым human verdict.

## LOCK: ограниченный объём

Первые acceptance cases, номера/хеши — только данные и fixtures, не ветки кода:

| Случай | Свежий Planner readback | Что довести |
|---|---|---|
| p10 #1103 / ch109 | r2 draft, acceptance=null, STALE/null selected asset, video_cover; факт=null | Исправить collision WI1756/result2 без изменения старых решений; новая обычная Editor/Art-приёмка; forward rebind того же MP4 asset142 к r2; video, не image fallback |
| p7 #1136 / ch6 | accepted r5, APPROVED asset166, feed, язык пакета ru, факт=null | Audited task-only ru→en; Registry company identity; image-backed company LinkedIn browser lifecycle |
| p10 #1118 / ch178 | accepted r1, APPROVED cover146, article_cover, язык en, факт=null | Завершить уже одобренный динамический DEV.to article lifecycle |

Сохранить текст/принятую ревизию, оба исходных времени, канал/профиль, действующие
решения и SHA файлов. Для #1103 acceptance создаёт только нормальный Editor,
новую визуальную приёмку — Art; старые approval/decision остаются immutable.
MP4, R2-объект и видео не регенерируются. #1086/#1135 закрыты и исключены;
#1087 остаётся отдельной очередью, #1137 не публикуется. Другие задачи не чинятся.

## ARCH: переиспользование без копирования task-ID пакетов

- Переиспользовать MIME/MP4 bounded-reader, MTProto sendFile/video/readback и
  тестовые инварианты PR163 (`257bab6`), но не его TG1103 literals/schema/tool names.
  CI старого PR зелёный; это не доказательство тестов новой общей реализации.
- Переиспользовать общий review-handoff repair, owner release/lease/CAS и
  атомарные attempt/fact hooks; Registry определяет именно целевую company identity,
  не только совпадение названия канала. Не подставлять компанию из соседней задачи.
- DEV.to строится по уже одобренному DEVTO-DYNAMIC-BROWSER-001. Никакого API-обхода.
  LinkedIn/DEV.to browser остаётся у единственного owning Publisher в разрешённом
  контексте; в development/Planner tools нет provider action.
- Новые общие команды получают проверенный project/task/revision/asset snapshot,
  не произвольное полномочие на отправку. Использовать существующие WorkItem,
  WorkflowEvent, DeliveryAttempt, PublicationFact и serializable CAS. Если нужна
  миграция, новый credential store или отдельный исполнитель — отдельный delta,
  не скрытая часть этого утверждения.
- Preview по умолчанию; apply/release отдельно от claim/start. До первого
  внешнего write — одна durable attempt. Action-time/pre-submit связывает актуальный
  профиль, текст, approved файл, manifest, lease и стабильный send key. Подтверждение
  связывает provider object/permalink и фактический результат с той же попыткой.
  Caller hash/скриншот не выдаётся за независимую серверную проверку или подписанное
  native-доказательство. Ограничения assurance возвращаются явно.

## QAR/RISK: проверка, выкладка, rollback

Обязательны RED→GREEN: wrong tenant/actor/company; drift body/revision/date/manifest/
asset; null/stale/wrong-MIME asset; сохранение истории review/rebind; два claim/start/
permit/confirm; lost response/expired lease/UNKNOWN; generic dispatch/manual-fact
bypass; атомарность fact+attempt и rollback. PostgreSQL races — в отдельной
синтетической БД. Тесты/build/browser automation — только Docker на tower.

После focused tests, relevant regression, quality gate, build и независимого
security/architecture review — существующий production deployment process,
backward-compatible admission по умолчанию закрыт до точного release. Никакого
нового production instance, consumer, scheduler или переноса Planner ради выпуска.
Owning Publisher получает live readback и точные команды, проходит обязательный
UAT/action-time gate и выполняет одну отправку. Development Post не нажимает.

Новых аккаунтов, прав браузера, импорта cookies/сессий, передачи ключей или расширения
X-host permissions это решение не разрешает. Sticky site/tool denial сохраняется.
UNKNOWN/started/потерянный результат — reconciliation only, без reset/retry/new key.
Rollback закрывает новые admission/dispatch и откатывает код обычным способом,
сохраняя release/WI/lease/attempt/fact/audit; неизвестная отправка не переоткрывается.

## X #1113 — отдельный уже одобренный путь

Нового X-решения этот пакет не просит. Одобрение X1113-NATIVE-002:
Portfolio OS user message `01a140ef-8952-7333-8798-c11963149ee3`.
PR156 `6c2a840` содержит no-send key-compatibility slice с зелёным CI.
Полная default-off интеграция есть в локальном commit `f7b2593`, но не в head
PR156; основной checkout unmerged и не должен строиться/деплоиться как целое.
Нужно изолированно перенести уже написанное, проверить контейнерными unit/browser/
PostgreSQL tests и review, выложить default-off, исправить task metadata ru→en,
получить фактический owner no-send UAT и pairing/enrollment. Всё это пока не
подтверждено. X-ключ/разрешение не распространяется на LinkedIn или DEV.to.
Действующий container-only runtime policy остаётся обязательным и для этого пути;
если approved native-profile deployment несовместим с ним — вернуть конкретный
runtime/UAT blocker, не запускать Mac-автоматизацию или импортировать сессию.

## Проверенные границы и ближайшее действие

Все четыре прочитаны через актуальные manifest/bootstrap и scoped Planner tools;
на момент readback факт/link=null. Это НЕ доказательство отсутствия in-flight
attempt: release обязан проверять attempts/leases/facts внутри своей транзакции.
Тексты из этого readback захешированы в network-none контейнере на tower:

- #1103 r2: `b703e2b19c67ce62c870dc7998bddcfda2834858aa6b8b572d3d369595ee9e2a`;
- #1136 r5: `f2466094882cb20ec280d5f8f72411cb832cd5d8fc95aed6edbe0c4904b75262`;
- #1118 r1: `363ef73df900415ff965a77b1a71577354676d95077edbe84cf37ad0fabf3c12`;
- #1113 r1: `0fa60a2b064bad760b251a12ab39cf38735987dabecc57dcad1d60a46dec12e3`.

Новый общий runtime не считается реализованным/проверенным/выложенным одним
этим документом. Один implementation stream; текущий urgent consumer — #1136,
затем #1103 и #1118; X продолжает ранее одобренную изоляцию/проверку без конкурирующего
переписывания. По каждому вернуть commit/tests/deploy/live readback и точный
next command либо фактический blocker, без выдуманных имён ещё не созданных tools.

## First implementation boundary and test-first scenarios

Existing MCP is the operator surface; use dynamic validated parameters, existing
PostgreSQL entities and serializable transactions. No browser/provider call in
these tools. Owner-only release/repair, leased publisher execution. Snapshot
includes project/task/channel/revision/body/both dates/decision/asset/manifest
and adopted Registry identity; caller observations are not provider proof.

- S1 preview has no writes; release binds current accepted package and creates
  one WI; duplicate release is idempotent, altered request conflicts.
- S2 wrong tenant/actor/identity or body/date/revision/asset/manifest drift,
  holds, prior delivery or work blocks release; failed audit rolls back.
- S3 claim/start CAS yields one lease and one durable attempt before external
  write; replay never yields another permission; expiry/UNKNOWN only reconcile.
- S4 pre-submit binds actual author/company, text blocks and approved image;
  missing/wrong image/company or duplicate present rejects without send.
- S5 confirm atomically completes exact attempt/WI/fact/audit after provider
  object/permalink/readback; rollback leaves no partial fact; replay read-only.
- S6 generic dispatch/fact cannot bypass an active governed browser lifecycle;
  metadata repair only changes task/handoff language and audited identity,
  preserves accepted bytes, dates, art history, channel and assets.

Must-have negatives precede implementation. Deterministic mocked ports do not
prove PostgreSQL races, live browser access or publication. Separate synthetic
PostgreSQL and provider-backed owning-Publisher UAT remain required before
release. All project execution is container-only on tower.

Decomposition decision: existing MCP registration gets only an import and
registration call; existing oversized capability catalog gets only a shared
set import and lookup. All new schemas/guards/lifecycle/control metadata live
in small shared modules. Existing publication-ID arrays and exact legacy routes
are unchanged; no new baseline/debt exemption is admitted.
