# Важные конвенции импорта публикационных планов (TDPD-002)

Дата фиксации: 2026-08-10

## 1. `meta.plan_id` — стабильный идентификатор проекта

- **Правильно**: `meta.plan_id` служить идентификатором *проекта*, а не отдельной недели (например: `analystcraft-2026-user2`).
- **Опасность**: Если указать недельный суффикс в `plan_id` (например `analystcraft-w10-2026-08-10`), импортёр создаст **новый изолированный проект** со своими новыми каналами вместо обновления существующего проекта.
- **Практика**: Для обновления текущего проекта следующими неделями сохранять единый `plan_id`, а даты недели задавать через `meta.cycle_start` и `meta.cycle_end`.

---

## 2. Разделение полей `channel`, `account_ref` и `action_type`

Тип задачи в системе формируется по шаблону: `${action.channel}:${action.action_type}`.

- **`channel`**: слой/платформа контента (например: `telegram`, `threads`, `habr`, `vc`, `zen`, `video_script`, `telegram_post`, `threads_post`, `blog_article`).
- **`account_ref`**: ссылка на конкретный подключённый аккаунт в блоке `accounts` (например: `primary_tg`, `innokenty_threads`).
- **`action_type`**: только глагол/тип действия (например: `post_text`, `publish`, `manual_handoff`).

### Ошибка некорректной склейки:
Если передать `channel: "innokenty_threads"` и `action_type: "threads_post:publish"`, итоговый тип задачи станет:
`innokenty_threads:threads_post:publish` — этот тип не распознаётся адаптерами каналов.

### Правильный пример:
```json
{
  "accounts": {
    "innokenty_threads": {
      "platform": "threads"
    }
  },
  "actions": [
    {
      "id": "post-01",
      "item_key": "post-01",
      "channel": "threads",
      "account_ref": "innokenty_threads",
      "action_type": "post_text"
    }
  ]
}
```
Итоговый тип задачи: `threads:post_text` (распознаётся адаптером и веб-интерфейсом).
