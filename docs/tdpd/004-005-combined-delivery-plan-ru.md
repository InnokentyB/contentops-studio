# TDPD-004/005: единый delivery-проход

Статус: Engineering complete, ready for owner UAT  
Дата решения: 2026-08-17  
Метод: Test-Driven Product Development (TDPD), оригинальный метод Иннокентия Бодрова

## Зачем объединены спеки

TDPD-004 вводит каноническую runtime-правду о факте публикации и метриках. TDPD-005
запрещает недельному импорту повреждать или перепроецировать эту правду. Раздельная
реализация оставила бы промежуточное состояние, в котором новый факт уже существует,
но импорт ещё способен изменить его недельную принадлежность или UI-проекцию.

## Общая архитектурная граница

1. `WeekPackage` идентифицируется проектом и точным диапазоном дат.
2. `PublicationFact` является каноническим фактом результата; workflow status остаётся отдельным измерением.
3. `MetricSnapshot` принадлежит опубликованному материалу и checkpoint, а не импорту плана.
4. Delta-import владеет плановыми полями только внутри целевой недели.
5. Publication runtime, content revision, facts, evidence, metrics и checkpoints импортом не изменяются.
6. List/detail/rollup используют одни канонические предикаты публикации и активности.
7. Все новые read/write-контракты сохраняют проектную изоляцию и действующие MCP capability boundaries.

## Порядок RED → GREEN

### Слайс A — защитный контур импорта

- E2E-WPI-001–006: две недели, exact package resolution, runtime lock, cross-cycle conflict, idempotency.
- API-WPI-007–009: server-side active/week filter и согласованность list/detail.

### Слайс B — канонический факт публикации

- E2E-PFM-001–005, 012–014: identity rules, audit correction, import protection, tenant isolation.
- Новый `ba_record_publication_fact`; legacy confirm вызывает тот же доменный сервис.

### Слайс C — checkpoints и rollup

- E2E-PFM-006–011: metric payload v1, T+24h/T+7d, partial/late/not-supported, idempotency.
- Rollup выбирает последнее наблюдаемое накопительное значение материала и исключает non-published outcome.

### Слайс D — операторский UI и recovery

- UI-WPI-010 и UI-проходы PFM: факт, evidence, checkpoints, observed/unknown/not-supported.
- OPS-WPI-011–012: owner-only repair preview/apply с одной транзакцией и audit trail.

## Совместные критические сценарии

1. Опубликованный пост с permalink и двумя snapshots переживает импорт следующей недели без единого изменения runtime.
2. Story без permalink, но с identity/evidence, остаётся опубликованной и не появляется как пустая задача после delta-import.
3. `published + removed` не попадает ни в active queue, ни в rollup, независимо от legacy link/status.
4. Повтор импорта и повтор checkpoint-job не создают пакет, задачу, факт или snapshot повторно.
5. Пользователь другого проекта не видит package, publication fact, evidence и metrics по известному ID.

## Общая приёмка (UAT)

Владелец последовательно:

1. Открывает W10 и проверяет опубликованный пост с текстом, permalink и runtime-метриками.
2. Импортирует W11, видит новый пакет и отсутствие изменений в W10.
3. Подтверждает обычный post и story; видит созданные T+24h/T+7d.
4. Записывает observed zero и unknown, перезагружает карточку и видит различие.
5. Повторяет delta и metric retry без дублей.
6. Проверяет rollup: removed исключён, T+24h и T+7d одного поста не сложены.

## Gate status

- Business problem: **PASS**.
- Specification: **PASS**.
- Input gate: **PASS**.
- RED gate: **PASS**.
- GREEN gate: **PASS** — backend 58/58, DB-backed TDPD 66/66, MCP smoke и frontend contracts.
- Output/UAT gate: **READY FOR OWNER ACCEPTANCE** — локальный safe-mode UAT пройден; production не изменялся.

Визуальные доказательства:

- `uat-004-005-publication-card-overview.png` — опубликованная задача открывается из выбранной недели и видна в списке;
- `uat-004-005-publication-card.png` — ручной T+24 checkpoint сохраняет observed zero отдельно от unknown.
