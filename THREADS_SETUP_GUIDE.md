# Руководство по настройке интеграции с Threads (Meta)
# Meta Threads API Setup Guide

Это пошаговое руководство объясняет, как зарегистрировать приложение Meta, получить долгоживущий Access Token и `Threads User ID` для автоматической публикации постов в Threads через **ContentOps Studio**.

---

## 📋 Что требуется получить для подключения канала:
1. **Threads User ID** (числовой идентификатор вашего аккаунта Threads, например `17841400000000000`).
2. **Long-Lived Access Token** (токен доступа со сроком действия 60 дней и возможностью автообновления).

---

## Шаг 1. Регистрация в Meta for Developers

1. Перейдите на портал [Meta for Developers](https://developers.facebook.com/) и войдите под вашим аккаунтом Meta/Facebook/Instagram.
2. Если вы впервые на портале, нажмите **Get Started** (Начать) и подтвердите учетную запись разработчика.

---

## Шаг 2. Создание приложения Meta

1. Перейдите в раздел **My Apps** (Мои приложения) -> нажмите **Create App** (Создать приложение).
2. Выберите тип приложения: **Other** (Другое) -> нажмите **Next**.
3. Выберите тип: **Business** (или **Consumer**, поддерживающий Threads API).
4. Задайте имя приложения (например, `ContentOps Studio Publisher`) и укажите контактный email.
5. Нажмите **Create App**.

---

## Шаг 3. Добавление продукта Threads API

1. В панели управления вашим приложением найдите раздел **Add Products to Your App** (Добавить продукты).
2. Найдите карточку **Threads** и нажмите **Set Up** (Настроить).
3. В боковом меню появится раздел **Threads**.

---

## Шаг 4. Настройка разрешений (Permissions)

Для работы публикации и сбора аналитики приложению нужны следующие скоупы (Permissions):
- `threads_basic` — чтение профиля (ID, имя пользователя).
- `threads_content_publish` — создание медиа-контейнеров и публикация постов (текст, ссылки, изображения).
- `threads_manage_insights` — получение статистики (лайки, ответы, репосты, охваты).
- `threads_read_replies` *(опционально)* — чтение ответов на публикации.

> 💡 **Для личного использования / тестирования:**
> В разделе **App Roles** -> **Roles** добавьте ваш Threads/Instagram аккаунт в качестве **Tester** (Тестировщик).
> Авторизуйте запрос в приложении Instagram: `Настройки -> Для профессионалов -> Приглашения на тестирование`.

---

## Шаг 5. Получение короткоживущего токена (Short-Lived Token)

Вы можете сгенерировать начальный токен через **Graph API Explorer** или прямой OAuth-запрос:

```
https://threads.net/oauth/authorize?client_id={YOUR_THREADS_APP_ID}&redirect_uri={YOUR_REDIRECT_URI}&scope=threads_basic,threads_content_publish,threads_manage_insights&response_type=code
```

После подтверждения вы получите `code`, который обменивается на короткоживущий токен:

```bash
curl -X POST https://graph.threads.net/oauth/access_token \
  -F client_id="{YOUR_THREADS_APP_ID}" \
  -F client_secret="{YOUR_THREADS_APP_SECRET}" \
  -F grant_type="authorization_code" \
  -F redirect_uri="{YOUR_REDIRECT_URI}" \
  -F code="{CODE_FROM_REDIRECT}"
```

Ответ вернет:
```json
{
  "access_token": "THQ...",
  "user_id": 17841400000000000
}
```

---

## Шаг 6. Обмен на 60-дневный долгоживущий токен (Long-Lived Token)

Короткоживущий токен живет всего 1 час. Обменяйте его на долгоживущий токен (действует 60 дней):

```bash
curl -X GET "https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret={YOUR_THREADS_APP_SECRET}&access_token={SHORT_LIVED_TOKEN}"
```

Ответ:
```json
{
  "access_token": "THQW...",
  "token_type": "bearer",
  "expires_in": 5184000
}
```

Скопируйте полученный `access_token` — именно он вставляется в ContentOps Studio.

---

## Шаг 7. Определение вашего `Threads User ID`

Выполните запрос к профилю с вашим токеном:

```bash
curl -X GET "https://graph.threads.net/v1.0/me?fields=id,username,name&access_token={YOUR_LONG_LIVED_TOKEN}"
```

Ответ:
```json
{
  "id": "17841405556667778",
  "username": "my_brand_account",
  "name": "My Brand"
}
```

Значение поля `"id"` — это ваш **Threads User ID**.

---

## Шаг 8. Подключение в ContentOps Studio

1. Откройте **ContentOps Studio** -> выберите нужный проект.
2. Перейдите в **Настройки (Settings)** -> вкладка **Каналы (Channels)**.
3. В блоке добавления канала выберите тип: **Threads**.
4. Заполните поля:
   - **Threads User ID**: вставьте ID из Шага 7 (например, `17841405556667778`).
   - **Access Token**: вставьте долгоживущий токен из Шага 6.
5. Нажмите кнопку **«Проверить подключение Threads»**.
   - Система сделает тестовый запрос к Meta Graph API (`/v1.0/me`).
   - При успехе отобразится зеленый статус с подтверждением вашего аккаунта (например: `Подключение работает (@my_brand_account)`).
6. Нажмите **«Сохранить»**.

---

## 🔄 Продление токена (Refresh)

Долгоживущий токен действует 60 дней. Чтобы обновить его (когда до истечения остается менее 30 дней), сделайте GET-запрос:

```bash
curl -X GET "https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token={YOUR_LONG_LIVED_TOKEN}"
```

Обновленный токен снова будет действовать 60 дней.
