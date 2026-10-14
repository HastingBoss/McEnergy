import { useState, useEffect } from 'react';
import {
  Building2,
  CheckCircle2,
  AlertTriangle,
  Edit3,
  UploadCloud,
  Send,
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
      setStatusMessage({ type: 'success', text: `Lectura registrada: ${numericVal} en ${currentStore.name}.` });
      await loadDataForCurrentStore();
    } catch (err) {
      setStatusMessage({ type: 'error', text: err.message || 'Error al guardar la lectura.' });
    } finally {
      setLoading(false);
    }
  };

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
      displayValue: todayReading.display_value
    });

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const isRegisteredState = Boolean(todayReading) && !isEditing;
  const lastReading = previousReading || todayReading;

  return (
    <div style={{ padding: '16px', maxWidth: '580px', margin: '0 auto', paddingBottom: '90px' }}>
      {/* Selector de Local */}
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
            padding: '12px 14px',
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
        marginBottom: '16px'
      }}>
        {/* Cabecera del HUD */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid #262626', paddingBottom: '10px' }}>
          <div>
            <span style={{ fontSize: '0.72rem', color: '#888888', textTransform: 'uppercase', letterSpacing: '1px' }}>
              REGISTRO DIARIO
            </span>
            <div style={{ fontSize: '1rem', fontWeight: '800', color: '#FFFFFF' }}>
              {currentStore?.name}
            </div>
          </div>
          <span style={{
            backgroundColor: '#262626',
            color: '#FFBC0D',
            padding: '4px 10px',
            borderRadius: '6px',
            fontSize: '0.85rem',
            fontWeight: '800'
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
              color: '#22c55e',
              fontSize: '0.85rem',
              fontWeight: '700',
              marginBottom: '10px'
            }}>
              <CheckCircle2 size={16} /> Lectura de hoy registrada
            </div>

            <div style={{
              backgroundColor: '#0A0A0A',
              border: '1px solid #333333',
              borderRadius: '12px',
              padding: '18px',
              textAlign: 'center',
              marginBottom: '16px'
            }}>
              <div style={{
                fontSize: '2.8rem',
                fontWeight: '900',
                color: '#FFBC0D',
                fontFamily: 'monospace',
                letterSpacing: '1px'
              }}>
                {todayReading.display_value}
              </div>
              <span style={{ fontSize: '0.75rem', color: '#888888' }}>
                Registrado para hoy ({todayReading.reading_date})
              </span>
            </div>

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
                Modificar
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
                    fontSize: '2.4rem',
                    fontWeight: '900',
                    fontFamily: 'monospace',
                    letterSpacing: '1px',
                    textAlign: 'center',
                    padding: '16px 12px',
                    backgroundColor: '#0A0A0A',
                    border: '2px solid #FFBC0D',
                    borderRadius: '12px',
                    color: '#FFBC0D',
                    width: '100%',
                    outline: 'none'
                  }}
                />
              </div>
              <span style={{ fontSize: '0.75rem', color: '#888888', display: 'block', marginTop: '6px', textAlign: 'center' }}>
                Ingresa el valor numérico visible en el display
              </span>
            </div>

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

      {/* PARTE INFERIOR: REFERENCIA DEL DÍA ANTERIOR */}
      <div style={{
        backgroundColor: '#1A1A1A',
        border: '1px solid #282828',
        borderRadius: '12px',
        padding: '16px 18px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div>
          <span style={{ fontSize: '0.88rem', color: '#A0A0A0', fontWeight: '600', display: 'block' }}>
            Lectura día anterior:
          </span>
          {previousReading?.reading_date && (
            <span style={{ fontSize: '0.72rem', color: '#666666', marginTop: '2px', display: 'block' }}>
              Fecha: {previousReading.reading_date}
            </span>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: '1.4rem', fontWeight: '900', color: '#FFBC0D', fontFamily: 'monospace' }}>
            {previousReading ? previousReading.display_value : 'Sin registro previo'}
          </span>
        </div>
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
            maxWidth: '380px',
            boxShadow: '0 12px 30px rgba(0,0,0,0.8)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#FFBC0D', marginBottom: '12px' }}>
              <HelpCircle size={22} />
              <h3 style={{ fontSize: '1.15rem', fontWeight: '800', margin: 0, color: '#FFFFFF' }}>
                Confirmar Carga
              </h3>
            </div>

            <p style={{ fontSize: '0.88rem', color: '#CCCCCC', marginBottom: '14px' }}>
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
              <div style={{ fontSize: '2.2rem', fontWeight: '900', color: '#FFBC0D', fontFamily: 'monospace' }}>
                {displayValue}
              </div>
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
                Confirmar
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
            maxWidth: '380px',
            boxShadow: '0 12px 30px rgba(0,0,0,0.8)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#38BDF8', marginBottom: '12px' }}>
              <Edit3 size={22} />
              <h3 style={{ fontSize: '1.15rem', fontWeight: '800', margin: 0, color: '#FFFFFF' }}>
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
                Modificar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
