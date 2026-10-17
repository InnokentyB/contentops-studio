import { createController } from './pilot-ui-controller.mjs';

const element = id => document.getElementById(id);
const labels = {
    NOT_CHECKED: 'Проверка ещё не выполнялась.', CHECKING: 'Проверяем. Не закрывайте окно до получения результата.',
    CHECK_COMPLETE_NO_SEND: 'Локальная проверка пройдена. Пост не отправлялся; подключение Planner не подтверждено.',
    PAIRING_VERIFIED_NO_SEND: 'Подключение проверено без отправки. Разрешение на публикацию не выдавалось.',
    PLANNER_READY_NOT_SENT: 'Planner разрешил начать проверки. Пост не отправлен. Для отправки отметьте подтверждение.',
    RECONCILIATION_REQUIRED: 'Нужна проверка той же попытки в Planner. Повторная отправка запрещена.',
    PUBLICATION_CONFIRMED: 'Planner подтвердил публикацию.',
    LOCAL_IDENTITY_NOT_ENROLLED: 'Публичные данные установки готовы. Регистрация и разрешение проверяются отдельно.',
    LOCAL_CONNECTION_LOST: 'Ответ не получен. Проверьте состояние в Planner; для начатой отправки — только ту же попытку.',
    LOCAL_READINESS_EXPIRED: 'Готовность истекла. Снова проверьте разрешение Planner. Пост не отправлялся.',
    LOCAL_PACKAGE_INVALID: 'Не удалось прочитать пакет JSON. Скопируйте полный пакет из Planner с восемью полями, без токенов и cookies.',
    LOCAL_NONCE_INVALID: 'Код должен содержать ровно 64 символа: цифры и буквы a–f. Скопируйте код из Planner целиком.',
    LOCAL_NONCE_REQUIRED: 'Для проверки готовности и отправки нужен код выпуска. Получите его в Planner для этого пакета.',
    LOCAL_BODY_REQUIRED: 'Для локальной проверки без кода вставьте точный принятый текст. Либо укажите код проверки Planner.',
    LOCAL_BODY_MISMATCH: 'Текст не совпал с хешем пакета или превышает 280 символов. Возьмите точный принятый текст из Planner, не редактируя его здесь.',
    NATIVE_EDITOR_TEXT_MISMATCH: 'Открытый черновик не совпадает с принятым текстом. Проверьте его вручную: расширение не заменяет неизвестный черновик.',
    NATIVE_ACCOUNT_MISMATCH: 'В X открыт другой аккаунт. Переключитесь на профиль из пакета и повторите проверку без отправки.',
    NATIVE_NOT_DUE: 'Дата публикации ещё не наступила. Дождитесь времени, указанного в Planner.',
};
function render(state) {
    for (const id of ['identity', 'uat', 'readiness', 'reconcile']) element(id).disabled = state.busy;
    for (const id of ['package', 'nonce', 'text']) element(id).disabled = state.busy;
    element('run').disabled = !state.canRun;
    element('consent').disabled = !state.canConsent;
    element('consent').checked = state.consent;
    const code = state.result.status;
    const message = labels[code] || `Проверка остановлена (${code}). Проверьте пакет и состояние в Planner. Пост не отправляйте повторно.`;
    if (element('result').textContent !== message) element('result').textContent = message;
    element('installation').hidden = !state.result.installation;
    element('installation').textContent = state.result.installation ? JSON.stringify(state.result.installation, null, 2) : '';
    element('publication').hidden = !state.result.url;
    if (state.result.url) element('publication').href = state.result.url;
    else element('publication').removeAttribute('href');
}
const controller = createController({ send: message => chrome.runtime.sendMessage(message), changed: render });
const edit = () => controller.edit({ packageText: element('package').value, nonce: element('nonce').value, text: element('text').value });
for (const id of ['package', 'nonce', 'text']) element(id).addEventListener('input', edit);
element('consent').addEventListener('change', () => controller.consent(element('consent').checked));
for (const id of ['identity', 'uat', 'readiness', 'run', 'reconcile']) {
    element(id).addEventListener('click', () => controller.perform(id));
}
setInterval(() => render(controller.view()), 250);
render(controller.view());
