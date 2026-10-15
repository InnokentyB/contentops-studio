import { checkPersistence } from './store.mjs';
const button = document.getElementById('check');
const output = document.getElementById('result');
button.addEventListener('click', async () => {
    button.disabled = true;
    try { output.textContent = JSON.stringify(await checkPersistence(), null, 2); }
    catch { output.textContent = 'LOCAL_COMPATIBILITY_FAILED. No enrollment or send occurred.'; }
    finally { button.disabled = false; }
});
