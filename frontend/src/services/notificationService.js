// Servicio de Notificaciones Web Push y Recordatorios Locales de Guardia
const EARLY_GUARD_STORES = ['AR3', 'AR6', 'DEV'];

/**
 * Obtiene el cronograma de guardia según el código del local.
 * AR3, AR6 y DEV realizan guardia a las 10:00 AM (recordatorio 10:15 AM).
 * El resto de los locales a las 12:00 PM (recordatorio 12:15 PM).
 */
export function getStoreGuardSchedule(storeCode) {
  const isEarly = EARLY_GUARD_STORES.includes(String(storeCode || '').toUpperCase());
  return {
    isEarly,
    guardHourStr: isEarly ? '10:00 AM' : '12:00 PM',
    reminderHour: isEarly ? 10 : 12,
    reminderMinute: 15,
    reminderTimeStr: isEarly ? '10:15 AM' : '12:15 PM'
  };
}

/**
 * Estado actual de permisos de notificación
 */
export function getNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

/**
 * Solicita permisos de notificación al usuario
 */
export async function requestNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }

  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch (err) {
    console.error('Error al solicitar permisos de notificación:', err);
    return 'denied';
  }
}

/**
 * Emite la notificación de guardia utilizando el Service Worker o API Notification nativa
 */
export async function dispatchGuardReminder(store, schedule, isTest = false) {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  if (Notification.permission !== 'granted') {
    return false;
  }

  const title = isTest
    ? `🔔 Notificaciones Activas — McDonald's ${store?.code || ''}`
    : `⚡ Recordatorio de Guardia — McDonald's ${store?.code || ''}`;

  const body = isTest
    ? `Recibirás recordatorios automáticos a las ${schedule.reminderTimeStr} si no se ha registrado la lectura de guardia.`
    : `Son las ${schedule.reminderTimeStr}. Aún no se registró la lectura de guardia de ${schedule.guardHourStr} para ${store?.name || 'el local'}.`;

  const options = {
    body,
    icon: '/favicon.png',
    badge: '/favicon.png',
    tag: isTest ? `guard-test-${store?.id || 'demo'}` : `guard-reminder-${store?.id || 'demo'}`,
    renotify: true,
    requireInteraction: false,
    data: {
      url: '/',
      storeId: store?.id
    }
  };

  // 1. Intentar mediante Service Worker registration (soporta background en móviles y PWA instalada)
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) {
        await reg.showNotification(title, options);
        return true;
      }
    } catch (e) {
      console.warn('Fallo al disparar notificación mediante Service Worker:', e);
    }
  }

  // 2. Fallback a Notification de navegador
  try {
    new Notification(title, options);
    return true;
  } catch (e) {
    console.warn('Fallo al disparar Notification nativa:', e);
    return false;
  }
}

/**
 * Evalúa si debe dispararse el recordatorio en el día actual
 */
export async function checkAndTriggerGuardReminder(store, todayReading) {
  if (!store || !store.id) return false;
  if (getNotificationPermission() !== 'granted') return false;

  // Si hoy ya tiene lectura registrada, no recordar
  if (todayReading && todayReading.display_value) {
    return false;
  }

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const storageKey = `mcd_notified_${store.id}_${todayStr}`;

  // Si ya fue notificado hoy para este local, evitar spam
  if (localStorage.getItem(storageKey)) {
    return false;
  }

  const schedule = getStoreGuardSchedule(store.code);
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // Comprobar si ya pasó la hora límite de recordatorio (10:15 AM o 12:15 PM)
  const isPastReminderTime =
    currentHour > schedule.reminderHour ||
    (currentHour === schedule.reminderHour && currentMinute >= schedule.reminderMinute);

  if (isPastReminderTime) {
    const success = await dispatchGuardReminder(store, schedule, false);
    if (success) {
      localStorage.setItem(storageKey, 'true');
      return true;
    }
  }

  return false;
}

