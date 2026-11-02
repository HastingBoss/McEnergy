import { supabase } from './supabaseClient';
import {
  savePendingReading,
  getPendingReadings,
  getPendingReadingForDate,
  syncAllPendingReadings
} from './offlineSyncService';

// Auto-sincronizar lecturas pendientes apenas el dispositivo recupera señal de red
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    syncAllPendingReadings(saveMeterReading);
  });
}

export function calculateKwh(displayValue, multiplier) {
  const val = parseFloat(displayValue) || 0;
  const mult = parseFloat(multiplier) || 1.0;
  return Number((val * mult).toFixed(3));
}

export function calculateConsumption(currentKwh, prevKwh, isReset = false, dayDiff = 1) {
  if (isReset || prevKwh === null || prevKwh === undefined || dayDiff > 4) {
    return null;
  }
  const diff = currentKwh - prevKwh;
  return Number(Math.max(0, diff).toFixed(3));
}

export function getPreviousYearDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  const prevYear = year - 1;
  // Manejo de año bisiesto si fuera 29 de febrero
  const safeDay = (month === 2 && day === 29) ? 28 : day;
  return `${prevYear}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

export async function fetchReadingForDate(storeId, dateString) {
  try {
    const { data, error } = await supabase
      .from('meter_readings')
      .select('*')
      .eq('store_id', storeId)
      .eq('reading_date', dateString)
      .maybeSingle();

    if (error) throw error;
    if (data) return data;
  } catch (err) {
    console.warn(`Error fetching reading for ${dateString} from Supabase, checking offline storage:`, err);
  }

  // Fallback a lectura pendiente en IndexedDB si no hay red o no se encontró en Supabase
  const pending = await getPendingReadingForDate(storeId, dateString);
  if (pending) {
    return {
      id: pending.id,
      store_id: pending.storeId,
      reading_date: pending.readingDate,
      display_value: pending.displayValue,
      applied_multiplier: pending.multiplier,
      kwh_reading: calculateKwh(pending.displayValue, pending.multiplier),
      is_reset: pending.isReset,
      calculated_consumption: null,
      is_estimated: pending.isEstimated,
      notes: pending.notes,
      technician_name: pending.technicianName,
      is_pending_sync: true,
      _isOffline: true
    };
  }

  return null;
}

export async function fetchStoreDailyAverage(storeId, days = 30) {
  try {
    const { data, error } = await supabase
      .from('meter_readings')
      .select('calculated_consumption')
      .eq('store_id', storeId)
      .not('calculated_consumption', 'is', null)
      .gt('calculated_consumption', 0)
      .order('reading_date', { ascending: false })
      .limit(days);

    if (error) throw error;
    if (!data || data.length === 0) return 0;
    const total = data.reduce((acc, row) => acc + (parseFloat(row.calculated_consumption) || 0), 0);
    return Number((total / data.length).toFixed(1));
  } catch (err) {
    console.warn('Error fetching store daily average:', err);
    return 0;
  }
}

export async function fetchStoreReadings(storeId, limit = 14) {
  let list = [];
  try {
    const { data, error } = await supabase
      .from('meter_readings')
      .select('*')
      .eq('store_id', storeId)
      .order('reading_date', { ascending: false })
      .limit(limit);

    if (error) throw error;
    list = data || [];
  } catch (err) {
    console.warn('Error fetching store readings from Supabase, checking offline:', err);
  }

  // Fusionar lecturas pendientes de sincronización
  try {
    const pendingList = await getPendingReadings();
    const relevant = pendingList.filter((p) => p.storeId === storeId);
    for (const pending of relevant) {
      const existingIdx = list.findIndex((r) => r.reading_date === pending.readingDate);
      const formatted = {
        id: pending.id,
        store_id: pending.storeId,
        reading_date: pending.readingDate,
        display_value: pending.displayValue,
        applied_multiplier: pending.multiplier,
        kwh_reading: calculateKwh(pending.displayValue, pending.multiplier),
        is_reset: pending.isReset,
        calculated_consumption: null,
        is_estimated: pending.isEstimated,
        notes: pending.notes,
        technician_name: pending.technicianName,
        is_pending_sync: true,
        _isOffline: true
      };
      if (existingIdx >= 0) {
        list[existingIdx] = formatted;
      } else {
        list.unshift(formatted);
      }
    }
  } catch (e) {
    console.warn('Error merging pending readings in fetchStoreReadings:', e);
  }

  return list;
}

export async function fetchMonthlyComparison(storeId, year, month) {
  const padMonth = String(month).padStart(2, '0');
  const lastDayCurrent = new Date(year, month, 0).getDate();
  const startDateCurrent = `${year}-${padMonth}-01`;
  const endDateCurrent = `${year}-${padMonth}-${String(lastDayCurrent).padStart(2, '0')}`;

  const prevYear = year - 1;
  const lastDayPrev = new Date(prevYear, month, 0).getDate();
  const startDatePrev = `${prevYear}-${padMonth}-01`;
  const endDatePrev = `${prevYear}-${padMonth}-${String(lastDayPrev).padStart(2, '0')}`;

  let currentYearData = [];
  let prevYearData = [];

  try {
    const [currentRes, prevRes] = await Promise.all([
      supabase
        .from('meter_readings')
        .select('*')
        .eq('store_id', storeId)
        .gte('reading_date', startDateCurrent)
        .lte('reading_date', endDateCurrent)
        .order('reading_date', { ascending: true }),
      supabase
        .from('meter_readings')
        .select('*')
        .eq('store_id', storeId)
        .gte('reading_date', startDatePrev)
        .lte('reading_date', endDatePrev)
        .order('reading_date', { ascending: true })
    ]);

    if (!currentRes.error) currentYearData = currentRes.data || [];
    if (!prevRes.error) prevYearData = prevRes.data || [];
  } catch (err) {
    console.warn('Error fetching monthly comparison from Supabase:', err);
  }

  // Fusionar lecturas pendientes de este mes
  try {
    const pendingList = await getPendingReadings();
    const relevant = pendingList.filter(
      (p) => p.storeId === storeId && p.readingDate >= startDateCurrent && p.readingDate <= endDateCurrent
    );

    for (const pending of relevant) {
      const existingIdx = currentYearData.findIndex((r) => r.reading_date === pending.readingDate);
      const formatted = {
        id: pending.id,
        store_id: pending.storeId,
        reading_date: pending.readingDate,
        display_value: pending.displayValue,
        applied_multiplier: pending.multiplier,
        kwh_reading: calculateKwh(pending.displayValue, pending.multiplier),
        is_reset: pending.isReset,
        calculated_consumption: null,
        is_estimated: pending.isEstimated,
        notes: pending.notes,
        technician_name: pending.technicianName,
        is_pending_sync: true,
        _isOffline: true
      };
      if (existingIdx >= 0) {
        currentYearData[existingIdx] = formatted;
      } else {
        currentYearData.push(formatted);
        currentYearData.sort((a, b) => a.reading_date.localeCompare(b.reading_date));
      }
    }
  } catch (e) {
    console.warn('Error merging pending readings in comparison:', e);
  }

  return { currentYearData, prevYearData };
}

export async function saveMeterReading({
  storeId,
  readingDate,
  displayValue,
  multiplier = 1.0,
  isReset = false,
  isEstimated = false,
  notes = '',
  technicianName = '',
  _skipOfflineFallback = false
}) {
  const todayStr = new Date().toISOString().split('T')[0];
  if (readingDate > todayStr) {
    throw new Error('No es posible registrar ni modificar lecturas en fechas futuras.');
  }

  const numDisplay = parseFloat(displayValue);
  const numMult = parseFloat(multiplier) || 1.0;
  const kwhReading = calculateKwh(numDisplay, numMult);

  // Si no hay conexión de red, guardar directamente en la cola offline de IndexedDB
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
  if (isOffline && !_skipOfflineFallback) {
    const offlineRecord = await savePendingReading({
      storeId,
      readingDate,
      displayValue: numDisplay,
      multiplier: numMult,
      isReset,
      isEstimated,
      notes,
      technicianName
    });

    return {
      id: offlineRecord.id,
      store_id: storeId,
      reading_date: readingDate,
      display_value: numDisplay,
      applied_multiplier: numMult,
      kwh_reading: kwhReading,
      is_reset: isReset,
      calculated_consumption: null,
      is_estimated: isEstimated,
      notes,
      technician_name: technicianName,
      _isOffline: true,
      is_pending_sync: true
    };
  }

  try {
    // Buscar lectura anterior más reciente
    const { data: previousEntries } = await supabase
      .from('meter_readings')
      .select('reading_date, kwh_reading')
      .eq('store_id', storeId)
      .lt('reading_date', readingDate)
      .order('reading_date', { ascending: false })
      .limit(1);

    let effectiveReset = isReset;
    let dayDiff = 1;

    if (previousEntries && previousEntries[0]) {
      const prevDate = new Date(previousEntries[0].reading_date);
      const currDate = new Date(readingDate);
      dayDiff = Math.max(1, Math.round((currDate - prevDate) / (1000 * 60 * 60 * 24)));
      if (dayDiff > 4 && !isEstimated) {
        effectiveReset = true;
      }
    }

    const prevKwh = previousEntries && previousEntries[0] ? previousEntries[0].kwh_reading : null;
    const calculatedConsumption = calculateConsumption(kwhReading, prevKwh, effectiveReset, dayDiff);

    const payload = {
      store_id: storeId,
      reading_date: readingDate,
      display_value: numDisplay,
      applied_multiplier: numMult,
      kwh_reading: kwhReading,
      is_reset: effectiveReset,
      calculated_consumption: calculatedConsumption,
      is_estimated: !!isEstimated,
      notes: notes || null,
      technician_name: technicianName || null,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('meter_readings')
      .upsert(payload, { onConflict: 'store_id,reading_date' })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    // Si la llamada falló por corte de señal, guardar en IndexedDB para no perder la lectura
    const isNetworkError =
      (typeof navigator !== 'undefined' && !navigator.onLine) ||
      err?.message?.includes('Failed to fetch') ||
      err?.message?.includes('NetworkError') ||
      err?.message?.includes('network') ||
      err?.name === 'TypeError';

    if (isNetworkError && !_skipOfflineFallback) {
      console.warn('Fallo de red al conectar con Supabase. Guardando lectura en IndexedDB:', err);
      const offlineRecord = await savePendingReading({
        storeId,
        readingDate,
        displayValue: numDisplay,
        multiplier: numMult,
        isReset,
        isEstimated,
        notes,
        technicianName
      });

      return {
        id: offlineRecord.id,
        store_id: storeId,
        reading_date: readingDate,
        display_value: numDisplay,
        applied_multiplier: numMult,
        kwh_reading: kwhReading,
        is_reset: isReset,
        calculated_consumption: null,
        is_estimated: isEstimated,
        notes,
        technician_name: technicianName,
        _isOffline: true,
        is_pending_sync: true
      };
    }

    throw err;
  }
}

export async function deleteMeterReading(storeId, readingDate) {
  // Buscar lectura posterior antes de borrar
  const { data: subsequent } = await supabase
    .from('meter_readings')
    .select('id, reading_date, kwh_reading')
    .eq('store_id', storeId)
    .gt('reading_date', readingDate)
    .order('reading_date', { ascending: true })
    .limit(1);

  // Buscar lectura previa antes de borrar
  const { data: prior } = await supabase
    .from('meter_readings')
    .select('id, reading_date, kwh_reading')
    .eq('store_id', storeId)
    .lt('reading_date', readingDate)
    .order('reading_date', { ascending: false })
    .limit(1);

  const { error } = await supabase
    .from('meter_readings')
    .delete()
    .eq('store_id', storeId)
    .eq('reading_date', readingDate);

  if (error) throw error;

  // Recalcular lectura subsiguiente si existía
  if (subsequent && subsequent[0]) {
    const nextItem = subsequent[0];
    if (prior && prior[0]) {
      const prevItem = prior[0];
      const prevDate = new Date(prevItem.reading_date);
      const nextDate = new Date(nextItem.reading_date);
      const dayDiff = Math.max(1, Math.round((nextDate - prevDate) / (1000 * 60 * 60 * 24)));

      if (dayDiff <= 4) {
        const newCons = Math.max(0, nextItem.kwh_reading - prevItem.kwh_reading);
        await supabase
          .from('meter_readings')
          .update({
            calculated_consumption: newCons,
            reading_days: dayDiff,
            is_reset: false,
            updated_at: new Date().toISOString()
          })
          .eq('id', nextItem.id);
      } else {
        await supabase
          .from('meter_readings')
          .update({
            calculated_consumption: null,
            reading_days: 1,
            is_reset: true,
            updated_at: new Date().toISOString()
          })
          .eq('id', nextItem.id);
      }
    } else {
      await supabase
        .from('meter_readings')
        .update({
          calculated_consumption: null,
          reading_days: 1,
          is_reset: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', nextItem.id);
    }
  }

  return true;
}

export async function getEstimationContext(storeId, targetDate, multiplier = 1.0, currentMonthReadings = []) {
  const mult = parseFloat(multiplier) || 1.0;

  // Lectura anterior más cercana
  const prevPromise = supabase
    .from('meter_readings')
    .select('*')
    .eq('store_id', storeId)
    .lt('reading_date', targetDate)
    .order('reading_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Lectura posterior más cercana
  const nextPromise = supabase
    .from('meter_readings')
    .select('*')
    .eq('store_id', storeId)
    .gt('reading_date', targetDate)
    .order('reading_date', { ascending: true })
    .limit(1)
    .maybeSingle();

  // Lectura del mismo día año anterior
  const prevYearDate = getPreviousYearDate(targetDate);
  const prevYearPromise = supabase
    .from('meter_readings')
    .select('*')
    .eq('store_id', storeId)
    .eq('reading_date', prevYearDate)
    .maybeSingle();

  const [prevRes, nextRes, prevYearRes] = await Promise.all([
    prevPromise,
    nextPromise,
    prevYearPromise
  ]);

  const prevReading = prevRes.data || null;
  const nextReading = nextRes.data || null;
  const prevYearReading = prevYearRes.data || null;

  // Promedio diario del mes actual
  const validCurrentConsumptions = (currentMonthReadings || [])
    .filter((r) => r.calculated_consumption !== null && r.calculated_consumption > 0 && r.reading_date !== targetDate)
    .map((r) => parseFloat(r.calculated_consumption));

  let avgDailyKwh = 0;
  if (validCurrentConsumptions.length > 0) {
    avgDailyKwh = validCurrentConsumptions.reduce((a, b) => a + b, 0) / validCurrentConsumptions.length;
  }

  // SUGERENCIA 1: Interpolación lineal entre lectura anterior y posterior
  let interpolationSuggestion = null;
  if (prevReading && nextReading) {
    const prevDate = new Date(prevReading.reading_date);
    const nextDate = new Date(nextReading.reading_date);
    const currDate = new Date(targetDate);

    const totalDays = Math.round((nextDate - prevDate) / (1000 * 60 * 60 * 24));
    const daysFromPrev = Math.round((currDate - prevDate) / (1000 * 60 * 60 * 24));

    if (totalDays > 0 && daysFromPrev > 0 && daysFromPrev < totalDays) {
      const totalDisplayDelta = parseFloat(nextReading.display_value) - parseFloat(prevReading.display_value);
      if (totalDisplayDelta >= 0) {
        const dailyDisplayInc = totalDisplayDelta / totalDays;
        const suggestedDisplay = Number((parseFloat(prevReading.display_value) + dailyDisplayInc * daysFromPrev).toFixed(3));
        const totalKwhDelta = parseFloat(nextReading.kwh_reading) - parseFloat(prevReading.kwh_reading);
        const dailyKwh = Number((totalKwhDelta / totalDays).toFixed(1));

        interpolationSuggestion = {
          displayValue: suggestedDisplay,
          dailyKwh,
          totalDays,
          daysFromPrev,
          prevDate: prevReading.reading_date,
          nextDate: nextReading.reading_date,
          prevDisplay: prevReading.display_value,
          nextDisplay: nextReading.display_value
        };
      }
    }
  }

  // SUGERENCIA 2: Promedio diario del mes
  let avgSuggestion = null;
  if (avgDailyKwh > 0) {
    let suggestedDisplay = null;
    if (prevReading) {
      const daysFromPrev = Math.max(1, Math.round((new Date(targetDate) - new Date(prevReading.reading_date)) / (1000 * 60 * 60 * 24)));
      suggestedDisplay = Number((parseFloat(prevReading.display_value) + (avgDailyKwh * daysFromPrev) / mult).toFixed(3));
    } else if (nextReading) {
      const daysToNext = Math.max(1, Math.round((new Date(nextReading.reading_date) - new Date(targetDate)) / (1000 * 60 * 60 * 24)));
      suggestedDisplay = Number(Math.max(0, parseFloat(nextReading.display_value) - (avgDailyKwh * daysToNext) / mult).toFixed(3));
    }

    avgSuggestion = {
      dailyKwh: Number(avgDailyKwh.toFixed(1)),
      displayValue: suggestedDisplay
    };
  }

  // SUGERENCIA 3: Mismo día del año anterior
  let prevYearSuggestion = null;
  if (prevYearReading && prevYearReading.calculated_consumption > 0) {
    const pyKwh = parseFloat(prevYearReading.calculated_consumption);
    let suggestedDisplay = null;
    if (prevReading) {
      suggestedDisplay = Number((parseFloat(prevReading.display_value) + pyKwh / mult).toFixed(3));
    } else if (nextReading) {
      suggestedDisplay = Number(Math.max(0, parseFloat(nextReading.display_value) - pyKwh / mult).toFixed(3));
    }

    prevYearSuggestion = {
      dailyKwh: Number(pyKwh.toFixed(1)),
      displayValue: suggestedDisplay,
      prevYearDate
    };
  }

  return {
    prevReading,
    nextReading,
    prevYearReading,
    avgDailyKwh,
    interpolationSuggestion,
    avgSuggestion,
    prevYearSuggestion
  };
}

export async function batchSaveReadings(readings) {
  if (!readings || readings.length === 0) return [];
  const { data, error } = await supabase
    .from('meter_readings')
    .upsert(readings, { onConflict: 'store_id,reading_date' })
    .select();
  if (error) throw error;
  return data;
}

export function formatWhatsAppReport({
  store,
  readingDate,
  displayValue
}) {
  const [y, m, d] = readingDate.split('-');
  const formattedDate = `${d}/${m}/${y}`;
  const storeName = store.name.toLowerCase().includes("mcdonald's")
    ? store.name
    : `McDonald's ${store.name}`;

  return (
    `*Reporte Eléctrico - ${storeName}*\n` +
    `📅 Fecha: ${formattedDate} (12:00 PM)\n` +
    `🔢 Display: ${displayValue}`
  );
}
