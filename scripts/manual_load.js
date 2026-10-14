import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });

const supabaseUrl = process.env.SUPABASE_URL || 'https://qdykuqzbkhljamacfxdq.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Carga o corrige un lote de lecturas manuales en Supabase.
 * El trigger de PostgreSQL recalcula automáticamente los kWh y consumos diarios
 * para la fecha y el día posterior.
 *
 * Formato:
 *   code: Código del local ('AR3', 'AR6', 'DEN', 'DEV', 'MTD')
 *   date: Fecha en formato 'YYYY-MM-DD'
 *   displayValue: Valor crudo del display del medidor
 *   isReset: (Opcional) true si es lectura de partida o cambio de medidor
 */
const READINGS_TO_LOAD = [
  // Ejemplo:
  // { code: 'MTD', date: '2026-10-10', displayValue: 27550.0 },
  // { code: 'MTD', date: '2026-10-11', displayValue: 27572.5 },
  // { code: 'MTD', date: '2026-10-12', displayValue: 27600.0 }
];

async function runManualLoad() {
  if (READINGS_TO_LOAD.length === 0) {
    console.log('No hay lecturas en READINGS_TO_LOAD. Edita el archivo scripts/manual_load.js para agregar datos.');
    return;
  }

  // Obtener locales
  const { data: stores, error: storeErr } = await supabase.from('stores').select('id, code, meter_multiplier');
  if (storeErr) throw storeErr;

  const storeMap = new Map(stores.map((s) => [s.code, s]));

  console.log(`Iniciando carga de ${READINGS_TO_LOAD.length} lecturas...`);

  for (const item of READINGS_TO_LOAD) {
    const store = storeMap.get(item.code.toUpperCase());
    if (!store) {
      console.error(`[Error] Local no encontrado para código: ${item.code}`);
      continue;
    }

    const multiplier = parseFloat(store.meter_multiplier) || 1.0;
    const numDisplay = parseFloat(item.displayValue);
    const kwhReading = Number((numDisplay * multiplier).toFixed(3));

    const payload = {
      store_id: store.id,
      reading_date: item.date,
      display_value: numDisplay,
      applied_multiplier: multiplier,
      kwh_reading: kwhReading,
      is_reset: item.isReset || false,
      technician_name: 'Carga Manual / Corrección',
      notes: item.notes || 'Ajuste manual retroactivo'
    };

    const { data, error } = await supabase
      .from('meter_readings')
      .upsert(payload, { onConflict: 'store_id,reading_date' })
      .select('reading_date, display_value, kwh_reading, calculated_consumption')
      .single();

    if (error) {
      console.error(`✗ Error en ${item.code} [${item.date}]:`, error.message);
    } else {
      console.log(`✓ ${item.code} [${data.reading_date}]: Display=${data.display_value} | kWh=${data.kwh_reading} | Consumo=${data.calculated_consumption ?? '-'}`);
    }
  }

  console.log('\nProceso finalizado. Los triggers de PostgreSQL recalcularon consumos y días subsecuentes.');
}

runManualLoad().catch(console.error);
