# Delta017: подключить provider к существующему заданию1048

Дата: 2026-10-13, Europe/Lisbon. Статус: INPUT УТВЕРЖДЁН.
Пакет LOCK/QAR/ARCH/RISK/AUT-VK-017 утверждён прямым ответом владельца
«Да, продаю, давай» в чате VK adapter. Финальные сценарии, RED, реализация
и проверяемый выпуск delta разрешены. Явные tool/site-control ограничения
не отменяются, provider smoke и owner UAT остаются отдельными проверками.

Прямой запрос владельца «Подключай и отправ до яй» проверен в human turn
`01a13439-fd3e-7ff3-9434-2532cf56a339` чата Portfolio HQ. В контексте1048
это разрешение на подключение и выпуск этого поста. Архитектура ниже утверждена последним ответом владельца по AGENTS.md; запрос не отменяет явных запретов
инструмента или контроля площадки.

## Проверено сейчас

- Registry v33, hash `f5928dc815f40b24b13f3927411037d5df92cab1e75d20f178758eddd925b98a`:
  профиль `analystcraft-vk-group` → channel117/project10; browserMode=false,
  manualMode=true. Это не актуальная проверка браузерной сессии или прав VK.
- Manifest `sha256:4bfec7ca8399251c6c8f132a34d9e0952adbf1eef049d29325808cbd9db3975b`.
- Живой Publisher MCP: project10, задача1048, acceptedrev1, asset130, feed,
  community-240051152. Канонического факта/ссылки нет. Тело/asset/release сохранены.
- Body SHA `5cc11b6f7a5d8a2abf7a10ca2d005bf6cdd1c010a97ebedcd49e1092d5b874ab`;
  asset SHA `1e7ef29ec003f18c242af5ca4d15d9f4990539ed905398a14df0d3071b4aa81e`.
- Job `3f9f1d08-1d1f-49a9-8f2c-cc17d00ac2de`, generation1, BLOCKED.
  Package SHA `00636df473f9fae9f7dee61a3c358d5c64e3f28b8e856aed8374c1302bc2aaea`.
- Исполнитель ONLINE. WI1699 claimed, lease истекла
  `2026-10-11T22:23:39.215Z`, resultversion0. Read-only DB: delivery_attempts=[]
  для1048. Это не подтверждает отсутствие поста в VK.
- `vk_connector_consumer_runtime.ts` безусловно сообщает
  `PROVIDER_CONTROL_DENIED`; browser/provider он не импортирует.
  `vk_connector_dispatch.service.ts` не предоставляет live-перехода.
  SQL host.mode CHECK разрешает только `infrastructure_only`.
- Старый `vk_browser_worker.ts:179` напрямую запускает persistent Chrome;
  это имеющийся самостоятельный executable, а не CUA. Новой независимой
  проверки его допустимости/сессии/DOM сегодня не было.

**Причина текущего статуса — кодовый режим, а не новая ошибка инструмента.**
Историческое явное запрещение операции не объявляется снятым. Нельзя использовать
этот delta как разрешение обхода через другой процесс/профиль/API. Перед реальным
provider-действием требуется разрешённый контекст исполнения; если его нет,
операция остаётся заблокированной с указанием основания, даты и действия.

## LOCK-VK-017: единственный результат и граница

Подключить существующий ordinary-image-feed VK adapter к standalone consumer,
используя тот же job1048. Другие задачи, Clips, поиск, API fallback, текст,
картинка и placement не входят в delta. Новый Publisher ключ не нужен.

Первое provider-действие — только разрешённая read-only сверка целевого сообщества.
Уникальное точное совпадение означает reconciliation без отправки. Полная
ограниченная сверка с доказанным отсутствием и безопасное состояние попыток
разрешают одну отправку. UNKNOWN/неполные данные запрещают отправку.

Только подтверждённый provider object/permalink, независимое время публикации
и привязка выбранной картинки разрешают канонический факт и checkpoints.
Click/receipt/видимая произвольная картинка не являются подтверждением.

## ARCH-VK-017: минимальное расширение

1. Добавить provider port к существующему consumer; переиспользовать текущие
   `vk_browser_worker.service.ts`, `PlaywrightVkBrowserUi` и submission-control.
   Новый daemon, очередь, service identity и новый job не создаются.
2. Вынести из старого CLI переиспользуемый control client/browser lifecycle;
   private profile остаётся только на хосте. Не восстанавливать старые provider
   версии из stash. Сессия другого браузера/профиля не извлекается.
3. Добавить защищённое получение execution package текущего job: точный body,
   approved asset и release. Только Publisher/project10/1048, без credentials
   в job/БД/логах. Consumer повторно проверяет hashes после скачивания изображения.
