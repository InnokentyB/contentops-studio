import { createInstallationKey, localKeyProof } from './key.mjs';
import { verifyBundle } from './bundle.mjs';

function openStore() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('contentops-x-local-key-v1', 1);
        let blocked = false;
        request.onupgradeneeded = () => request.result.createObjectStore('installation');
        request.onsuccess = () => {
            if (blocked) request.result.close();
            else resolve(request.result);
        };
        request.onerror = () => reject(new Error('LOCAL_KEY_STORE_OPEN_FAILED'));
        request.onblocked = () => { blocked = true; reject(new Error('LOCAL_KEY_STORE_BLOCKED')); };
    });
}

async function loadKey(bundleSha256, candidate) {
    if (!/^[a-f0-9]{64}$/.test(bundleSha256 || '')) throw Error('LOCAL_BUNDLE_INVALID');
    const db = await openStore();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction('installation', candidate ? 'readwrite' : 'readonly');
            const store = tx.objectStore('installation');
            let pair;
            const slot = `key:bundle:${bundleSha256}`;
            const read = store.get(slot);
            read.onsuccess = () => {
                pair = read.result;
                if (!pair && candidate) { pair = candidate; store.add(pair, slot); }
            };
            tx.oncomplete = () => resolve(pair);
            tx.onerror = () => reject(new Error('LOCAL_KEY_STORE_TRANSACTION_FAILED'));
            tx.onabort = () => reject(new Error('LOCAL_KEY_STORE_TRANSACTION_ABORTED'));
        });
    } finally { db.close(); }
}

/** Close/reopen IndexedDB; never export the private key or accept a caller challenge. */
export async function checkPersistence() {
    const { bundleSha256 } = await verifyBundle();
    const first = await loadKey(bundleSha256, await createInstallationKey());
    const firstProof = await localKeyProof(first);
    const restored = await loadKey(bundleSha256);
    if (!restored) throw new Error('LOCAL_KEY_NOT_PERSISTED');
    const secondProof = await localKeyProof(restored);
    if (firstProof.fingerprint !== secondProof.fingerprint) throw new Error('LOCAL_KEY_CHANGED');
    return { fingerprint: secondProof.fingerprint, bundleSha256, persisted: true, privateKeyExtractable: restored.privateKey.extractable,
        enrolled: false, publicationAuthorized: false };
}

/** Trusted extension modules only; never exposed through page or external messaging. */
export async function installationKeyPair() {
    const { bundleSha256 } = await verifyBundle();
    return { ...await loadKey(bundleSha256, await createInstallationKey()), bundleSha256 };
}

export async function journal(operation, key, value) {
    if (!['get', 'add', 'put'].includes(operation) || !/^native:(?:(?:flight|release-click):[1-9]\d*:[1-9]\d*:[a-f0-9]{64}|click:[1-9]\d*:[1-9]\d*:[a-f0-9]{64}:[1-9]\d*|index:[1-9]\d*:[1-9]\d*)$/.test(key)) throw new Error('LOCAL_JOURNAL_INVALID');
    const db = await openStore();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction('installation', operation === 'get' ? 'readonly' : 'readwrite');
            const store = tx.objectStore('installation');
            const request = operation === 'get' ? store.get(key) : store[operation](value, key);
            let result;
            request.onsuccess = () => { result = request.result; };
            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(new Error('LOCAL_JOURNAL_CONFLICT'));
            tx.onabort = () => reject(new Error('LOCAL_JOURNAL_ABORTED'));
        });
    } finally { db.close(); }
}
