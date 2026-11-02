import { useState, useEffect } from 'react';
import {
  Building2,
  CheckCircle2,
  AlertTriangle,
  Edit3,
  UploadCloud,
  Send,
  HelpCircle,
  Zap,
  ArrowRight,
  Camera,
  Sparkles,
  Wifi,
  WifiOff,
  RefreshCw
} from 'lucide-react';
import MeterOcrModal from '../../components/MeterOcrModal/MeterOcrModal';
import AppFooter from '../../components/AppFooter/AppFooter';
import { useStore } from '../../context/StoreContext';
import {
  calculateKwh,
  calculateConsumption,
  getPreviousYearDate,
  fetchStoreReadings,
  fetchReadingForDate,
  fetchStoreDailyAverage,
  saveMeterReading,
  formatWhatsAppReport
} from '../../services/meterService';
import {
  getPendingCount,
  subscribeToSyncChanges,
  syncAllPendingReadings,
  isCurrentlySyncing
} from '../../services/offlineSyncService';

export default function MeterReading() {
  const { stores, currentStore, setCurrentStore } = useStore();

  const todayStr = new Date().toISOString().split('T')[0];
  const [displayValue, setDisplayValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [showConfirmUpload, setShowConfirmUpload] = useState(false);
  const [showConfirmEdit, setShowConfirmEdit] = useState(false);
  const [showAnomalyWarning, setShowAnomalyWarning] = useState(null);
  const [adminNotified, setAdminNotified] = useState(false);
  const [isOcrOpen, setIsOcrOpen] = useState(false);

  const [todayReading, setTodayReading] = useState(null);
  const [previousReading, setPreviousReading] = useState(null);
  const [prevYearReading, setPrevYearReading] = useState(null);
  const [storeDailyAvg, setStoreDailyAvg] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  // Estados de conectividad y cola offline
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  const multiplier = currentStore?.meter_multiplier || 1.0;

  useEffect(() => {
    const updateSyncStatus = async () => {
      setIsOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
      const count = await getPendingCount();
      setPendingCount(count);
      setIsSyncing(isCurrentlySyncing());
    };

    updateSyncStatus();
    const unsubscribe = subscribeToSyncChanges(() => {
      updateSyncStatus();
      loadDataForCurrentStore();
    });

    return () => unsubscribe();
  }, [currentStore?.id]);

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
    setShowAnomalyWarning(null);
    setAdminNotified(false);

    try {
      const [readingsList, currentEntry, lastYearEntry, dbAvg] = await Promise.all([
        fetchStoreReadings(currentStore.id, 30),
        fetchReadingForDate(currentStore.id, todayStr),
        fetchReadingForDate(currentStore.id, getPreviousYearDate(todayStr)),
        fetchStoreDailyAverage(currentStore.id, 30)
      ]);

      setTodayReading(currentEntry);
      setPrevYearReading(lastYearEntry);

      // Calcular promedio diario habitual del local (online o fallback offline)
      let calculatedAvg = dbAvg || 0;
      if (calculatedAvg <= 0 && readingsList && readingsList.length > 0) {
        const validConsumptions = readingsList
          .filter((r) => r.calculated_consumption !== null && r.calculated_consumption > 0 && r.reading_date !== todayStr)
          .map((r) => parseFloat(r.calculated_consumption));
        if (validConsumptions.length > 0) {
          calculatedAvg = Number((validConsumptions.reduce((a, b) => a + b, 0) / validConsumptions.length).toFixed(1));
        }
      }
      setStoreDailyAvg(calculatedAvg);

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

  // Cálculo en tiempo real del consumo proyectado del día
  const prevKwh = previousReading ? (previousReading.kwh_reading || previousReading.display_value * multiplier) : null;
  const currentKwh = numericVal > 0 ? (numericVal * multiplier) : null;
  const projectedConsumption = (currentKwh !== null && prevKwh !== null)
    ? Number((currentKwh - prevKwh).toFixed(1))
    : null;

  // Validación predictiva: advertir si el consumo proyectado excede 1.5x el promedio diario habitual
  const isSpikeOverAverage = Boolean(
    storeDailyAvg > 0 &&
    projectedConsumption !== null &&
    projectedConsumption > (storeDailyAvg * 1.5)
  );
  const excessPct = (isSpikeOverAverage && storeDailyAvg > 0 && projectedConsumption !== null)
    ? Math.round(((projectedConsumption - storeDailyAvg) / storeDailyAvg) * 100)
    : 0;

  // Acción Cargar -> valida y detecta anomalías / picos elevados (> 1.5x promedio o negativo)
  const handleOpenUploadConfirm = (e) => {
    e.preventDefault();
    if (!displayValue || isNaN(numericVal) || numericVal <= 0) {
      setStatusMessage({ type: 'error', text: 'Ingresa un valor numérico válido mayor a 0.' });
      return;
    }

    if (todayReading && !isEditing) {
      setShowConfirmEdit(true);
      return;
    }

    // Análisis de variación y detección de anomalía
    const prevCons = previousReading?.calculated_consumption || 0;
    const isHighSpike = projectedConsumption !== null && (
      (storeDailyAvg > 0 && projectedConsumption > (storeDailyAvg * 1.5)) ||
      (prevCons > 0 && projectedConsumption >= (prevCons * 2))
    );
    const isNegative = projectedConsumption !== null && projectedConsumption < 0;

    if ((isHighSpike || isNegative) && !adminNotified) {
      setShowAnomalyWarning({
        isHighSpike,
        isNegative,
        estCons: projectedConsumption,
        prevCons,
        storeDailyAvg,
        excessPct,
        numericVal
      });
      return;
    }

    setShowConfirmUpload(true);
  };

  // El técnico elige cargar igual pese a la anomalía
  const handleProceedWithAnomaly = () => {
    setAdminNotified(true);
    setShowAnomalyWarning(null);
    setShowConfirmUpload(true);
  };

  // Confirmar y guardar la carga en Supabase o IndexedDB (offline)
  const handleExecuteSave = async () => {
    setLoading(true);
    setShowConfirmUpload(false);
    setShowAnomalyWarning(null);
    setStatusMessage(null);

    const wasAdminNotified = adminNotified;

    try {
      const savedResult = await saveMeterReading({
        storeId: currentStore.id,
        readingDate: todayStr,
        displayValue: numericVal,
        multiplier,
        isReset: false,
        isEstimated: false,
        technicianName: wasAdminNotified ? 'Técnico de Guardia (Auditado)' : 'Técnico de Guardia',
        notes: wasAdminNotified ? 'Variación inusual confirmada por técnico en campo. Notificado al administrador.' : null
      });

      if (savedResult?._isOffline) {
        setStatusMessage({
          type: 'warning',
          text: '⚡ Guardado sin conexión: la lectura se almacenó localmente y se enviará automáticamente a la base de datos apenas recuperes señal.',
          isOffline: true
        });
      } else {
        setStatusMessage({
          type: 'success',
          text: `✓ Lectura de ${currentStore.name} registrada exitosamente.`,
          adminNotice: wasAdminNotified ? 'Se le notificará al administrador para que lo revise.' : null
        });
      }

      setAdminNotified(false);
      await loadDataForCurrentStore();
    } catch (err) {
      console.error('Error al guardar lectura:', err);
      setStatusMessage({
        type: 'error',
        text: 'Error al registrar: ' + (err.message || 'No se pudo guardar la lectura.')
      });
    } finally {
      setLoading(false);
    }
  };

  // Disparar sincronización manual de la cola offline
  const handleSyncNow = async () => {
    setIsSyncing(true);
    try {
      const res = await syncAllPendingReadings(saveMeterReading);
      if (res.syncedCount > 0) {
        setStatusMessage({
          type: 'success',
          text: `✓ ${res.syncedCount} lectura(s) sincronizada(s) con la base de datos.`
        });
        await loadDataForCurrentStore();
      }
    } catch (err) {
      console.error('Error durante sincronización manual:', err);
    } finally {
      setIsSyncing(false);
      const count = await getPendingCount();
      setPendingCount(count);
    }
  };

  // Acción Modificar -> abre confirmación de modificación
  const handleOpenEditConfirm = () => {
    setShowConfirmEdit(true);
  };

  // Habilitar modo edición tras confirmar
  const handleExecuteEdit = () => {
    setShowConfirmEdit(false);
    setIsEditing(true);
  };

  // Envío por WhatsApp formateado oficialmente
  const handleShareWhatsApp = () => {
    if (!todayReading) return;

    const text = formatWhatsAppReport({
      store: currentStore,
      readingDate: todayReading.reading_date,
      displayValue: todayReading.display_value
    });

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  // Aplicar lectura reconocida mediante Gemini OCR
  const handleApplyOcrReading = (val) => {
    setDisplayValue(String(val));
    setStatusMessage({
      type: 'success',
      text: `✓ Lectura (${val}) detectada automáticamente por Gemini Vision. Verificá y confirmá la carga.`
    });
  };

  const isRegisteredState = Boolean(todayReading) && !isEditing;

  return (
    <div className="animate-fade-in" style={{ padding: '16px', maxWidth: '580px', margin: '0 auto', paddingBottom: '90px' }}>
      {/* Selector de Local */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ fontSize: '0.8rem', color: '#A0A0A0', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontWeight: '700' }}>
          <Building2 size={15} color="#FFC72C" /> Local Seleccionado
        </label>
        <select
          value={currentStore?.id || ''}
          onChange={handleStoreChange}
          disabled={loading}
          style={{
            fontSize: '1rem',
            fontWeight: '800',
            backgroundColor: '#27251F',
            border: '2px solid #FFC72C',
            color: '#FFFFFF',
            borderRadius: '12px',
            padding: '12px 14px',
            minHeight: '48px',
            width: '100%',
            outline: 'none'
          }}
        >
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.code})
            </option>
          ))}
        </select>
      </div>

      {statusMessage && (
        <div style={{
          padding: '14px 16px',
          borderRadius: '12px',
          marginBottom: '16px',
          backgroundColor: statusMessage.type === 'success' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(218, 41, 28, 0.15)',
          color: statusMessage.type === 'success' ? '#86efac' : '#fca5a5',
          border: `1px solid ${statusMessage.type === 'success' ? '#22c55e' : '#DA291C'}`,
          fontSize: '0.88rem',
          fontWeight: '700'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {statusMessage.type === 'success' ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
            <span>{statusMessage.text}</span>
          </div>
          {statusMessage.adminNotice && (
            <div style={{
              marginTop: '10px',
              padding: '8px 12px',
              backgroundColor: '#1D1D1D',
              border: '1px solid #FFC72C',
              borderRadius: '8px',
              fontSize: '0.8rem',
              color: '#FFC72C',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span>⚡</span>
              <span>{statusMessage.adminNotice}</span>
            </div>
          )}
        </div>
      )}

      {/* Banner de Conectividad Offline / Pendientes de Sincronización */}
      {(!isOnline || pendingCount > 0) && (
        <div style={{
          backgroundColor: !isOnline ? '#2A1F13' : '#142319',
          border: !isOnline ? '1.5px solid #F59E0B' : '1.5px solid #22c55e',
          borderRadius: '12px',
          padding: '10px 14px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          boxShadow: '0 4px 14px rgba(0,0,0,0.4)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem' }}>
            {!isOnline ? (
              <WifiOff size={18} color="#F59E0B" style={{ flexShrink: 0 }} />
            ) : (
              <Wifi size={18} color="#4ade80" style={{ flexShrink: 0 }} />
            )}
            <span style={{ color: !isOnline ? '#FCD34D' : '#86EFAC', fontWeight: '600', lineHeight: '1.3' }}>
              {!isOnline
                ? 'Modo sin conexión: las lecturas se guardan localmente en tu dispositivo y se enviarán al recuperar señal.'
                : `${pendingCount} lectura(s) guardada(s) localmente lista(s) para sincronizar.`}
            </span>
          </div>

          {isOnline && pendingCount > 0 && (
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={isSyncing}
              style={{
                backgroundColor: '#22c55e',
                color: '#000000',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '0.78rem',
                fontWeight: '800',
                cursor: isSyncing ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                flexShrink: 0
              }}
            >
              <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
              {isSyncing ? 'Enviando...' : 'Sincronizar'}
            </button>
          )}
        </div>
      )}

      {/* HUD PRINCIPAL - Tarjeta de Alto Contraste para Luz Solar */}
      <div className="card" style={{
        backgroundColor: '#27251F',
        border: '1px solid #3A3833',
        borderRadius: '18px',
        padding: '22px 18px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        marginBottom: '16px'
      }}>
        {/* Cabecera del HUD */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #3A3833', paddingBottom: '12px' }}>
          <div>
            <span style={{ fontSize: '0.72rem', color: '#FFC72C', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '800' }}>
              REGISTRO DIARIO (12:00 PM)
            </span>
            <div style={{ fontSize: '1.05rem', fontWeight: '900', color: '#FFFFFF', marginTop: '2px' }}>
              {currentStore?.name}
            </div>
          </div>
          <span style={{
            backgroundColor: '#1D1D1D',
            color: '#FFC72C',
            border: '1px solid #FFC72C',
            padding: '4px 12px',
            borderRadius: '8px',
            fontSize: '0.88rem',
            fontWeight: '900'
          }}>
            {currentStore?.code}
          </span>
        </div>

        {/* ESTADO 1: LECTURA YA CARGADA EN EL DÍA */}
        {isRegisteredState ? (
          <div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: '#4ade80',
              fontSize: '0.88rem',
              fontWeight: '800',
              marginBottom: '12px'
            }}>
              <CheckCircle2 size={18} /> Lectura de hoy registrada
            </div>

            <div style={{
              backgroundColor: '#1D1D1D',
              border: '2px solid #3A3833',
              borderRadius: '14px',
              padding: '20px',
              textAlign: 'center',
              marginBottom: '18px'
            }}>
              <div style={{
                fontSize: '2.8rem',
                fontWeight: '900',
                color: '#FFC72C',
                fontFamily: 'monospace',
                letterSpacing: '1px'
              }}>
                {todayReading.display_value}
              </div>
              <span style={{ fontSize: '0.75rem', color: '#A0A0A0', marginTop: '4px', display: 'block' }}>
                Registrado para hoy ({todayReading.reading_date})
              </span>
              {todayReading.is_pending_sync && (
                <div style={{ marginTop: '8px' }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    backgroundColor: 'rgba(255, 199, 44, 0.15)',
                    color: '#FFC72C',
                    border: '1px solid #FFC72C',
                    borderRadius: '6px',
                    padding: '3px 8px',
                    fontSize: '0.72rem',
                    fontWeight: '800',
                    textTransform: 'uppercase'
                  }}>
                    ⏳ Guardado Offline (Pendiente de sincronizar)
                  </span>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={handleOpenEditConfirm}
                className="btn-secondary"
                style={{
                  flex: 1,
                  minHeight: '48px',
                  borderRadius: '12px',
                  fontSize: '0.95rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                <Edit3 size={18} />
                Modificar
              </button>

              <button
                type="button"
                onClick={handleShareWhatsApp}
                className="btn-mcd-yellow"
                style={{
                  flex: 1,
                  minHeight: '48px',
                  borderRadius: '12px',
                  fontSize: '0.95rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
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
            <div style={{ marginBottom: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <label style={{
                  fontSize: '0.88rem',
                  color: '#FFC72C',
                  fontWeight: '800'
                }}>
                  {isEditing ? 'Modificar lectura del medidor:' : 'Cargar lectura del medidor:'}
                </label>
                <button
                  type="button"
                  onClick={() => setIsOcrOpen(true)}
                  style={{
                    backgroundColor: '#1D1D1D',
                    border: '1px solid #FFC72C',
                    color: '#FFC72C',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    fontSize: '0.8rem',
                    fontWeight: '800',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.3)'
                  }}
                >
                  <Camera size={15} />
                  Escanear con IA
                </button>
              </div>

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
                    fontSize: '2.5rem',
                    fontWeight: '900',
                    fontFamily: 'monospace',
                    letterSpacing: '1px',
                    textAlign: 'center',
                    padding: '16px 12px',
                    minHeight: '72px',
                    backgroundColor: '#1D1D1D',
                    border: isSpikeOverAverage
                      ? '2px solid #F59E0B'
                      : projectedConsumption !== null && projectedConsumption < 0
                      ? '2px solid #DA291C'
                      : '2px solid #FFC72C',
                    borderRadius: '14px',
                    color: '#FFC72C',
                    width: '100%',
                    outline: 'none',
                    transition: 'border-color 0.2s ease'
                  }}
                />
              </div>

              {/* Indicador de cálculo en tiempo real y validación predictiva */}
              {projectedConsumption !== null && numericVal > 0 && (
                <div style={{ marginTop: '10px' }}>
                  {/* Desglose de telemetría proyectada en tiempo real */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    backgroundColor: '#1D1D1D',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    fontSize: '0.8rem',
                    border: '1px solid #3A3833'
                  }}>
                    <span style={{ color: '#A0A0A0' }}>Consumo proyectado del día:</span>
                    <span style={{
                      fontWeight: '800',
                      fontFamily: 'monospace',
                      color: projectedConsumption < 0 ? '#F87171' : isSpikeOverAverage ? '#F59E0B' : '#4ADE80'
                    }}>
                      {projectedConsumption > 0 ? `+${projectedConsumption} kWh` : `${projectedConsumption} kWh`}
                    </span>
                  </div>

                  {/* ⚠️ Aviso preventivo: el consumo excede 1.5x el promedio diario habitual */}
                  {isSpikeOverAverage && (
                    <div style={{
                      marginTop: '8px',
                      backgroundColor: 'rgba(245, 158, 11, 0.12)',
                      border: '1.5px solid #F59E0B',
                      borderRadius: '10px',
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      color: '#FCD34D',
                      fontSize: '0.82rem',
                      lineHeight: '1.4'
                    }}>
                      <AlertTriangle size={18} color="#F59E0B" style={{ flexShrink: 0, marginTop: '2px' }} />
                      <span>
                        ⚠️ El consumo resultante (<strong>{projectedConsumption} kWh</strong>) supera en un{' '}
                        <strong>{excessPct}%</strong> el promedio diario habitual ({storeDailyAvg} kWh). Verificá que los dígitos ingresados coincidan con el display.
                      </span>
                    </div>
                  )}

                  {/* Aviso si la lectura es menor al día anterior (consumo negativo) */}
                  {projectedConsumption < 0 && (
                    <div style={{
                      marginTop: '8px',
                      backgroundColor: 'rgba(218, 41, 28, 0.12)',
                      border: '1.5px solid #DA291C',
                      borderRadius: '10px',
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      color: '#FCA5A5',
                      fontSize: '0.82rem',
                      lineHeight: '1.4'
                    }}>
                      <AlertTriangle size={18} color="#DA291C" style={{ flexShrink: 0, marginTop: '2px' }} />
                      <span>
                        ⚠️ La lectura ingresada es menor a la del día anterior ({previousReading?.display_value}), generando consumo negativo ({projectedConsumption} kWh). Verificá los números físicos.
                      </span>
                    </div>
                  )}
                </div>
              )}

              <span style={{ fontSize: '0.78rem', color: '#A0A0A0', display: 'block', marginTop: '8px', textAlign: 'center' }}>
                Ingresa únicamente los números visibles en la pantalla física
              </span>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="submit"
                disabled={loading || numericVal <= 0}
                className="btn-mcd-yellow"
                style={{
                  flex: 1,
                  minHeight: '48px',
                  borderRadius: '12px',
                  fontSize: '1.05rem',
                  boxShadow: '0 4px 14px rgba(255, 199, 44, 0.3)'
                }}
              >
                <UploadCloud size={20} />
                {isEditing ? 'Guardar Cambios' : 'Cargar'}
              </button>

              {isEditing && (
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="btn-secondary"
                  style={{
                    minHeight: '48px',
                    padding: '0 20px',
                    borderRadius: '12px'
                  }}
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>
        )}
      </div>

      {/* PARTE INFERIOR: REFERENCIA DEL DÍA ANTERIOR */}
      <div className="card" style={{
        backgroundColor: '#27251F',
        border: '1px solid #3A3833',
        borderRadius: '14px',
        padding: '16px 18px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div>
          <span style={{ fontSize: '0.88rem', color: '#A0A0A0', fontWeight: '700', display: 'block' }}>
            Lectura día anterior:
          </span>
          {previousReading?.reading_date && (
            <span style={{ fontSize: '0.74rem', color: '#888888', marginTop: '2px', display: 'block' }}>
              Fecha: {previousReading.reading_date}
            </span>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: '1.5rem', fontWeight: '900', color: '#FFC72C', fontFamily: 'monospace' }}>
            {previousReading ? previousReading.display_value : 'Sin registro previo'}
          </span>
          {storeDailyAvg > 0 && (
            <span style={{ fontSize: '0.74rem', color: '#A0A0A0', display: 'block', marginTop: '2px' }}>
              Promedio habitual: <strong style={{ color: '#E0E0E0' }}>{storeDailyAvg} kWh/día</strong>
            </span>
          )}
        </div>
      </div>

      {/* CONFIRMACIÓN DE CARGA */}
      {showConfirmUpload && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.78)',
          backdropFilter: 'blur(4px)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div className="card animate-slide-up" style={{
            backgroundColor: '#27251F',
            border: '2px solid #FFC72C',
            borderRadius: '18px',
            padding: '24px',
            width: '100%',
            maxWidth: '380px',
            boxShadow: '0 16px 36px rgba(0,0,0,0.85)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#FFC72C', marginBottom: '12px' }}>
              <HelpCircle size={24} />
              <h3 style={{ fontSize: '1.2rem', fontWeight: '900', margin: 0, color: '#FFFFFF' }}>
                Confirmar Carga
              </h3>
            </div>

            <p style={{ fontSize: '0.88rem', color: '#CCCCCC', marginBottom: '14px' }}>
              ¿Confirmas registrar el siguiente valor para <strong>{currentStore?.name}</strong>?
            </p>

            {adminNotified && (
              <div style={{
                backgroundColor: 'rgba(218, 41, 28, 0.15)',
                border: '1px solid #DA291C',
                borderRadius: '8px',
                padding: '8px 12px',
                fontSize: '0.78rem',
                color: '#FCA5A5',
                marginBottom: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <AlertTriangle size={15} color="#DA291C" />
                <span>Variación atípica aprobada: se notificará al administrador.</span>
              </div>
            )}

            <div style={{
              backgroundColor: '#1D1D1D',
              borderRadius: '12px',
              padding: '16px',
              textAlign: 'center',
              marginBottom: '18px',
              border: '1px solid #3A3833'
            }}>
              <span style={{ fontSize: '0.72rem', color: '#888888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>VALOR INGRESADO</span>
              <div style={{ fontSize: '2.4rem', fontWeight: '900', color: '#FFC72C', fontFamily: 'monospace' }}>
                {displayValue}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setShowConfirmUpload(false)}
                className="btn-secondary"
                style={{
                  flex: 1,
                  minHeight: '48px',
                  borderRadius: '10px'
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExecuteSave}
                className="btn-mcd-yellow"
                style={{
                  flex: 1,
                  minHeight: '48px',
                  borderRadius: '10px'
                }}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ALERTA DE VARIACIÓN INUSUAL (PICO ELEVADO O CONSUMO ANÓMALO) */}
      {showAnomalyWarning && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.82)',
          backdropFilter: 'blur(5px)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div className="card animate-slide-up" style={{
            backgroundColor: '#27251F',
            border: '2px solid #DA291C',
            borderRadius: '18px',
            padding: '24px',
            width: '100%',
            maxWidth: '400px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.9)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#DA291C', marginBottom: '14px' }}>
              <div style={{
                backgroundColor: 'rgba(218, 41, 28, 0.15)',
                padding: '8px',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <AlertTriangle size={24} color="#DA291C" />
              </div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: '900', margin: 0, color: '#FFFFFF' }}>
                Variación Inusual
              </h3>
            </div>

            <p style={{ fontSize: '0.88rem', color: '#DDDDDD', marginBottom: '14px', lineHeight: 1.4 }}>
              {showAnomalyWarning.isHighSpike ? (
                <>
                  El valor ingresado arroja un consumo estimado de{' '}
                  <strong style={{ color: '#FFC72C' }}>{showAnomalyWarning.estCons.toFixed(1)} kWh</strong>
                  {showAnomalyWarning.storeDailyAvg > 0 ? (
                    <>, lo que supera en un <strong style={{ color: '#F87171' }}>{showAnomalyWarning.excessPct}%</strong> el promedio diario habitual ({showAnomalyWarning.storeDailyAvg} kWh).</>
                  ) : (
                    <>, lo que supera el doble del consumo del día anterior ({showAnomalyWarning.prevCons.toFixed(1)} kWh).</>
                  )}
                  <br /><br />
                  Verificá que los dígitos ingresados coincidan con el display físico antes de confirmar.
                </>
              ) : (
                <>
                  La lectura ingresada es menor a la del día anterior ({previousReading?.display_value}),
                  lo cual generaría un consumo negativo. Si hubo reinicio o reemplazo de medidor, debes marcarlo como lectura base.
                </>
              )}
            </p>

            <div style={{
              backgroundColor: '#1D1D1D',
              border: '1px solid #3A3833',
              borderRadius: '12px',
              padding: '12px 14px',
              marginBottom: '18px',
              fontSize: '0.78rem',
              color: '#A0A0A0'
            }}>
              <span style={{ color: '#FFC72C', fontWeight: '700', display: 'block', marginBottom: '3px' }}>
                ℹ️ Protocolo Operativo:
              </span>
              Si decides cargarlo de todas formas, se le notificará al administrador para que lo revise y audite técnicamente.
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setShowAnomalyWarning(null)}
                className="btn-secondary"
                style={{
                  flex: 1,
                  minHeight: '48px',
                  borderRadius: '10px'
                }}
              >
                Revisar Lectura
              </button>
              <button
                type="button"
                onClick={handleProceedWithAnomaly}
                className="btn-mcd-red"
                style={{
                  flex: 1,
                  minHeight: '48px',
                  borderRadius: '10px'
                }}
              >
                Cargar Igual
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
          backgroundColor: 'rgba(0,0,0,0.78)',
          backdropFilter: 'blur(4px)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div className="card animate-slide-up" style={{
            backgroundColor: '#27251F',
            border: '2px solid #38BDF8',
            borderRadius: '18px',
            padding: '24px',
            width: '100%',
            maxWidth: '380px',
            boxShadow: '0 16px 36px rgba(0,0,0,0.85)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#38BDF8', marginBottom: '12px' }}>
              <Edit3 size={24} />
              <h3 style={{ fontSize: '1.2rem', fontWeight: '900', margin: 0, color: '#FFFFFF' }}>
                Modificar Lectura
              </h3>
            </div>

            <p style={{ fontSize: '0.88rem', color: '#CCCCCC', marginBottom: '16px' }}>
              El local <strong>{currentStore?.name}</strong> ya tiene una lectura registrada hoy de <strong>{todayReading?.display_value}</strong>.
              <br /><br />
              ¿Deseas modificar este valor?
            </p>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setShowConfirmEdit(false)}
                className="btn-secondary"
                style={{
                  flex: 1,
                  minHeight: '48px',
                  borderRadius: '10px'
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExecuteEdit}
                style={{
                  flex: 1,
                  minHeight: '48px',
                  backgroundColor: '#38BDF8',
                  color: '#0F172A',
                  borderRadius: '10px',
                  fontWeight: '800'
                }}
              >
                Modificar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal OCR Gemini Vision */}
      <MeterOcrModal
        isOpen={isOcrOpen}
        onClose={() => setIsOcrOpen(false)}
        currentStore={currentStore}
        onApplyReading={handleApplyOcrReading}
      />

      <AppFooter />
    </div>
  );
}
