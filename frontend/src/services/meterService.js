import { supabase } from './supabaseClient';

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

export async function fetchStoreReadings(storeId, limit = 14) {
  try {
    const { data, error } = await supabase
      .from('meter_readings')
      .select('*')
      .eq('store_id', storeId)
      .order('reading_date', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error fetching store readings:', err);
    return [];
  }
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
    return data;
  } catch (err) {
    console.error(`Error fetching reading for ${dateString}:`, err);
    return null;
  }
}

export async function fetchMonthlyComparison(storeId, year, month) {
  const padMonth = String(month).padStart(2, '0');
  const startDateCurrent = `${year}-${padMonth}-01`;
  const endDateCurrent = `${year}-${padMonth}-31`;

  const prevYear = year - 1;
  const startDatePrev = `${prevYear}-${padMonth}-01`;
  const endDatePrev = `${prevYear}-${padMonth}-31`;

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

    if (currentRes.error) throw currentRes.error;
    if (prevRes.error) throw prevRes.error;

    return {
      currentYearData: currentRes.data || [],
      prevYearData: prevRes.data || []
    };
  } catch (err) {
    console.error('Error fetching monthly comparison:', err);
    return { currentYearData: [], prevYearData: [] };
  }
}

export async function saveMeterReading({
  storeId,
  readingDate,
  displayValue,
  multiplier = 1.0,
  isReset = false,
  notes = '',
  technicianName = ''
}) {
  const numDisplay = parseFloat(displayValue);
  const numMult = parseFloat(multiplier) || 1.0;
  const kwhReading = calculateKwh(numDisplay, numMult);

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
    if (dayDiff > 4) {
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
}

export function formatWhatsAppReport({
  store,
  readingDate,
  displayValue,
  kwhReading,
  consumption,
  prevYearConsumption,
  technicianName,
  notes
}) {
  const [y, m, d] = readingDate.split('-');
  const formattedDate = `${d}/${m}/${y}`;
  const prevYearDate = `${d}/${m}/${Number(y) - 1}`;

  let compText = '';
  if (prevYearConsumption !== null && prevYearConsumption !== undefined) {
    const diff = consumption - prevYearConsumption;
    const pct = prevYearConsumption > 0 ? ((diff / prevYearConsumption) * 100).toFixed(1) : '0';
    const sign = diff > 0 ? '+' : '';
    const icon = diff <= 0 ? '🟢' : '🔴';
    compText = `\n${icon} Comparativa vs ${prevYearDate}: ${sign}${diff.toFixed(2)} kWh (${sign}${pct}%)`;
  }

  const multText = store.meter_multiplier && store.meter_multiplier !== 1
    ? `\n⚙️ Medidor: ${store.meter_model || 'Standard'} (TC x${store.meter_multiplier})`
    : `\n⚙️ Medidor: ${store.meter_model || 'Lectura Directa'}`;

  const notesText = notes ? `\n📝 Observaciones: ${notes}` : '';

  return (
    `*Reporte Eléctrico - McDonald's ${store.name}*\n` +
    `📅 Fecha: ${formattedDate} (12:00 PM)\n` +
    `🔢 Display: ${displayValue} [${store.display_indicator || 'kWh'}]` +
    multText +
    `\n⚡ Total acumulado: ${kwhReading.toLocaleString('es-AR')} kWh\n` +
    `📊 Consumo 24h: *${consumption !== null ? consumption.toLocaleString('es-AR') : 'Primer registro'} kWh*` +
    compText +
    (technicianName ? `\n👨‍🔧 Técnico: ${technicianName}` : '') +
    notesText
  );
}
