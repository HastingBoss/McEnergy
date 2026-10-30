import { useState } from 'react';
import {
  X,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Save,
  Zap
} from 'lucide-react';
import { batchSaveReadings, calculateKwh } from '../../services/meterService';

export default function BatchEstimateModal({
  isOpen,
  onClose,
  store,
  year,
  month,
  currentYearData = [],
  prevYearData = [],
  onCompleted
}) {
  if (!isOpen || !store) return null;

  const multiplier = parseFloat(store.meter_multiplier) || 1.0;
  const daysInMonth = new Date(year, month, 0).getDate();
  const padMonth = String(month).padStart(2, '0');

  // Identificar días existentes y calcular promedio diario actual
  const existingReadingsMap = new Map(currentYearData.map((r) => [r.reading_date, r]));
  const prevYearReadingsMap = new Map(prevYearData.map((r) => [r.reading_date, r]));

  const validCurrentConsumptions = currentYearData
    .filter((r) => r.calculated_consumption !== null && r.calculated_consumption > 0)
    .map((r) => parseFloat(r.calculated_consumption));

  const avgDailyKwh = validCurrentConsumptions.length > 0
    ? validCurrentConsumptions.reduce((a, b) => a + b, 0) / validCurrentConsumptions.length
    : (prevYearData.length > 0
        ? prevYearData.reduce((acc, r) => acc + (parseFloat(r.calculated_consumption) || 0), 0) / Math.max(1, prevYearData.length)
        : 600); // Valor fallback razonable si no hay histórico

  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

  // Encontrar fechas del mes y detectar faltantes únicamente hasta ayer inclusive
  const missingDays = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const padDay = String(d).padStart(2, '0');
    const dateStr = `${year}-${padMonth}-${padDay}`;
    if (dateStr <= yesterdayStr && !existingReadingsMap.has(dateStr)) {
      missingDays.push({ day: d, dateStr });
    }
  }

  // Generar propuesta de estimación para cada día faltante
  // Ordenamos lecturas existentes cronológicamente
  const sortedExisting = [...currentYearData].sort((a, b) => a.reading_date.localeCompare(b.reading_date));

  const estimations = missingDays.map(({ day, dateStr }) => {
    // Buscar lectura anterior más cercana
    const prior = [...sortedExisting].reverse().find((r) => r.reading_date < dateStr);
    // Buscar lectura posterior más cercana
    const subsequent = sortedExisting.find((r) => r.reading_date > dateStr);
    // Lectura del año pasado
    const prevYearDateStr = `${year - 1}-${padMonth}-${String(day).padStart(2, '0')}`;
    const pyEntry = prevYearReadingsMap.get(prevYearDateStr);

    let estimatedKwh = Number(avgDailyKwh.toFixed(1));
    let estimatedDisplay = null;
    let method = 'Promedio mensual';

    if (prior && subsequent) {
      // Interpolación lineal
      const priorDate = new Date(prior.reading_date);
      const subDate = new Date(subsequent.reading_date);
      const currDate = new Date(dateStr);

      const totalDays = Math.round((subDate - priorDate) / (1000 * 60 * 60 * 24));
      const daysFromPrior = Math.round((currDate - priorDate) / (1000 * 60 * 60 * 24));

      if (totalDays > 0) {
        const totalDeltaDisplay = parseFloat(subsequent.display_value) - parseFloat(prior.display_value);
        if (totalDeltaDisplay >= 0) {
          const incPerDay = totalDeltaDisplay / totalDays;
          estimatedDisplay = Number((parseFloat(prior.display_value) + incPerDay * daysFromPrior).toFixed(3));
          const totalDeltaKwh = parseFloat(subsequent.kwh_reading) - parseFloat(prior.kwh_reading);
          estimatedKwh = Number((totalDeltaKwh / totalDays).toFixed(1));
          method = 'Interpolación lineal';
        }
      }
    }

    if (estimatedDisplay === null) {
      if (pyEntry && pyEntry.calculated_consumption > 0) {
        estimatedKwh = Number(parseFloat(pyEntry.calculated_consumption).toFixed(1));
        method = `Histórico ${year - 1}`;
      }

      if (prior) {
        const daysFromPrior = Math.max(1, Math.round((new Date(dateStr) - new Date(prior.reading_date)) / (1000 * 60 * 60 * 24)));
        estimatedDisplay = Number((parseFloat(prior.display_value) + (estimatedKwh * daysFromPrior) / multiplier).toFixed(3));
      } else if (subsequent) {
        const daysToSub = Math.max(1, Math.round((new Date(subsequent.reading_date) - new Date(dateStr)) / (1000 * 60 * 60 * 24)));
        estimatedDisplay = Number(Math.max(0, parseFloat(subsequent.display_value) - (estimatedKwh * daysToSub) / multiplier).toFixed(3));
      } else {
        // Sin ancla: base 0 o estimado directo
        estimatedDisplay = Number((estimatedKwh / multiplier).toFixed(3));
      }
    }

    return {
      day,
      dateStr,
      estimatedKwh,
      estimatedDisplay,
      method
    };
  });

  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const handleApplyEstimates = async () => {
    setSaving(true);
    setErrorMessage(null);

    try {
      const recordsToInsert = estimations.map((item) => {
        const numDisplay = item.estimatedDisplay;
        const kwhReading = calculateKwh(numDisplay, multiplier);

        return {
          store_id: store.id,
          reading_date: item.dateStr,
          display_value: numDisplay,
          applied_multiplier: multiplier,
          kwh_reading: kwhReading,
          is_reset: false,
          calculated_consumption: item.estimatedKwh,
          is_estimated: true,
          notes: `Autocompletado masivo (${item.method})`,
          technician_name: 'Autocompletado del Sistema',
          updated_at: new Date().toISOString()
        };
      });

      await batchSaveReadings(recordsToInsert);

      if (onCompleted) onCompleted();
      onClose();
    } catch (err) {
      console.error('Error al guardar estimaciones masivas:', err);
      setErrorMessage('Error al autocompletar: ' + (err.message || 'Error de conexión'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      backdropFilter: 'blur(5px)',
      zIndex: 1100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px'
    }}>
      <div style={{
        backgroundColor: '#1E1E1E',
        border: '1px solid #383838',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '580px',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 20px 40px rgba(0,0,0,0.85)',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Cabecera */}
        <div style={{
          padding: '18px 20px',
          borderBottom: '1px solid #2D2D2D',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#181818',
          borderTopLeftRadius: '16px',
          borderTopRightRadius: '16px'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles color="#FFBC0D" size={20} />
              <h3 style={{ fontSize: '1.15rem', fontWeight: '800', color: '#FFFFFF', margin: 0 }}>
                Autocompletar Días Faltantes
              </h3>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#A0A0A0', margin: '4px 0 0 0' }}>
              {store.name} • Mes {month}/{year}
            </p>
          </div>

          <button
            onClick={onClose}
            style={{
              backgroundColor: '#262626',
              border: 'none',
              color: '#A0A0A0',
              padding: '6px',
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Contenido */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {errorMessage && (
            <div style={{
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid #ef4444',
              borderRadius: '8px',
              padding: '10px 14px',
              color: '#f87171',
              fontSize: '0.82rem'
            }}>
              {errorMessage}
            </div>
          )}

          {missingDays.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#22c55e' }}>
              <CheckCircle2 size={36} style={{ margin: '0 auto 8px' }} />
              <p style={{ fontSize: '0.95rem', fontWeight: '700', color: '#FFFFFF' }}>
                Todos los días están completos
              </p>
              <p style={{ fontSize: '0.8rem', color: '#888' }}>
                No se detectaron días sin registro en este período.
              </p>
            </div>
          ) : (
            <>
              <div style={{
                backgroundColor: '#181E29',
                border: '1px solid #1E3A5F',
                borderRadius: '10px',
                padding: '12px 14px',
                fontSize: '0.82rem',
                color: '#93C5FD'
              }}>
                Se detectaron <strong>{missingDays.length} días sin lectura</strong> en este mes.
                El sistema calculó la estimación óptima para cada uno mediante interpolación lineal o promedio diario.
              </div>

              {/* Lista de estimaciones */}
              <div style={{ maxHeight: '280px', overflowY: 'auto', border: '1px solid #2D2D2D', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#141414', borderBottom: '1px solid #2A2A2A', color: '#888', textAlign: 'left' }}>
                      <th style={{ padding: '8px 10px' }}>Día</th>
                      <th style={{ padding: '8px 10px' }}>Display Estimado</th>
                      <th style={{ padding: '8px 10px' }}>Consumo Estimado</th>
                      <th style={{ padding: '8px 10px' }}>Método</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estimations.map((item) => (
                      <tr key={item.day} style={{ borderBottom: '1px solid #222222' }}>
                        <td style={{ padding: '6px 10px', fontWeight: '700', color: '#FFFFFF' }}>
                          Día {item.day}
                        </td>
                        <td style={{ padding: '6px 10px', color: '#FFBC0D' }}>
                          {item.estimatedDisplay}
                        </td>
                        <td style={{ padding: '6px 10px', color: '#4ade80', fontWeight: '700' }}>
                          {item.estimatedKwh} kWh
                        </td>
                        <td style={{ padding: '6px 10px', color: '#888' }}>
                          {item.method}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p style={{ fontSize: '0.74rem', color: '#888', margin: 0 }}>
                💡 Cada día será guardado con la etiqueta <span style={{ color: '#FFBC0D' }}>[Estimado]</span> para total transparencia contable.
              </p>
            </>
          )}

          {/* Botones */}
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            borderTop: '1px solid #2D2D2D',
            paddingTop: '14px',
            marginTop: '4px'
          }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                backgroundColor: '#262626',
                color: '#CCCCCC',
                padding: '8px 14px',
                fontSize: '0.82rem',
                borderRadius: '8px'
              }}
            >
              Cancelar
            </button>

            {missingDays.length > 0 && (
              <button
                type="button"
                onClick={handleApplyEstimates}
                disabled={saving}
                style={{
                  backgroundColor: '#FFBC0D',
                  color: '#121212',
                  padding: '8px 16px',
                  fontSize: '0.85rem',
                  fontWeight: '800',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <Sparkles size={16} />
                {saving ? 'Cargando...' : `Confirmar y Cargar (${missingDays.length} días)`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
