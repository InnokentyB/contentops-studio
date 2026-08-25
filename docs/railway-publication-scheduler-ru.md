# Часовой автопубликатор Planner

## Два маршрута

- `connector_auto`: текст готов, visual gate пройден, время наступило, у канала есть API-коннектор. Railway Scheduler резервирует и публикует задачу.
- `browser_required`: у площадки нет API, политика требует браузер либо коннектор уже вернул ошибку. Scheduler больше не повторяет API и создаёт `browser_publish` work item.
- Если контейнер остановился во время отправки, через 30 минут задача считается зависшей и уходит в `browser_required`. API повторно не вызывается, чтобы не создать дубль поста.

Опубликованные задачи и задачи с `publication_fact` не попадают в повторное выполнение.

## Railway

Создай отдельный сервис `planner-publication-scheduler` из того же GitHub-репозитория.

1. Config path: `ops/railway/planner-publication-scheduler.railway.json`.
2. Добавь те же `DATABASE_URL`, `DIRECT_URL` и provider credentials, которые использует `planner-app` для публикационных коннекторов.
3. Не назначай сервису публичный домен.
4. Cron schedule: `0 * * * *` (Railway исполняет cron в UTC).
5. У `planner-app` оставь `ENABLE_INLINE_PUBLICATION_SCHEDULER=false` или не задавай переменную.

Cron-процесс выполняет один проход, закрывает соединения с БД и завершается. Если предыдущий проход ещё работает, Railway пропустит следующий запуск.

## Browser queue

Browser-агент вызывает `ba_list_browser_publication_tasks`, резервирует один work item через обычный lease, открывает подготовленный handoff, публикует в авторизованном браузере и фиксирует permalink через `ba_confirm_publication`. Успешная браузерная публикация завершает work item и создаёт канонический `publication_fact`.
