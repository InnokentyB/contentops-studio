# Настройка Telegram MTProto

MTProto используется для публикации от имени авторизованного Telegram-аккаунта. Bot API остаётся резервным маршрутом там, где он поддерживается.

## Где хранятся данные

- `api_id` хранится в `planner.telegram_accounts` как числовой идентификатор приложения.
- `api_hash` и MTProto `session_string` шифруются AES-256-GCM перед записью в БД.
- Ключ `CHANNEL_SECRETS_KEY` хранится только в Railway Variables сервиса `planner-app`.
- В Railway Variables не нужны отдельные `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` и `TELEGRAM_SESSION_STRING`.

Не меняйте `CHANNEL_SECRETS_KEY` после создания сессий: без прежнего ключа существующие записи расшифровать нельзя.

## Получение Telegram API credentials

1. Войти на `https://my.telegram.org` рабочим Telegram-аккаунтом.
2. Открыть **API development tools**.
3. Создать приложение.
4. Сохранить выданные `api_id` и `api_hash` до запуска setup-скрипта.

Не отправляйте `api_hash`, пароль 2FA или строку сессии в чат и не сохраняйте их в репозитории.

## Создание сессии

Из корня репозитория, авторизовав Railway CLI в production-проекте:

```bash
railway run --service planner-app npm run telegram:setup
```

Скрипт последовательно запросит:

1. `API ID`.
2. `API Hash` без отображения введённых символов.
3. Телефон в международном формате, например `+351...`.
4. Код, присланный Telegram.
5. Пароль 2FA без отображения, если он включён.
6. ID проекта planner. Для текущего проекта MCP используется `10`.

После успешного входа скрипт зашифрует `api_hash` и строку сессии, затем выполнит upsert в `planner.telegram_accounts`.

## Проверка

Повторный setup для того же сочетания `project_id + phone_number` заменяет сессию, не создавая дубликат. После настройки выполните dry-run Telegram-публикации из задачи; live-публикацию запускайте только после успешного dry-run.

Если сервис сообщает `Unable to decrypt channel session`, проверьте, что `CHANNEL_SECRETS_KEY` в Railway не менялся.
