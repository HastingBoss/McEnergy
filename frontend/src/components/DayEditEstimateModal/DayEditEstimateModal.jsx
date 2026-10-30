import { useState, useEffect } from 'react';
import {
  X,
  Sparkles,
  Calendar,
  Zap,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Save,
  HelpCircle,
  History,
  Activity
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

  // Form states
  const [inputMode, setInputMode] = useState('display'); // 'display' | 'consumption'
  const [displayValue, setDisplayValue] = useState('');
  const [targetConsumption, setTargetConsumption] = useState('');
  const [isEstimated, setIsEstimated] = useState(false);
  const [isReset, setIsReset] = useState(false);
  const [notes, setNotes] = useState('');
  const [technicianName, setTechnicianName] = useState('');

  // Context & suggestions
  const [contextLoading, setContextLoading] = useState(true);
  const [estimationContext, setEstimationContext] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Formateo de fecha para título
  const [year, month, day] = dateString.split('-').map(Number);
  const formattedDateTitle = `${day} de ${new Date(year, month - 1, 1).toLocaleDateString('es-AR', { month: 'long' })} ${year}`;

  const todayStr = new Date().toISOString().split('T')[0];
  const isFutureDate = dateString > todayStr;

  useEffect(() => {
    // Inicializar estado con datos existentes si los hay
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
      setIsEstimated(true); // Si era un día faltante, sugerir estimado por defecto
      setIsReset(false);
      setNotes('');
      setTechnicianName('Estimación del Sistema');
    }

    setConfirmDelete(false);
    setErrorMessage(null);
    loadContext();
  }, [dateString, currentEntry?.id]);

  const loadContext = async () => {
    setContextLoading(true);
    try {
      const ctx = await getEstimationContext(store.id, dateString, multiplier, currentMonthReadings);
      setEstimationContext(ctx);

      // Si no hay lectura actual, autoseleccionar la mejor estimación sugerida
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

  // Manejo de cambio en modo display
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

  // Manejo de cambio en modo consumo directo en kWh
  const handleConsumptionChange = (e) => {
    const raw = e.target.value.replace(/[^0-9.]/g, '');
    setTargetConsumption(raw);

    const targetKwh = parseFloat(raw);
    if (!isNaN(targetKwh)) {
      if (estimationContext?.prevReading) {
        const prevDisplay = parseFloat(estimationContext.prevReading.display_value);
        const reqDisplay = prevDisplay + (targetKwh / multiplier);
        setDisplayValue(reqDisplay.toFixed(3));
      } else if (estimationContext?.nextReading) {
        const nextDisplay = parseFloat(estimationContext.nextReading.display_value);
        const reqDisplay = Math.max(0, nextDisplay - (targetKwh / multiplier));
        setDisplayValue(reqDisplay.toFixed(3));
      }
    }
  };

  // Cálculo en vivo del consumo que resultará
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

  // Guardar
  const handleSave = async (e) => {
    e.preventDefault();
    setErrorMessage(null);

    if (isFutureDate) {
      setErrorMessage('No es posible registrar ni modificar lecturas en fechas futuras.');
      return;
    }

    const parsedDisplay = parseFloat(displayValue);
    if (isNaN(parsedDisplay) || parsedDisplay < 0) {
      setErrorMessage('Por favor ingresa un valor de Display válido (número mayor o igual a 0).');
      return;
    }

    setSaving(true);
    try {
      await saveMeterReading({
        storeId: store.id,
        readingDate: dateString,
        displayValue: parsedDisplay,
        multiplier,
        isReset,
        isEstimated,
        notes,
        technicianName: technicianName || (isEstimated ? 'Estimación del Sistema' : 'Operador')
      });

      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      console.error('Error al guardar lectura:', err);
      setErrorMessage('Error al guardar: ' + (err.message || 'Error de conexión'));
    } finally {
      setSaving(false);
    }
  };

  // Eliminar
  const handleDelete = async () => {
    setDeleting(true);
    setErrorMessage(null);
    try {
      await deleteMeterReading(store.id, dateString);
      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      console.error('Error al eliminar lectura:', err);
      setErrorMessage('Error al eliminar: ' + (err.message || 'Error de conexión'));
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.78)',
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
        maxWidth: '560px',
        maxHeight: '92vh',
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
              <Zap color="#FFBC0D" size={20} />
              <h3 style={{ fontSize: '1.15rem', fontWeight: '800', color: '#FFFFFF', margin: 0 }}>
                {currentEntry ? 'Editar Lectura' : 'Cargar / Estimar Día'}
              </h3>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#A0A0A0', margin: '4px 0 0 0' }}>
              {store.name} ({store.code}) • <strong style={{ color: '#FFFFFF' }}>{formattedDateTitle}</strong>
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
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Contenido principal */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Mensaje de error si hubo */}
          {errorMessage && (
            <div style={{
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid #ef4444',
              borderRadius: '8px',
              padding: '10px 14px',
              color: '#f87171',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <AlertTriangle size={18} />
              <span>{errorMessage}</span>
            </div>
          )}

          {isFutureDate && (
            <div style={{
              backgroundColor: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid #ef4444',
              borderRadius: '8px',
              padding: '10px 14px',
              color: '#f87171',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <AlertTriangle size={18} />
              <span>Esta fecha está en el futuro. No está permitido registrar ni modificar lecturas de días posteriores a hoy.</span>
            </div>
          )}

          {/* Contexto del medidor & lecturas circundantes */}
          <div style={{
            backgroundColor: '#141414',
            border: '1px solid #2A2A2A',
            borderRadius: '10px',
            padding: '12px 14px',
            fontSize: '0.78rem',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '8px'
          }}>
            <div>
              <span style={{ color: '#888' }}>Multiplicador:</span>{' '}
              <strong style={{ color: '#FFBC0D' }}>x{multiplier}</strong>
            </div>
            <div>
              <span style={{ color: '#888' }}>Día previo ({estimationContext?.prevReading?.reading_date?.split('-')[2] || '-'}):</span>{' '}
              <strong style={{ color: '#FFFFFF' }}>
                {estimationContext?.prevReading?.display_value ?? 'Sin datos'}
              </strong>
            </div>
            <div>
              <span style={{ color: '#888' }}>Día siguiente ({estimationContext?.nextReading?.reading_date?.split('-')[2] || '-'}):</span>{' '}
              <strong style={{ color: '#FFFFFF' }}>
                {estimationContext?.nextReading?.display_value ?? 'Sin datos'}
              </strong>
            </div>
            {prevYearEntry && (
              <div>
                <span style={{ color: '#888' }}>Mismo día {year - 1}:</span>{' '}
                <strong style={{ color: '#38BDF8' }}>
                  {prevYearEntry.calculated_consumption !== null ? `${prevYearEntry.calculated_consumption} kWh` : '-'}
                </strong>
              </div>
            )}
          </div>

          {/* SECCIÓN 1: ASISTENTE DE ESTIMACIÓN INTELIGENTE */}
          <div style={{
            backgroundColor: '#181E29',
            border: '1px solid #1E3A5F',
            borderRadius: '12px',
            padding: '14px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#38BDF8', marginBottom: '10px' }}>
              <Sparkles size={18} />
              <span style={{ fontSize: '0.88rem', fontWeight: '700' }}>
                Asistente de Estimación Automática
              </span>
            </div>

            {contextLoading ? (
              <p style={{ fontSize: '0.8rem', color: '#888888', margin: 0 }}>
                Analizando historial y lecturas adyacentes...
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* Opción A: Interpolación lineal */}
                {estimationContext?.interpolationSuggestion && (
                  <div style={{
                    backgroundColor: '#132032',
                    border: '1px solid #254B77',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '10px'
                  }}>
                    <div>
                      <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>📈 Interpolación Lineal</span>
                        <span style={{ fontSize: '0.68rem', backgroundColor: '#22c55e', color: '#000', padding: '1px 6px', borderRadius: '4px', fontWeight: '800' }}>
                          Recomendado
                        </span>
                      </div>
                      <p style={{ fontSize: '0.74rem', color: '#93C5FD', margin: '2px 0 0 0' }}>
                        Reparte {estimationContext.interpolationSuggestion.totalDays} días entre el {estimationContext.interpolationSuggestion.prevDate.split('-')[2]} y el {estimationContext.interpolationSuggestion.nextDate.split('-')[2]}.
                        Consumo: <strong>{estimationContext.interpolationSuggestion.dailyKwh} kWh/día</strong> • Display: <strong>{estimationContext.interpolationSuggestion.displayValue}</strong>
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => applySuggestion(estimationContext.interpolationSuggestion, 'Interpolación lineal (hueco entre lecturas)')}
                      style={{
                        backgroundColor: '#2563EB',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '6px 10px',
                        fontSize: '0.75rem',
                        fontWeight: '700',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Aplicar
                    </button>
                  </div>
                )}

                {/* Opción B: Promedio mensual */}
                {estimationContext?.avgSuggestion?.displayValue && (
                  <div style={{
                    backgroundColor: '#132032',
                    border: '1px solid #1E3A5F',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '10px'
                  }}>
                    <div>
                      <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#FFFFFF' }}>
                        📊 Promedio Diario del Mes
                      </div>
                      <p style={{ fontSize: '0.74rem', color: '#93C5FD', margin: '2px 0 0 0' }}>
                        Promedio del local: <strong>{estimationContext.avgSuggestion.dailyKwh} kWh/día</strong> • Display sugerido: <strong>{estimationContext.avgSuggestion.displayValue}</strong>
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => applySuggestion(estimationContext.avgSuggestion, 'Promedio diario del mes')}
                      style={{
                        backgroundColor: '#1E3A5F',
                        color: '#38BDF8',
                        border: '1px solid #2563EB',
                        borderRadius: '6px',
                        padding: '6px 10px',
                        fontSize: '0.75rem',
                        fontWeight: '700',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Aplicar
                    </button>
                  </div>
                )}

                {/* Opción C: Año anterior */}
                {estimationContext?.prevYearSuggestion?.displayValue && (
                  <div style={{
                    backgroundColor: '#132032',
                    border: '1px solid #1E3A5F',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '10px'
                  }}>
                    <div>
                      <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#FFFFFF' }}>
                        📅 Mismo Día Año Anterior ({year - 1})
                      </div>
                      <p style={{ fontSize: '0.74rem', color: '#93C5FD', margin: '2px 0 0 0' }}>
                        Consumo {year - 1}: <strong>{estimationContext.prevYearSuggestion.dailyKwh} kWh</strong> • Display sugerido: <strong>{estimationContext.prevYearSuggestion.displayValue}</strong>
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => applySuggestion(estimationContext.prevYearSuggestion, `Mismo día año anterior (${year - 1})`)}
                      style={{
                        backgroundColor: '#1E3A5F',
                        color: '#38BDF8',
                        border: '1px solid #2563EB',
                        borderRadius: '6px',
                        padding: '6px 10px',
                        fontSize: '0.75rem',
                        fontWeight: '700',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Aplicar
                    </button>
                  </div>
                )}

                {!estimationContext?.interpolationSuggestion &&
                 !estimationContext?.avgSuggestion?.displayValue &&
                 !estimationContext?.prevYearSuggestion?.displayValue && (
                  <p style={{ fontSize: '0.78rem', color: '#93C5FD', margin: 0 }}>
                    No hay suficientes lecturas adyacentes para una estimación automática. Por favor ingresa el valor de display o consumo manualmente.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* SECCIÓN 2: FORMULARIO DE CARGA / AJUSTE MANUAL */}
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Selector de modo */}
            <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #2D2D2D', paddingBottom: '10px' }}>
              <button
                type="button"
                onClick={() => setInputMode('display')}
                style={{
                  padding: '6px 12px',
                  fontSize: '0.8rem',
                  borderRadius: '6px',
                  backgroundColor: inputMode === 'display' ? '#FFBC0D' : '#262626',
                  color: inputMode === 'display' ? '#121212' : '#FFFFFF',
                  fontWeight: '700'
                }}
              >
                Cargar por Display del Medidor
              </button>
              <button
                type="button"
                onClick={() => setInputMode('consumption')}
                style={{
                  padding: '6px 12px',
                  fontSize: '0.8rem',
                  borderRadius: '6px',
                  backgroundColor: inputMode === 'consumption' ? '#FFBC0D' : '#262626',
                  color: inputMode === 'consumption' ? '#121212' : '#FFFFFF',
                  fontWeight: '700'
                }}
              >
                Cargar por Consumo Directo (kWh)
              </button>
            </div>

            {inputMode === 'display' ? (
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', color: '#CCCCCC', marginBottom: '6px' }}>
                  Valor en Pantalla del Medidor (Display):
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={displayValue}
                  onChange={handleDisplayChange}
                  placeholder="Ej: 43481.35"
                  autoFocus
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: '800',
                    color: '#FFBC0D',
                    backgroundColor: '#141414',
                    border: '1px solid #444',
                    padding: '10px 14px'
                  }}
                />
              </div>
            ) : (
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', color: '#CCCCCC', marginBottom: '6px' }}>
                  Consumo Diario Deseado (kWh):
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={targetConsumption}
                  onChange={handleConsumptionChange}
                  placeholder="Ej: 618.0"
                  autoFocus
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: '800',
                    color: '#FFBC0D',
                    backgroundColor: '#141414',
                    border: '1px solid #444',
                    padding: '10px 14px'
                  }}
                />
                <p style={{ fontSize: '0.74rem', color: '#888888', marginTop: '4px' }}>
                  El sistema calcula el display requerido ({displayValue || '-'}) basado en la lectura previa y el multiplicador x{multiplier}.
                </p>
              </div>
            )}

            {/* Vista previa de resultado */}
            {liveKwhReading !== null && (
              <div style={{
                backgroundColor: '#222222',
                borderRadius: '8px',
                padding: '10px 14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '0.82rem'
              }}>
                <div>
                  <span style={{ color: '#888888' }}>kWh Acumulado:</span>{' '}
                  <strong style={{ color: '#FFFFFF' }}>{liveKwhReading.toLocaleString('es-AR')} kWh</strong>
                </div>
                <div>
                  <span style={{ color: '#888888' }}>Consumo resultante:</span>{' '}
                  <strong style={{ color: liveConsumption !== null ? '#FFBC0D' : '#888888', fontSize: '0.95rem' }}>
                    {liveConsumption !== null ? `${liveConsumption.toFixed(1)} kWh` : (isReset ? 'Lectura Base (0 kWh)' : 'Sin cálculo')}
                  </strong>
                </div>
              </div>
            )}

            {/* Opciones y checkboxes */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '4px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: '#E0E0E0', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isEstimated}
                  onChange={(e) => setIsEstimated(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#FFBC0D' }}
                />
                <span>
                  Marcar como <strong>lectura estimada</strong> (se identificará como [Est] en la comparativa)
                </span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: '#E0E0E0', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isReset}
                  onChange={(e) => setIsReset(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#FFBC0D' }}
                />
                <span>
                  Marcar como <strong>lectura base / reinicio</strong> (no calcula consumo frente al día anterior)
                </span>
              </label>
            </div>

            {/* Notas */}
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#888888', marginBottom: '4px' }}>
                Notas / Motivo del ajuste:
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej: Estimado automáticamente por interpolación"
                style={{ fontSize: '0.82rem', padding: '8px 12px' }}
              />
            </div>

            {/* Botones de acción */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '10px',
              paddingTop: '12px',
              borderTop: '1px solid #2D2D2D',
              gap: '10px'
            }}>
              <div>
                {currentEntry && (
                  confirmDelete ? (
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.74rem', color: '#f87171' }}>¿Confirmar?</span>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={deleting}
                        style={{
                          backgroundColor: '#dc2626',
                          color: '#FFFFFF',
                          padding: '6px 10px',
                          fontSize: '0.75rem',
                          borderRadius: '6px'
                        }}
                      >
                        {deleting ? '...' : 'Sí, eliminar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        style={{
                          backgroundColor: '#333333',
                          color: '#FFFFFF',
                          padding: '6px 8px',
                          fontSize: '0.75rem',
                          borderRadius: '6px'
                        }}
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      style={{
                        backgroundColor: 'transparent',
                        color: '#f87171',
                        border: '1px solid #ef4444',
                        padding: '8px 12px',
                        fontSize: '0.78rem',
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                      title="Eliminar registro de este día"
                    >
                      <Trash2 size={14} />
                      Eliminar
                    </button>
                  )
                )}
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
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

                <button
                  type="submit"
                  disabled={saving || !displayValue || isFutureDate}
                  style={{
                    backgroundColor: isFutureDate ? '#444444' : '#FFBC0D',
                    color: isFutureDate ? '#888888' : '#121212',
                    cursor: isFutureDate ? 'not-allowed' : 'pointer',
                    padding: '8px 16px',
                    fontSize: '0.85rem',
                    fontWeight: '800',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Save size={16} />
                  {saving ? 'Guardando...' : 'Guardar Lectura'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