4. Новый read-only reconciliation port хранит bounded coverage, owner/object IDs,
   observed provider time и media identity evidence. Отсутствие нельзя выводить
   из news search, одной страницы, одной старой даты или только совпадения текста.
   При недоказуемой идентичности картинки результат UNKNOWN.
5. Owner-only CAS-переход того же BLOCKED job с неизменным package/release
   fingerprint. Исторический blocker сохраняется в audit. Повтор command возвращает
   тот же job, не новый upload/send. Нельзя разрешить live одним environment flag.
6. После разрешённой сверки использовать существующий
   `claimVkBrowserPublication`/`claimWorkItem` для expired WI lease, не direct reset.
   Связать transport generation с новой канонической lease; старый instance
   отсекается перед upload/submit/confirm. Started/uncertain → только reconciliation.
7. Durable attempt до первого upload/submit. Confirm через существующий guarded
   canonical fact/checkpoint путь; новая таблица публикационной истины не создаётся.
8. Сначала совместимые readers для новых transport states, затем атомарное
   расширение host.mode CHECK на строго ограниченный `vk_feed_provider`.
   Default остаётся infrastructure_only. Активировать pilot только после проверок.

Provider mode — новый execution surface относительно016: там live-mode/profile
parameter/provider import прямо исключены. Это не смена подписи старого blocker.

## QAR-VK-017

| Требование | Проверяемая граница |
| --- | --- |
| Кардинальность | Один существующий job; максимум один provider submit на принятую ревизию/channel |
| Конкуренция | Один активный процесс/profile; действующая каноническая lease и transport fencing |
| Проверки | Metadata/read/navigation шаг ≤30 секунд; reconciliation ≤120 секунд/100 объектов; исчерпанный бюджет → UNKNOWN |
| Media | Локальный approved SHA + provider acknowledgement/object binding; image_present недостаточно |
| Неопределённость | Ноль retries после upload/submit с неизвестным результатом, включая restart/rollback |
| Приватность | Ноль новых auth secrets, cookies/profile storage/headers/provider secrets в persisted diagnostics |
| Совместимость | Существующий blocked job, прошлый receipt, lease/attempt/fact history сохраняются |
| Выпуск | RED до реализации; focused tests, build, quality gate, DB races, review, scoped provider smoke, owner UAT |

После зафиксированного Input утверждения финализированы сценарии: существующий точный пост,
подтверждённое отсутствие, UNKNOWN coverage/media/date, lease race, lost response,
restart после attempt, wrong account, login/challenge, explicit policy denial,
exact fact/checkpoints и повторная команда без дубля. RED записывается до реализации каждого изменения.

## RISK/AUT-VK-017 и одноразовый bootstrap

- Независимый process не равен разрешению: сохранить запрет affected operation,
  если он действительно применим; no alternate browser/profile/API workaround.
- Старый `PROVIDER_CONTROL_DENIED` не использовать как доказательство свежего
  отказа. Для blocked результата разделять NOT_CONNECTED, LOGIN_REQUIRED,
  COVERAGE_UNKNOWN, MEDIA_UNCONFIRMED, ACTIVE_ATTEMPT и фактический POLICY_DENIED.
- Разрешение владельца на1048 проверено, но не отменяет tool/site-control.
- До открытия профиля подтвердить разрешённый execution context. Если необходим
  login, владелец входит сам в существующий выделенный профиль через штатное окно
  адаптера. Не просить присылать пароль/OTP/cookie/token в чат.
- Статус login/profile permissions сейчас NOT_CHECKED; не утверждать, что
  владельцу уже обязательно нужен новый вход. Конкретное штатное окно/путь
  показать только при разрешённой action-time проверке, не угадывать иной профиль.
- Никаких новых ключей, извлечения сессии, перепривязки community, publication
  в другие каналы или изменения copy/asset/placement это утверждение не разрешает.

Rollout: совместимость readers → проверенная миграция → provider module со
  строгим permission guard → разрешённая read-only сверка → одна release-bound
  попытка/или reconciliation → independent confirmation → owner UAT.
Rollback: остановить provider, оставить совместимый status reader и audit;
  активный/неопределённый attempt заморозить verification_required, никогда
  не возвращать его available. Не откатывать reader к016, пока он не умеет
  читать сохранённые новые состояния. Не удалять jobs/attempts/facts/checkpoints.

## Точное решение владельца

Утвердить LOCK/QAR/ARCH/RISK/AUT-VK-017: подключение ordinary VK-feed provider
к существующему consumer/job1048, read-only reconciliation, штатный canonical
lease reclaim, одна доказуемая отправка/или reconciliation и guarded fact,
с указанным расширением mode/readers и без обхода действующих ограничений.
Это решение принято; реализация delta разрешена. Реальная provider операция всё равно требует
допустимого контекста, а UNKNOWN никогда не разрешит отправку.
