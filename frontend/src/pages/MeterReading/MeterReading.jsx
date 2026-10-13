import { useState, useEffect } from 'react';
import {
  Zap,
  Building2,
  CheckCircle2,
  AlertTriangle,
  Edit3,
  UploadCloud,
  Send,
  Clock,
  ArrowDownRight,
  ArrowUpRight,
  HelpCircle
} from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import {
  calculateKwh,
  calculateConsumption,
  getPreviousYearDate,
  fetchStoreReadings,
  fetchReadingForDate,
  saveMeterReading,
  formatWhatsAppReport
} from '../../services/meterService';

export default function MeterReading() {
  const { stores, currentStore, setCurrentStore } = useStore();

  const todayStr = new Date().toISOString().split('T')[0];
  const [displayValue, setDisplayValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [showConfirmUpload, setShowConfirmUpload] = useState(false);
  const [showConfirmEdit, setShowConfirmEdit] = useState(false);

  const [todayReading, setTodayReading] = useState(null);
  const [previousReading, setPreviousReading] = useState(null);
  const [prevYearReading, setPrevYearReading] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  const multiplier = currentStore?.meter_multiplier || 1.0;

  useEffect(() => {
    if (currentStore?.id) {
      loadDataForCurrentStore();
    }
  }, [currentStore?.id]);

  const loadDataForCurrentStore = async () => {
    if (!currentStore?.id) return;
    setLoading(true);
    setStatusMessage(null);
    setIsEditing(false);
    setShowConfirmUpload(false);
    setShowConfirmEdit(false);

    try {
      const [readingsList, currentEntry, lastYearEntry] = await Promise.all([
        fetchStoreReadings(currentStore.id, 7),
        fetchReadingForDate(currentStore.id, todayStr),
        fetchReadingForDate(currentStore.id, getPreviousYearDate(todayStr))
      ]);

      setHistory(readingsList);
      setTodayReading(currentEntry);
      setPrevYearReading(lastYearEntry);

      if (currentEntry) {
        setDisplayValue(String(currentEntry.display_value));
      } else {
        setDisplayValue('');
      }

      const prev = readingsList.find((r) => r.reading_date < todayStr);
      setPreviousReading(prev || null);
    } catch (err) {
      console.error('Error al cargar datos del local:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStoreChange = (e) => {
    const selected = stores.find((s) => s.id === e.target.value);
    if (selected) {
      setCurrentStore(selected);
    }
  };

  // Solo números y máximo un punto decimal
  const handleNumericChange = (e) => {
    const raw = e.target.value;
    const sanitized = raw.replace(/[^0-9.]/g, '');
    const parts = sanitized.split('.');
    const formatted = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : sanitized;
    setDisplayValue(formatted);
  };

  const numericVal = parseFloat(displayValue) || 0;
  const currentKwh = calculateKwh(numericVal, multiplier);
  const prevKwh = previousReading ? previousReading.kwh_reading : null;
  const estimatedConsumption = calculateConsumption(currentKwh, prevKwh, false);

  const lastYearConsumption = prevYearReading?.calculated_consumption ?? null;
  const diffVsLastYear = (estimatedConsumption !== null && lastYearConsumption !== null)
    ? estimatedConsumption - lastYearConsumption
    : null;
  const diffVsLastYearPct = (diffVsLastYear !== null && lastYearConsumption > 0)
    ? ((diffVsLastYear / lastYearConsumption) * 100).toFixed(1)
    : null;

  // Acción Cargar -> abre confirmación
  const handleOpenUploadConfirm = (e) => {
    e.preventDefault();
    if (!displayValue || isNaN(numericVal) || numericVal <= 0) {
      setStatusMessage({ type: 'error', text: 'Ingresa un valor numérico válido mayor a 0.' });
      return;
    }
    setShowConfirmUpload(true);
  };

  // Ejecutar Guardar
  const handleExecuteSave = async () => {
    setLoading(true);
    setStatusMessage(null);
    setShowConfirmUpload(false);

    try {
      const saved = await saveMeterReading({
        storeId: currentStore.id,
        readingDate: todayStr,
        displayValue: numericVal,
        multiplier,
        isReset: false,
        technicianName: 'Técnico de Guardia'
      });

      setTodayReading(saved);
      setIsEditing(false);
      setStatusMessage({ type: 'success', text: `Lectura registrada exitosamente: ${numericVal} en ${currentStore.name}.` });
      await loadDataForCurrentStore();
    } catch (err) {
      setStatusMessage({ type: 'error', text: err.message || 'Error al guardar la lectura.' });
    } finally {
      setLoading(false);
    }
  };

  // Acción Editar -> abre confirmación
  const handleOpenEditConfirm = () => {
    setShowConfirmEdit(true);
  };

  const handleExecuteEdit = () => {
    setShowConfirmEdit(false);
    setIsEditing(true);
    if (todayReading) {
      setDisplayValue(String(todayReading.display_value));
    }
  };

  const handleShareWhatsApp = () => {
    if (!currentStore || !todayReading) return;
    const text = formatWhatsAppReport({
      store: currentStore,
      readingDate: todayStr,
      displayValue: todayReading.display_value,
      kwhReading: todayReading.kwh_reading,
      consumption: todayReading.calculated_consumption,
      prevYearConsumption: lastYearConsumption,
      technicianName: todayReading.technician_name || 'Técnico',
      notes: todayReading.notes || ''
    });

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const isRegisteredState = Boolean(todayReading) && !isEditing;

  return (
    <div style={{ padding: '16px', maxWidth: '580px', margin: '0 auto', paddingBottom: '90px' }}>
      {/* Selector de los 5 Locales */}
      <div style={{ marginBottom: '14px' }}>
        <label style={{ fontSize: '0.8rem', color: '#A0A0A0', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
          <Building2 size={15} color="#FFBC0D" /> Local Seleccionado
        </label>
        <select
          value={currentStore?.id || ''}
          onChange={handleStoreChange}
          disabled={loading}
          style={{
            fontSize: '1rem',
            fontWeight: '700',
            backgroundColor: '#1E1E1E',
            border: '2px solid #FFBC0D',
            color: '#FFFFFF',
            borderRadius: '10px',
            padding: '12px 14px'
          }}
        >
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.code}) — {s.meter_model || 'Medidor'} {s.meter_multiplier > 1 ? `[TC x${s.meter_multiplier}]` : ''}
            </option>
          ))}
        </select>
      </div>

      {statusMessage && (
        <div style={{
          padding: '12px 14px',
          borderRadius: '8px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: statusMessage.type === 'success' ? '#143823' : '#3b1212',
          color: statusMessage.type === 'success' ? '#86efac' : '#fca5a5',
          border: `1px solid ${statusMessage.type === 'success' ? '#22c55e' : '#ef4444'}`,
          fontSize: '0.88rem'
        }}>
          {statusMessage.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* HUD PRINCIPAL */}
      <div style={{
        backgroundColor: '#151515',
        border: '2px solid #2D2D2D',
        borderRadius: '16px',
        padding: '20px 18px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        marginBottom: '20px',
        position: 'relative'
      }}>
        {/* Cabecera Técnica del HUD */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid #262626', paddingBottom: '10px' }}>
          <div>
            <span style={{ fontSize: '0.72rem', color: '#888888', textTransform: 'uppercase', letterSpacing: '1px' }}>
              HUD TELEMETRÍA ELÉCTRICA
            </span>
            <div style={{ fontSize: '0.95rem', fontWeight: '800', color: '#FFFFFF' }}>
              {currentStore?.code} • {currentStore?.display_indicator || 'kWh'}
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <span style={{
              backgroundColor: '#262626',
              color: multiplier > 1 ? '#38BDF8' : '#A0A0A0',
              padding: '3px 8px',
              borderRadius: '6px',
              fontSize: '0.75rem',
              fontWeight: '700'
            }}>
              {multiplier > 1 ? `TC x${multiplier}` : 'Directo x1'}
            </span>
          </div>
        </div>

        {/* ESTADO 1: LECTURA YA CARGADA EN EL DÍA (VISOR LCD BLOQUEADO) */}
        {isRegisteredState ? (
          <div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: '#22c55e',
              fontSize: '0.82rem',
              fontWeight: '700',
              marginBottom: '8px'
            }}>
              <CheckCircle2 size={16} /> Lectura del día registrada
            </div>

            {/* Display LCD del valor del día */}
            <div style={{
              backgroundColor: '#0A0A0A',
              border: '1px solid #333333',
              borderRadius: '12px',
              padding: '16px',
              textAlign: 'center',
              marginBottom: '16px'
            }}>
              <span style={{ fontSize: '0.75rem', color: '#888888', display: 'block', marginBottom: '4px' }}>
                VALOR DEL DÍA EN EL MEDIDOR
              </span>
              <div style={{
                fontSize: '2.5rem',
                fontWeight: '900',
                color: '#FFBC0D',
                fontFamily: 'monospace',
                letterSpacing: '1px'
              }}>
                {todayReading.display_value}
              </div>
              <span style={{ fontSize: '0.8rem', color: '#A0A0A0' }}>
                {currentStore?.display_indicator || 'kWh'}
              </span>
            </div>

            {/* Métricas Calculadas */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '10px',
              marginBottom: '18px'
            }}>
              <div style={{ backgroundColor: '#1E1E1E', padding: '10px 12px', borderRadius: '8px' }}>
                <span style={{ fontSize: '0.72rem', color: '#888888' }}>Total Acumulado</span>
                <div style={{ fontSize: '1.1rem', fontWeight: '800', color: '#FFFFFF', marginTop: '2px' }}>
                  {todayReading.kwh_reading ? todayReading.kwh_reading.toLocaleString('es-AR') : '-'} <span style={{ fontSize: '0.7rem' }}>kWh</span>
                </div>
              </div>

              <div style={{ backgroundColor: '#1E1E1E', padding: '10px 12px', borderRadius: '8px' }}>
                <span style={{ fontSize: '0.72rem', color: '#888888' }}>Consumo 24h</span>
                <div style={{ fontSize: '1.1rem', fontWeight: '800', color: '#FFBC0D', marginTop: '2px' }}>
                  {todayReading.calculated_consumption !== null ? `+${todayReading.calculated_consumption.toLocaleString('es-AR')}` : 'Base'} <span style={{ fontSize: '0.7rem' }}>kWh</span>
                </div>
              </div>
            </div>

            {/* Comparativa con Mismo Día Año Anterior */}
            {lastYearConsumption !== null && (
              <div style={{
                backgroundColor: '#1E1E1E',
                padding: '10px 12px',
                borderRadius: '8px',
                marginBottom: '18px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '0.82rem'
              }}>
                <span style={{ color: '#A0A0A0' }}>Mismo día año anterior:</span>
                <div style={{ textAlign: 'right' }}>
                  <strong style={{ color: '#38BDF8' }}>{lastYearConsumption.toLocaleString('es-AR')} kWh</strong>
                  {diffVsLastYear !== null && (
                    <div style={{
                      color: diffVsLastYear <= 0 ? '#4ade80' : '#f87171',
                      fontSize: '0.75rem',
                      fontWeight: '700',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      gap: '2px'
                    }}>
                      {diffVsLastYear <= 0 ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}
                      {diffVsLastYear > 0 ? '+' : ''}{diffVsLastYear.toFixed(1)} kWh ({diffVsLastYear > 0 ? '+' : ''}{diffVsLastYearPct}%)
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Botones de Acción (Editar y WhatsApp) */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={handleOpenEditConfirm}
                style={{
                  flex: 1,
                  backgroundColor: '#2A2A2A',
                  color: '#FFFFFF',
                  border: '1px solid #444444',
                  padding: '14px',
                  borderRadius: '10px',
                  fontSize: '1rem',
                  fontWeight: '700'
                }}
              >
                <Edit3 size={18} />
                Editar
              </button>

              <button
                type="button"
                onClick={handleShareWhatsApp}
                className="btn-primary"
                style={{
                  padding: '14px 18px',
                  borderRadius: '10px',
                  fontSize: '1rem',
                  fontWeight: '700'
                }}
                title="Compartir por WhatsApp"
              >
                <Send size={18} />
                WhatsApp
              </button>
            </div>
          </div>
        ) : (
          /* ESTADO 2: CAMPO ÚNICO PARA CARGAR (SOLO NÚMEROS) */
          <form onSubmit={handleOpenUploadConfirm}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{
                fontSize: '0.85rem',
                color: '#FFBC0D',
                fontWeight: '700',
                display: 'block',
                marginBottom: '8px'
              }}>
                {isEditing ? 'Modificar lectura del medidor (Solo números)' : 'Cargar lectura del medidor (Solo números)'}
              </label>

              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[.]?[0-9]*"
                  required
                  autoFocus
                  placeholder="00000.00"
                  value={displayValue}
                  onChange={handleNumericChange}
                  disabled={loading}
                  style={{
                    fontSize: '2.2rem',
                    fontWeight: '900',
                    fontFamily: 'monospace',
                    letterSpacing: '1px',
                    textAlign: 'center',
                    padding: '14px 12px',
                    backgroundColor: '#0A0A0A',
                    border: '2px solid #FFBC0D',
                    borderRadius: '12px',
                    color: '#FFBC0D'
                  }}
                />
              </div>
              <span style={{ fontSize: '0.72rem', color: '#888888', display: 'block', marginTop: '6px', textAlign: 'center' }}>
                Ingresa el valor numérico visible en el display ({currentStore?.display_indicator || 'kWh'})
              </span>
            </div>

            {/* Telemetría Reactiva Preliminar */}
            {numericVal > 0 && (
              <div style={{
                backgroundColor: '#1E1E1E',
                border: '1px solid #333333',
                borderRadius: '10px',
                padding: '12px',
                marginBottom: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: '#A0A0A0' }}>
                    {multiplier > 1 ? `Total kWh (Display × ${multiplier}):` : 'Lectura Directa (Sin multiplicador):'}
                  </span>
                  <strong style={{ color: '#FFFFFF' }}>{currentKwh.toLocaleString('es-AR')} kWh</strong>
                </div>

                {previousReading && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                    <span style={{ color: '#A0A0A0' }}>
                      Lectura anterior ({previousReading.reading_date}):
                    </span>
                    <span style={{ color: '#A0A0A0' }}>
                      {previousReading.kwh_reading.toLocaleString('es-AR')} kWh
                      {multiplier > 1 ? ` (Disp: ${previousReading.display_value})` : ''}
                    </span>
                  </div>
                )}

                {estimatedConsumption !== null && (
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingTop: '8px',
                    borderTop: '1px solid #282828'
                  }}>
                    <div>
                      <span style={{ fontSize: '0.85rem', color: '#FFBC0D', fontWeight: '700', display: 'block' }}>
                        ⚡ Consumo 24h Calculado:
                      </span>
                      <span style={{ fontSize: '0.7rem', color: '#888888' }}>
                        {multiplier > 1
                          ? `(${numericVal} × ${multiplier}) - ${prevKwh} kWh`
                          : `${numericVal} - ${prevKwh} kWh`}
                      </span>
                    </div>
                    <strong style={{ fontSize: '1.2rem', color: '#FFBC0D' }}>
                      +{estimatedConsumption.toLocaleString('es-AR')} kWh
                    </strong>
                  </div>
                )}
              </div>
            )}

            {/* Botón CARGAR */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="submit"
                disabled={loading || numericVal <= 0}
                style={{
                  flex: 1,
                  backgroundColor: '#FFBC0D',
                  color: '#121212',
                  padding: '15px',
                  borderRadius: '10px',
                  fontSize: '1.05rem',
                  fontWeight: '800',
                  boxShadow: '0 4px 12px rgba(255, 188, 13, 0.3)'
                }}
              >
                <UploadCloud size={20} />
                {isEditing ? 'Guardar Cambios' : 'Cargar'}
              </button>

              {isEditing && (
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  style={{
                    backgroundColor: '#2A2A2A',
                    color: '#A0A0A0',
                    padding: '15px 18px',
                    borderRadius: '10px',
                    fontWeight: '700'
                  }}
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>
        )}
      </div>

      {/* CONFIRMACIÓN DE CARGA */}
      {showConfirmUpload && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(3px)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div style={{
            backgroundColor: '#1E1E1E',
            border: '2px solid #FFBC0D',
            borderRadius: '14px',
            padding: '22px',
            width: '100%',
            maxWidth: '420px',
            boxShadow: '0 12px 30px rgba(0,0,0,0.8)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#FFBC0D', marginBottom: '12px' }}>
              <HelpCircle size={22} />
              <h3 style={{ fontSize: '1.15rem', fontWeight: '800', margin: 0, color: '#FFFFFF' }}>
                Confirmar Carga de Medidor
              </h3>
            </div>

            <p style={{ fontSize: '0.88rem', color: '#CCCCCC', marginBottom: '16px' }}>
              ¿Confirmas registrar el siguiente valor para <strong>{currentStore?.name}</strong>?
            </p>

            <div style={{
              backgroundColor: '#121212',
              borderRadius: '10px',
              padding: '14px',
              textAlign: 'center',
              marginBottom: '18px'
            }}>
              <span style={{ fontSize: '0.75rem', color: '#888888' }}>VALOR INGRESADO</span>
              <div style={{ fontSize: '2rem', fontWeight: '900', color: '#FFBC0D', fontFamily: 'monospace' }}>
                {displayValue}
              </div>
              {multiplier > 1 && (
                <div style={{ fontSize: '0.78rem', color: '#A0A0A0', marginTop: '2px' }}>
                  Total acumulado: {currentKwh.toLocaleString('es-AR')} kWh (TC x{multiplier})
                </div>
              )}
              {estimatedConsumption !== null && (
                <div style={{ fontSize: '0.85rem', color: '#38BDF8', fontWeight: '700', marginTop: '4px' }}>
                  Consumo 24h estimado: +{estimatedConsumption.toLocaleString('es-AR')} kWh
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setShowConfirmUpload(false)}
                style={{
                  flex: 1,
                  backgroundColor: '#2A2A2A',
                  color: '#C0C0C0',
                  padding: '12px',
                  borderRadius: '8px',
                  fontWeight: '700'
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleExecuteSave}
                style={{
                  flex: 1,
                  backgroundColor: '#FFBC0D',
                  color: '#121212',
                  padding: '12px',
                  borderRadius: '8px',
                  fontWeight: '800'
                }}
              >
                Confirmar y Cargar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMACIÓN DE EDICIÓN */}
      {showConfirmEdit && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(3px)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div style={{
            backgroundColor: '#1E1E1E',
            border: '2px solid #38BDF8',
            borderRadius: '14px',
            padding: '22px',
            width: '100%',
            maxWidth: '420px',
            boxShadow: '0 12px 30px rgba(0,0,0,0.8)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#38BDF8', marginBottom: '12px' }}>
              <Edit3 size={22} />
              <h3 style={{ fontSize: '1.15rem', fontWeight: '800', margin: 0, color: '#FFFFFF' }}>
                Confirmar Edición
              </h3>
            </div>

            <p style={{ fontSize: '0.88rem', color: '#CCCCCC', marginBottom: '16px' }}>
              El local <strong>{currentStore?.name}</strong> ya tiene una lectura registrada hoy de <strong>{todayReading?.display_value}</strong>.
              <br /><br />
              ¿Deseas modificar este valor?
            </p>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setShowConfirmEdit(false)}
                style={{
                  flex: 1,
                  backgroundColor: '#2A2A2A',
                  color: '#C0C0C0',
                  padding: '12px',
                  borderRadius: '8px',
                  fontWeight: '700'
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleExecuteEdit}
                style={{
                  flex: 1,
                  backgroundColor: '#38BDF8',
                  color: '#0F172A',
                  padding: '12px',
                  borderRadius: '8px',
                  fontWeight: '800'
                }}
              >
                Modificar Valor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Historial Reciente */}
      <div style={{ marginTop: '24px' }}>
        <h4 style={{ fontSize: '0.88rem', fontWeight: '700', color: '#888888', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
          <Clock size={15} /> Últimos registros ({currentStore?.code})
        </h4>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {history.length === 0 ? (
            <p style={{ color: '#666666', fontSize: '0.82rem', fontStyle: 'italic' }}>
              No hay lecturas previas registradas.
            </p>
          ) : (
            history.map((item) => (
              <div
                key={item.id}
                style={{
                  backgroundColor: '#1E1E1E',
                  border: '1px solid #282828',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.82rem'
                }}
              >
                <div>
                  <div style={{ fontWeight: '700', color: '#FFFFFF' }}>
                    {item.reading_date} {item.reading_date === todayStr ? '(Hoy)' : ''}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#888888', marginTop: '2px' }}>
                    Display: {item.display_value} • Acum: {item.kwh_reading ? item.kwh_reading.toLocaleString('es-AR') : '-'} kWh
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <span style={{
                    backgroundColor: '#262626',
                    color: '#FFBC0D',
                    padding: '3px 8px',
                    borderRadius: '6px',
                    fontWeight: '700'
                  }}>
                    {item.calculated_consumption !== null ? `+${item.calculated_consumption.toLocaleString('es-AR')} kWh` : 'Base'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
