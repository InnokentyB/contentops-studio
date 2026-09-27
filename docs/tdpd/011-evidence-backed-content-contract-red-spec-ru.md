# TDPD 011 — Evidence-backed content contract

**Статус:** RED specification; production schema и publication gates не изменяются  
**Дата:** 2026-09-27  
**Владелец:** ContentOps / Chief Editor  
**Источник сигнала:** авторское наблюдение, [brainshare/2651](https://t.me/brainshare/2651); не исследование и не доказательство эффекта

## 1. Модель функции

### Проблема и гипотеза

Сильное публичное утверждение о результате может пережить реальную работу, на
которую оно ссылается. ContentOps уже проверяет голос, платформенную форму,
словарь и revision-bound approval, но не связывает силу result claim с
проверяемым доказательством.

Проверяемая продуктовая гипотеза: явное согласование claim stage, framing и
evidence уменьшит overclaim и misleading/AI-slop, а также улучшит доверительные
действия аудитории. Reach не считается доказательством гипотезы.

### Акторы и граница

- Writer готовит текст и прикладывает доступные evidence refs.
- Chief Editor в существующем `content_review` подтверждает классификацию claims,
  достаточность evidence и framing. Новый workflow не создаётся.
- Owner принимает только текущий, revision-bound результат review.
- Publisher не интерпретирует доказательства заново и не получает новых прав.

Claim/evidence check является частью редакционного принятия текста. Он не является
разрешением на публикацию и не заменяет отдельный owner release.

### Логический контракт данных

Первая реализация должна оперировать логическими полями независимо от решения о
физическом хранении:

- `claim_stage`: `idea | hypothesis | experiment | verified_result`;
- `evidence_refs[]`: типизированные ссылки на проверяемые артефакты, привязанные к
  `content_revision` и конкретным claims;
- `evidence_status`: `not_required | missing | attached | verified | invalid`;
- `claim_evidence_findings[]`: стабильные issue codes, claim excerpt и предлагаемое
  ослабление framing;
- `alignment_status`: `aligned | revise`.

Допустимые evidence types для slice: `observable_product`, `reproducible_test`,
`real_screenshot_or_recording`, `metric`, `commit_or_release`,
`publication_fact`, `other_verifiable_artifact`. Для metric обязательны period и
baseline/comparator, если текст утверждает изменение.

Прототип, презентация, mockup и AI-generated demo могут быть source material, но
не evidence production outcome. Они допустимы только с явным framing стадии.

## 2. Сверка с действующими контрактами

### Voice DNA / content policy matrix

Текущий `content_policy_matrix` уже объединяет platform × voice правила,
ограничения длины, required/forbidden phrases и narrative traits. `content_dictionary`
и ATOMA передают словарь и source context критику. Это правильная точка контекста,
но сейчас она не моделирует claim lifecycle, доказательство или связь evidence с
конкретной revision.

Вывод: evidence contract дополняет Voice DNA, но не должен становиться новым voice
профилем. Voice отвечает за способ выражения; claim/evidence — за допустимую силу
фактического утверждения.

### Anti-slop / publication critic

Текущий critic оценивает relevance, insight, clarity, engagement, formatting,
platform/voice/length/rule fit и возвращает свободные `issues` и
`rewrite_instructions`. Даже при наличии source context его ответ не содержит
обязательной структуры claim/evidence и не может детерминированно блокировать
overclaim.

Вывод: модель может предложить классификацию, но GREEN-критерий не должен зависеть
от живого LLM. Acceptance tests используют `DeterministicClaimAssessmentAdapter`,
который возвращает фиксированный structured assessment; отдельный human UAT
оценивает естественность framing.

### Content review и approval

Текущий `content_review` уже revision-bound, lease-bound и versioned. Однако
`ba_submit_content_review` принимает только recommendation, summary и свободные
findings, а `ba_decide_approval` проверяет состояние/result version, но не
структурный evidence report. Поэтому сейчас `approve` технически возможно при
отсутствующем proof.

Вывод: расширять надо существующий review result и его approval invariant. Новый
work-item kind, отдельная очередь или автоматическое owner approval не нужны.

## 3. RED-сценарии

### MUST — S-EBC-001: verified result с доказательством проходит gate

- **Уровень:** service/integration.
- **Предусловия:** текущая revision содержит result claim; structured assessment:
  `claim_stage=verified_result`; evidence ref разрешённого типа, доступен и связан
  с этой revision и claim.
- **Действие:** Chief Editor отправляет `approve` review result.
- **Ожидание:** `alignment_status=aligned`, result становится
  `waiting_approval`; evidence report сохраняется в той же result version. Copy,
  accepted revision и publication mode не меняются.

### MUST — S-EBC-002: result claim без proof нельзя рекомендовать к approval

- **Уровень:** service/API.
- **Предусловия:** текст заявляет «мы внедрили/получили/улучшили», stage —
  `verified_result`, `evidence_refs=[]` или `evidence_status=missing`.
- **Действие:** reviewer отправляет recommendation `approve`.
- **Ожидание:** стабильная ошибка `CLAIM_EVIDENCE_MISMATCH`, ноль переходов state и
  version; ответ содержит finding с требованием приложить proof либо ослабить
  framing до hypothesis/experiment.

### MUST — S-EBC-003: идея и гипотеза публикуемы без proof результата

- **Уровень:** unit/service.
- **Предусловия:** текст явно маркирован как idea/hypothesis, не утверждает
  наступивший результат.
- **Действие:** review проводится без evidence refs.
- **Ожидание:** `evidence_status=not_required`, alignment проходит; отсутствие
  evidence само по себе не создаёт blocker.

### MUST — S-EBC-004: headline не сильнее body evidence

- **Уровень:** unit/service.
- **Предусловия:** body описывает hypothesis или незавершённый experiment, а
  headline заявляет verified outcome.
- **Действие:** alignment validator получает structured claims.
- **Ожидание:** `HEADLINE_EXCEEDS_EVIDENCE` и recommendation `revise`, даже если
  body содержит корректный disclaimer.

### MUST — S-EBC-005: mockup/AI demo не доказывает production outcome

- **Уровень:** unit.
- **Предусловия:** verified result claim с единственным ref типа mockup,
  presentation, prototype либо AI-generated demo.
- **Действие:** evidence validator проверяет ref.
- **Ожидание:** `NON_PRODUCTION_ARTIFACT`, status `invalid`; approval невозможен.
  Тот же ref допустим для experiment при явной маркировке prototype/demo.

### MUST — S-EBC-006: evidence привязано к revision

- **Уровень:** integration.
- **Предусловия:** proof и review относятся к revision N; текст изменён до N+1.
- **Действие:** пытаются повторно использовать старый result/evidence report.
- **Ожидание:** `CONTENT_REVIEW_VERSION_CONFLICT` либо
  `STALE_CLAIM_EVIDENCE`; accepted revision не меняется, создаётся обычный новый
  review для N+1, без отдельного workflow.

### MUST — S-EBC-007: approval не обходит unresolved mismatch

- **Уровень:** integration/API.
- **Предусловия:** review result находится в `waiting_approval`, но содержит
  `alignment_status=revise` или blocking finding.
- **Действие:** owner вызывает `ba_decide_approval(approved)` с актуальным result
  version.
- **Ожидание:** `CLAIM_EVIDENCE_REVIEW_UNRESOLVED`; нет ApprovalDecision,
  content revision не принимается, art-direction не стартует.

### MUST — S-EBC-008: права и tenant isolation не расширяются

- **Уровень:** API/MCP.
- **Предусловия:** writer, publisher или actor другого проекта пытается подтвердить
  evidence alignment/approval.
- **Действие:** вызов review/approval boundary.
- **Ожидание:** существующий role/tenant отказ; publisher видит итог readiness, но
  не может менять claim stage или evidence report.

### SHOULD — S-EBC-009: metric evidence проверяется структурно

- **Уровень:** unit.
- **Предусловия:** claim «метрика выросла» с metric ref.
- **Действие:** validate.
- **Ожидание:** period, value, comparator/baseline и artifact locator обязательны;
  отсутствие любого поля даёт `INCOMPLETE_METRIC_EVIDENCE`.

### SHOULD — S-EBC-010: повтор submit и concurrency безопасны

- **Уровень:** integration.
- **Предусловия:** один lease/result version; одинаковый idempotency key или два
  конкурентных reviewer submit.
- **Действие:** повторить/состязать submit.
- **Ожидание:** точный replay для того же payload; конфликт для другого payload;
  только одна result version и один audit trail.

### SHOULD — S-EBC-011: deterministic A/B assignment и измерение

- **Уровень:** service/analytics.
- **Предусловия:** заранее определённая выборка сопоставимых материалов и единица
  рандомизации; ни одна ветка не содержит заведомо misleading claim.
- **Действие:** назначить control framing или explicit proof layer и записать
  outcome checkpoints.
- **Ожидание:** assignment стабилен и не меняется после просмотра результата;
  считаются verified-claim rate, corrected overclaims, saves, substantive replies,
  qualified clicks/actions. Reach хранится как secondary metric.

### SHOULD — S-EBC-012: audit не сохраняет секреты или приватные payload

- **Уровень:** security/integration.
- **Предусловия:** evidence ref ведёт к приватному artifact с credential-bearing
  URL/header.
- **Действие:** review сохраняется и читается через API/MCP.
- **Ожидание:** хранится безопасный locator/ID и metadata, не raw token, cookie,
  authorization header или полный provider payload.

## 4. Рискованные углы

- Opinion с factual premise: мнение не требует proof результата, но проверяемая
  фактическая предпосылка может требовать source/evidence.
- Один пост может содержать claims разных стадий; одно поле на весь item может быть
  недостаточно. Для slice нужен primary claim и массив secondary findings.
- Доступность ссылки не равна доказательной силе; ref должен быть типизирован и
  привязан к claim, а не просто присутствовать.
- Screenshot может быть реальным, но не подтверждать заявленную метрику или causal
  effect.
- Исправление текста после review всегда инвалидирует report, даже если evidence
  refs не изменились.
- Недоступность внешнего artifact во время review не должна молча превращаться в
  `verified`; нужна явная ошибка/повторная проверка без acceptance.

## 5. Открытые продуктовые вопросы до GREEN

1. `claim_stage` описывает весь content item или primary claim, а secondary claims
   получают собственные stages?
2. Кто ставит stage: writer, deterministic rules, LLM suggestion или Chief Editor?
   Рекомендуемая граница: adapter предлагает, Chief Editor подтверждает.
3. Должен ли observable product link без readback подтверждать «выпустили», но не
   «улучшили метрику»? Рекомендуется да, с привязкой evidence type к claim type.
4. Какие evidence refs допустимы читателю публично, а какие видны только редактору?
5. Нужно ли обязательное отображение label в самом тексте или достаточно framing,
   проверенного редактором?
6. Что считать substantive reply и qualified action для A/B и в каком окне?
7. Какова единица A/B: канал, content family, campaign или отдельный item? Нельзя
   рандомизировать две версии одного обещания без защиты от audience contamination.

## 6. Порядок первого red-green-refactor

1. Создать чистый deterministic alignment contract и RED для S-EBC-002–005.
2. Расширить structured content-review result и RED для S-EBC-001, 006, 007, 010.
3. Добавить read-only readiness projection и permission tests S-EBC-008/012.
4. Провести human UAT: редактор подтверждает, что framing естественный, label не
   превращает текст в отчёт, а proof понятен читателю.
5. Только после UAT проектировать A/B instrumentation. Эффект гипотезы нельзя
   объявлять доказанным по unit/integration tests.

До решения открытых вопросов документ остаётся RED specification. Он не разрешает
миграцию production schema, изменение approval gate или публикацию.
