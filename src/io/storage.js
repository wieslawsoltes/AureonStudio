let database;
function open() {
    if (database)
        return database;
    database = new Promise((resolve, reject) => {
        const request = indexedDB.open('aureon-studio', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('documents');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    return database;
}
export async function saveRecovery(doc) {
    const db = await open();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('documents', 'readwrite');
        tx.objectStore('documents').put({ document: structuredClone(doc), saved: new Date().toISOString() }, 'recovery');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}
export async function loadRecovery() {
    const db = await open();
    return new Promise((resolve, reject) => {
        const r = db.transaction('documents').objectStore('documents').get('recovery');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
}
