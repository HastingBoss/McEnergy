import { useState, useEffect, useRef } from 'react';
import {
  X,
  Sparkles,
  Zap,
  AlertTriangle,
  Save,
  Settings,
  ChevronDown,
  ChevronUp,
  Trash2
} from 'lucide-react';
import {
  saveMeterReading,
  deleteMeterReading,
  getEstimationContext,
  calculateKwh
} from '../../services/meterService';

export default function DayEditEstimateModal({
  isOpen,
  onClose,
  store,
  dateString,
  currentEntry = null,
  prevYearEntry = null,
  currentMonthReadings = [],
  onSaved
}) {
  if (!isOpen || !store || !dateString) return null;

  const multiplier = parseFloat(store.meter_multiplier) || 1.0;

  const [inputMode, setInputMode] = useState('display');
  const [displayValue, setDisplayValue] = useState('');
  const [targetConsumption, setTargetConsumption] = useState('');
  const [isEstimated, setIsEstimated] = useState(false);
  const [isReset, setIsReset] = useState(false);
  const [notes, setNotes] = useState('');
  const [technicianName, setTechnicianName] = useState('');

  const [contextLoading, setContextLoading] = useState(true);
  const [estimationContext, setEstimationContext] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(null);

  const [year, month, day] = dateString.split('-').map(Number);
  const formattedDateTitle = `${day} de ${new Date(year, month - 1, 1).toLocaleDateString('es-AR', { month: 'long' })} ${year}`;

  const todayStr = new Date().toISOString().split('T')[0];
  const isFutureDate = dateString > todayStr;

  // Close settings dropdown on outside click
  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [settingsOpen]);

  useEffect(() => {
    if (currentEntry) {
      setDisplayValue(currentEntry.display_value !== null ? String(currentEntry.display_value) : '');
      setTargetConsumption(currentEntry.calculated_consumption !== null ? String(currentEntry.calculated_consumption) : '');
      setIsEstimated(!!currentEntry.is_estimated);
      setIsReset(!!currentEntry.is_reset);
      setNotes(currentEntry.notes || '');
      setTechnicianName(currentEntry.technician_name || '');
    } else {
      setDisplayValue('');
      setTargetConsumption('');
      setIsEstimated(true);
      setIsReset(false);
      setNotes('');
      setTechnicianName('Estimación del Sistema');
    }
    setConfirmDelete(false);
    setErrorMessage(null);
    setSettingsOpen(false);
    loadContext();
  }, [dateString, currentEntry?.id]);

  const loadContext = async () => {
    setContextLoading(true);
    try {
      const ctx = await getEstimationContext(store.id, dateString, multiplier, currentMonthReadings);
      setEstimationContext(ctx);
      if (!currentEntry) {
        if (ctx.interpolationSuggestion) {
          applySuggestion(ctx.interpolationSuggestion, 'Interpolación lineal (hueco entre lecturas)');
        } else if (ctx.avgSuggestion?.displayValue) {
          applySuggestion(ctx.avgSuggestion, 'Promedio diario del mes');
        } else if (ctx.prevYearSuggestion?.displayValue) {
          applySuggestion(ctx.prevYearSuggestion, `Histórico mismo día ${year - 1}`);
        }
      }
    } catch (err) {
      console.error('Error al cargar contexto de estimación:', err);
    } finally {
      setContextLoading(false);
    }
  };

  const applySuggestion = (suggestion, reason) => {
    if (!suggestion || suggestion.displayValue === null) return;
    setDisplayValue(String(suggestion.displayValue));
    if (suggestion.dailyKwh !== null && suggestion.dailyKwh !== undefined) {
      setTargetConsumption(String(suggestion.dailyKwh));
    }
    setIsEstimated(true);
    setIsReset(false);
    setNotes(`Estimado automáticamente: ${reason}`);
    setInputMode('display');
  };

  const handleDisplayChange = (e) => {
    const raw = e.target.value.replace(/[^0-9.]/g, '');
    setDisplayValue(raw);
    const val = parseFloat(raw);
    if (!isNaN(val) && estimationContext?.prevReading) {
      const prevKwh = parseFloat(estimationContext.prevReading.kwh_reading);
      const currKwh = calculateKwh(val, multiplier);
      const cons = Math.max(0, currKwh - prevKwh);
      setTargetConsumption(cons.toFixed(1));
    } else {
      setTargetConsumption('');
    }
  };

  const handleConsumptionChange = (e) => {
    const raw = e.target.value.replace(/[^0-9.]/g, '');
    setTargetConsumption(raw);
    const targetKwh = parseFloat(raw);
    if (!isNaN(targetKwh)) {
      if (estimationContext?.prevReading) {
        const prevDisplay = parseFloat(estimationContext.prevReading.display_value);
        setDisplayValue((prevDisplay + targetKwh / multiplier).toFixed(3));
      } else if (estimationContext?.nextReading) {
        const nextDisplay = parseFloat(estimationContext.nextReading.display_value);
        setDisplayValue(Math.max(0, nextDisplay - targetKwh / multiplier).toFixed(3));
      }
    }
  };

  const numDisplay = parseFloat(displayValue);
  let liveKwhReading = null;
  let liveConsumption = null;
  if (!isNaN(numDisplay) && numDisplay >= 0) {
    liveKwhReading = calculateKwh(numDisplay, multiplier);
    if (isReset) {
      liveConsumption = null;
    } else if (estimationContext?.prevReading) {
      const prevKwh = parseFloat(estimationContext.prevReading.kwh_reading);
      liveConsumption = Math.max(0, liveKwhReading - prevKwh);
    }
  }

  const handleSave = async (e) => {
    e.preventDefault();
    setErrorMessage(null);
    if (isFutureDate) { setErrorMessage('No es posible registrar ni modificar lecturas en fechas futuras.'); return; }
    const parsedDisplay = parseFloat(displayValue);
    if (isNaN(parsedDisplay) || parsedDisplay < 0) { setErrorMessage('Por favor ingresá un valor de Display válido.'); return; }
    setSaving(true);
    try {
      await saveMeterReading({
        storeId: store.id, readingDate: dateString, displayValue: parsedDisplay,
        multiplier, isReset, isEstimated, notes,
        technicianName: technicianName || (isEstimated ? 'Estimación del Sistema' : 'Operador')
      });
      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      setErrorMessage('Error al guardar: ' + (err.message || 'Error de conexión'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setErrorMessage(null);
    try {
      await deleteMeterReading(store.id, dateString);
      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      setErrorMessage('Error al eliminar: ' + (err.message || 'Error de conexión'));
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  // Determinar el método de estimación activo (para mostrar en recuadro fijo)
  const activeMethod = !contextLoading && estimationContext
    ? estimationContext.interpolationSuggestion
      ? {
          label: 'Interpolación lineal',
          desc: `Reparte ${estimationContext.interpolationSuggestion.totalDays} días entre el ${estimationContext.interpolationSuggestion.prevDate.split('-')[2]} y el ${estimationContext.interpolationSuggestion.nextDate.split('-')[2]} • ${estimationContext.interpolationSuggestion.dailyKwh} kWh/día`,
          icon: '📈'
        }
      : estimationContext.avgSuggestion?.displayValue
        ? {
            label: 'Promedio diario del mes',
            desc: `Promedio del local: ${estimationContext.avgSuggestion.dailyKwh} kWh/día`,
            icon: '📊'
          }
        : null
    : null;

  const prevDay = estimationContext?.prevReading;
  const nextDay = estimationContext?.nextReading;

  return (
    <div style={{
      position: 'fixed', inset: 0,
      backgroundColor: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(5px)',
      zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px'
    }}>
      <div style={{
        backgroundColor: '#1E1E1E', border: '1px solid #383838', borderRadius: '16px',
        width: '100%', maxWidth: '520px', maxHeight: '92vh', overflowY: 'auto',
        boxShadow: '0 20px 40px rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column'
      }}>

        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #2D2D2D',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          backgroundColor: '#181818', borderTopLeftRadius: '16px', borderTopRightRadius: '16px'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Zap color="#FFC72C" size={20} />
              <h3 style={{ fontSize: '1.1rem', fontWeight: '800', color: '#FFFFFF', margin: 0 }}>
                {currentEntry ? 'Editar Lectura' : 'Cargar / Estimar Día'}
              </h3>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#A0A0A0', margin: '3px 0 0 0' }}>
              {store.name} ({store.code}) • <strong style={{ color: '#FFC72C' }}>{formattedDateTitle}</strong>
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#A0A0A0', cursor: 'pointer', padding: '6px', borderRadius: '8px', display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Errores */}
          {errorMessage && (
            <div style={{ backgroundColor: 'rgba(239,68,68,0.15)', border: '1px solid #ef4444', borderRadius: '8px', padding: '10px 14px', color: '#f87171', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={16} /><span>{errorMessage}</span>
            </div>
          )}
          {isFutureDate && (
            <div style={{ backgroundColor: 'rgba(239,68,68,0.12)', border: '1px solid #ef4444', borderRadius: '8px', padding: '10px 14px', color: '#f87171', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={16} /><span>Esta fecha está en el futuro. No está permitido registrar ni modificar lecturas de días posteriores a hoy.</span>
            </div>
          )}

          {/* Contexto: día previo / día siguiente */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px'
          }}>
            {/* Día anterior */}
            <div style={{ backgroundColor: '#141414', border: '1px solid #2A2A2A', borderRadius: '10px', padding: '10px 14px' }}>
              <div style={{ fontSize: '0.7rem', color: '#888', marginBottom: '3px' }}>
                Día anterior ({prevDay ? prevDay.reading_date.split('-')[2] : '-'})
              </div>
              {prevDay ? (
                <strong style={{ fontSize: '1rem', color: '#FFFFFF' }}>{prevDay.display_value}</strong>
              ) : (
                <span style={{ fontSize: '0.74rem', backgroundColor: 'rgba(156,163,175,0.12)', color: '#9CA3AF', border: '1px solid rgba(156,163,175,0.3)', padding: '2px 7px', borderRadius: '5px', fontWeight: '700' }}>Pendiente</span>
              )}
            </div>

            {/* Día siguiente */}
            <div style={{ backgroundColor: '#141414', border: '1px solid #2A2A2A', borderRadius: '10px', padding: '10px 14px' }}>
              <div style={{ fontSize: '0.7rem', color: '#888', marginBottom: '3px' }}>
                Día siguiente ({nextDay ? nextDay.reading_date.split('-')[2] : '-'})
              </div>
              {nextDay ? (
                <strong style={{ fontSize: '1rem', color: '#FFFFFF' }}>{nextDay.display_value}</strong>
              ) : (
                <span style={{ fontSize: '0.74rem', backgroundColor: 'rgba(156,163,175,0.12)', color: '#9CA3AF', border: '1px solid rgba(156,163,175,0.3)', padding: '2px 7px', borderRadius: '5px', fontWeight: '700' }}>Pendiente</span>
              )}
            </div>
          </div>

          {/* Método de estimación activo (solo informativo) */}
          {contextLoading ? (
            <div style={{ backgroundColor: '#181E29', border: '1px solid #1E3A5F', borderRadius: '10px', padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#38BDF8' }}>
                <Sparkles size={16} />
                <span style={{ fontSize: '0.82rem', color: '#888' }}>Analizando lecturas adyacentes...</span>
              </div>
            </div>
          ) : activeMethod ? (
            <div style={{ backgroundColor: '#181E29', border: '1px solid #1E3A5F', borderRadius: '10px', padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <Sparkles size={16} color="#38BDF8" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <div style={{ fontSize: '0.78rem', color: '#9CA3AF', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.4px', fontWeight: '700' }}>
                  Método aplicado
                </div>
                <div style={{ fontSize: '0.86rem', fontWeight: '800', color: '#FFFFFF' }}>
                  {activeMethod.icon} {activeMethod.label}
                </div>
                <div style={{ fontSize: '0.74rem', color: '#93C5FD', marginTop: '2px' }}>{activeMethod.desc}</div>
              </div>
            </div>
          ) : null}

          {/* Formulario */}
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Selector de modo */}
            <div style={{ display: 'flex', gap: '6px', borderBottom: '1px solid #2D2D2D', paddingBottom: '10px' }}>
              {['display', 'consumption'].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setInputMode(mode)}
                  style={{
                    padding: '6px 12px', fontSize: '0.78rem', borderRadius: '6px', fontWeight: '700',
                    backgroundColor: inputMode === mode ? '#FFC72C' : '#262626',
                    color: inputMode === mode ? '#121212' : '#CCCCCC',
                    border: 'none', cursor: 'pointer'
                  }}
                >
                  {mode === 'display' ? 'Valor del Display' : 'Consumo directo (kWh)'}
                </button>
              ))}
            </div>

            {/* Input principal */}
            {inputMode === 'display' ? (
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '700', color: '#CCCCCC', marginBottom: '6px' }}>
                  Valor en Pantalla del Medidor (Display):
                </label>
                <input
                  type="text" inputMode="decimal"
                  value={displayValue} onChange={handleDisplayChange}
                  placeholder="Ej: 43481.35" autoFocus
                  style={{ fontSize: '1.3rem', fontWeight: '800', color: '#FFC72C', backgroundColor: '#141414', border: '1px solid #444', padding: '10px 14px' }}
                />
              </div>
            ) : (
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '700', color: '#CCCCCC', marginBottom: '6px' }}>
                  Consumo Diario (kWh):
                </label>
                <input
                  type="text" inputMode="decimal"
                  value={targetConsumption} onChange={handleConsumptionChange}
                  placeholder="Ej: 618.0" autoFocus
                  style={{ fontSize: '1.3rem', fontWeight: '800', color: '#FFC72C', backgroundColor: '#141414', border: '1px solid #444', padding: '10px 14px' }}
                />
                <p style={{ fontSize: '0.72rem', color: '#888', marginTop: '4px' }}>
                  Display calculado: {displayValue || '-'}
                </p>
              </div>
            )}

            {/* Vista previa kWh */}
            {liveKwhReading !== null && (
              <div style={{
                backgroundColor: '#222', borderRadius: '8px', padding: '10px 14px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem'
              }}>
                <div>
                  <span style={{ color: '#888' }}>kWh Acumulado: </span>
                  <strong style={{ color: '#FFFFFF' }}>{liveKwhReading.toLocaleString('es-AR')} kWh</strong>
                </div>
                <div>
                  <span style={{ color: '#888' }}>Consumo resultante: </span>
                  <strong style={{ color: liveConsumption !== null ? '#FFC72C' : '#888', fontSize: '0.95rem' }}>
                    {liveConsumption !== null ? `${liveConsumption.toFixed(1)} kWh` : (isReset ? 'Lectura Base' : 'Sin cálculo')}
                  </strong>
                </div>
              </div>
            )}

            {/* Notas */}
            <div>
              <label style={{ display: 'block', fontSize: '0.74rem', color: '#888', marginBottom: '4px' }}>
                Notas / Motivo del ajuste:
              </label>
              <input
                type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej: Estimado automáticamente por interpolación"
                style={{ fontSize: '0.82rem', padding: '8px 12px' }}
              />
            </div>

            {/* Footer: Guardar / Cancelar / ⚙️ */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              marginTop: '6px', paddingTop: '12px', borderTop: '1px solid #2D2D2D'
            }}>
              {/* ⚙️ Settings dropdown */}
              <div style={{ position: 'relative' }} ref={settingsRef}>
                <button
                  type="button"
                  onClick={() => setSettingsOpen((o) => !o)}
                  title="Opciones avanzadas"
                  style={{
                    backgroundColor: '#262626', border: '1px solid #3A3A3A',
                    color: '#CCCCCC', borderRadius: '8px', padding: '8px 10px',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                    fontSize: '0.78rem', fontWeight: '700'
                  }}
                >
                  <Settings size={15} />
                  {settingsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>

                {settingsOpen && (
                  <div style={{
                    position: 'absolute', bottom: 'calc(100% + 8px)', left: 0,
                    backgroundColor: '#1A1A1A', border: '1px solid #333',
                    borderRadius: '10px', padding: '10px', minWidth: '240px',
                    zIndex: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.7)',
                    display: 'flex', flexDirection: 'column', gap: '8px'
                  }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: '#E0E0E0', cursor: 'pointer' }}>
                      <input
                        type="checkbox" checked={isEstimated}
                        onChange={(e) => setIsEstimated(e.target.checked)}
                        style={{ width: '15px', height: '15px', accentColor: '#FFC72C' }}
                      />
                      <span>Marcar como <strong>lectura estimada</strong></span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: '#E0E0E0', cursor: 'pointer' }}>
                      <input
                        type="checkbox" checked={isReset}
                        onChange={(e) => setIsReset(e.target.checked)}
                        style={{ width: '15px', height: '15px', accentColor: '#FFC72C' }}
                      />
                      <span>Marcar como <strong>lectura base / reinicio</strong></span>
                    </label>

                    {currentEntry && (
                      <>
                        <div style={{ borderTop: '1px solid #333', margin: '2px 0' }} />
                        {confirmDelete ? (
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.74rem', color: '#f87171' }}>¿Confirmar?</span>
                            <button
                              type="button" onClick={handleDelete} disabled={deleting}
                              style={{ backgroundColor: '#dc2626', color: '#FFF', padding: '5px 10px', fontSize: '0.74rem', borderRadius: '6px', border: 'none', cursor: 'pointer' }}
                            >
                              {deleting ? '...' : 'Sí, eliminar'}
                            </button>
                            <button
                              type="button" onClick={() => setConfirmDelete(false)}
                              style={{ backgroundColor: '#333', color: '#FFF', padding: '5px 8px', fontSize: '0.74rem', borderRadius: '6px', border: 'none', cursor: 'pointer' }}
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button" onClick={() => setConfirmDelete(true)}
                            style={{
                              backgroundColor: 'transparent', color: '#f87171',
                              border: '1px solid #ef4444', borderRadius: '7px',
                              padding: '7px 12px', fontSize: '0.78rem', fontWeight: '700',
                              display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', width: '100%'
                            }}
                          >
                            <Trash2 size={13} /> Eliminar registro
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Spacer */}
              <div style={{ flex: 1 }} />

              {/* Cancelar + Guardar */}
              <button
                type="button" onClick={onClose}
                style={{ backgroundColor: '#262626', color: '#CCCCCC', padding: '8px 14px', fontSize: '0.82rem', borderRadius: '8px', border: 'none', cursor: 'pointer' }}
              >
                Cancelar
              </button>

              <button
                type="submit"
                disabled={saving || !displayValue || isFutureDate}
                style={{
                  backgroundColor: isFutureDate ? '#444' : '#FFC72C',
                  color: isFutureDate ? '#888' : '#121212',
                  cursor: isFutureDate ? 'not-allowed' : 'pointer',
                  padding: '8px 16px', fontSize: '0.85rem', fontWeight: '800',
                  borderRadius: '8px', border: 'none',
                  display: 'flex', alignItems: 'center', gap: '6px'
                }}
              >
                <Save size={15} />
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
