/**
 * McEnergy Offline Sync Service
 * Almacenamiento local con IndexedDB y sincronización automática en segundo plano
 * para salas de tableros y subsuelos técnicos sin señal de red.
 */

const DB_NAME = 'mcenergy_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'pending_readings';

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB no está disponible en este entorno.'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Guarda una lectura pendiente de sincronización en IndexedDB */
export async function savePendingReading(payload) {
  const db = await openDB();
  const id = `${payload.storeId}_${payload.readingDate}`;
  const record = {
    id,
    ...payload,
    savedAt: new Date().toISOString(),
    synced: false
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);

    req.onsuccess = () => {
      notifySyncChange();
      requestBackgroundSync();
      resolve(record);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Obtiene todas las lecturas pendientes de sincronización */
export async function getPendingReadings() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Error leyendo lecturas pendientes de IndexedDB:', err);
    return [];
  }
}

/** Obtiene lectura pendiente de una fecha y local específico si existe */
export async function getPendingReadingForDate(storeId, readingDate) {
  try {
    const db = await openDB();
    const id = `${storeId}_${readingDate}`;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/** Elimina una lectura sincronizada exitosamente */
export async function removePendingReading(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);

    req.onsuccess = () => {
      notifySyncChange();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

/** Cantidad de registros pendientes de sincronizar */
export async function getPendingCount() {
  const items = await getPendingReadings();
  return items.length;
}

/** Registra Background Sync en el Service Worker si está soportado */
async function requestBackgroundSync() {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'SyncManager' in window) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register('sync-meter-readings');
    } catch (err) {
      console.warn('Background sync no soportado o denegado, se usará listener online:', err);
    }
  }
}

// Emisor de eventos para que la UI reaccione ante cambios en cola offline
const SYNC_EVENT_NAME = 'mcenergy-offline-sync-change';

function notifySyncChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SYNC_EVENT_NAME));
  }
}

export function subscribeToSyncChanges(callback) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(SYNC_EVENT_NAME, callback);
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener(SYNC_EVENT_NAME, callback);
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

/** Sincroniza todas las lecturas pendientes enviándolas a Supabase */
let isSyncing = false;
export async function syncAllPendingReadings(saveFunction) {
  if (isSyncing || typeof navigator === 'undefined' || !navigator.onLine) {
    return { syncedCount: 0, pendingCount: await getPendingCount() };
  }

  isSyncing = true;
  notifySyncChange();

  const pending = await getPendingReadings();
  let syncedCount = 0;

  for (const item of pending) {
    try {
      await saveFunction({
        storeId: item.storeId,
        readingDate: item.readingDate,
        displayValue: item.displayValue,
        multiplier: item.multiplier,
        isReset: item.isReset,
        isEstimated: item.isEstimated,
        notes: item.notes,
        technicianName: item.technicianName,
        _skipOfflineFallback: true // Evita loop en caso de error
      });
      await removePendingReading(item.id);
      syncedCount++;
    } catch (err) {
      console.error(`Error sincronizando lectura offline ${item.id}:`, err);
    }
  }

  isSyncing = false;
  notifySyncChange();

  return {
    syncedCount,
    pendingCount: await getPendingCount()
  };
}

export function isCurrentlySyncing() {
  return isSyncing;
}

