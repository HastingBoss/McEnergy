import { useState, useEffect } from 'react';
import { supabase } from '../../services/supabaseClient';
import {
  BarChart3,
  Calendar,
  ArrowDownRight,
  ArrowUpRight,
  RefreshCw,
  Lock,
  Unlock,
  KeyRound,
  AlertCircle
} from 'lucide-react';
import { getPreviousYearDate } from '../../services/meterService';
import { useStore } from '../../context/StoreContext';

export default function GlobalDashboard() {
  const { stores: allStores } = useStore();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [readings, setReadings] = useState([]);
  const [prevYearReadings, setPrevYearReadings] = useState([]);
  const [loading, setLoading] = useState(true);

  // Estado de autenticación para Coordinador / Admin
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem('mcd_dashboard_unlocked') === 'true';
  });
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(null);
  const [verifyingPin, setVerifyingPin] = useState(false);

  const prevYearDate = getPreviousYearDate(selectedDate);

  useEffect(() => {
    if (isAuthenticated) {
      loadDashboardData();
    }
  }, [selectedDate, isAuthenticated]);

  const handleVerifyPin = async (e) => {
    e.preventDefault();
    if (!pinInput.trim()) return;

    setVerifyingPin(true);
    setPinError(null);

    try {
      const { data: isValid, error } = await supabase.rpc('verify_dashboard_pin', {
        pin_input: pinInput.trim()
      });

      if (error) throw error;

      if (isValid) {
        sessionStorage.setItem('mcd_dashboard_unlocked', 'true');
        setIsAuthenticated(true);
        setPinInput('');
      } else {
        setPinError('Clave incorrecta. Acceso denegado.');
      }
    } catch (err) {
      console.error('Error al verificar clave:', err);
      setPinError('Error de conexión al validar clave.');
    } finally {
      setVerifyingPin(false);
    }
  };

  const handleLockDashboard = () => {
    sessionStorage.removeItem('mcd_dashboard_unlocked');
    setIsAuthenticated(false);
    setPinInput('');
  };

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const [currentRes, prevRes] = await Promise.all([
        supabase
          .from('meter_readings')
          .select('*')
          .eq('reading_date', selectedDate),
        supabase
          .from('meter_readings')
          .select('*')
          .eq('reading_date', prevYearDate)
      ]);

      setReadings(currentRes.data || []);
      setPrevYearReadings(prevRes.data || []);
    } catch (err) {
      console.error('Error al cargar dashboard global:', err);
    } finally {
      setLoading(false);
    }
  };

  // PANTALLA DE BLOQUEO / INGRESO DE CLAVE
  if (!isAuthenticated) {
    return (
      <div style={{
        padding: '16px',
        maxWidth: '420px',
        margin: '40px auto 0',
        paddingBottom: '90px'
      }}>
        <div style={{
          backgroundColor: '#1E1E1E',
          border: '1px solid #333333',
          borderRadius: '16px',
          padding: '28px 20px',
          textAlign: 'center',
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)'
        }}>
          <div style={{
            backgroundColor: '#262626',
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            color: '#FFBC0D'
          }}>
            <Lock size={28} />
          </div>

          <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: '#FFFFFF', margin: '0 0 6px' }}>
            Acceso al Dashboard
          </h2>
          <p style={{ fontSize: '0.85rem', color: '#888888', margin: '0 0 20px' }}>
            Ingresa la clave de Coordinador o Administrador para acceder al consolidado de la red.
          </p>

          <form onSubmit={handleVerifyPin}>
            <div style={{ position: 'relative', marginBottom: '14px' }}>
              <input
                type="password"
                inputMode="numeric"
                required
                autoFocus
                placeholder="Ingresar clave..."
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                disabled={verifyingPin}
                style={{
                  width: '100%',
                  padding: '14px 14px',
                  backgroundColor: '#0A0A0A',
                  border: pinError ? '2px solid #ef4444' : '2px solid #FFBC0D',
                  borderRadius: '10px',
                  color: '#FFFFFF',
                  fontSize: '1.2rem',
                  fontWeight: '700',
                  textAlign: 'center',
                  letterSpacing: '3px',
                  outline: 'none'
                }}
              />
            </div>

            {pinError && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                color: '#f87171',
                fontSize: '0.82rem',
                marginBottom: '14px'
              }}>
                <AlertCircle size={15} />
                <span>{pinError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={verifyingPin || !pinInput}
              style={{
                width: '100%',
                backgroundColor: '#FFBC0D',
                color: '#121212',
                padding: '14px',
                borderRadius: '10px',
                fontSize: '1rem',
                fontWeight: '800',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              <KeyRound size={18} />
              {verifyingPin ? 'Verificando...' : 'Ingresar'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // DASHBOARD DESBLOQUEADO
  const totalCurrent = readings.reduce((acc, curr) => acc + (parseFloat(curr.calculated_consumption) || 0), 0);
  const totalPrev = prevYearReadings.reduce((acc, curr) => acc + (parseFloat(curr.calculated_consumption) || 0), 0);
  const netDiff = totalCurrent - totalPrev;
  const netDiffPct = totalPrev > 0 ? ((netDiff / totalPrev) * 100).toFixed(1) : 0;
  const isSaving = netDiff <= 0;

  const averageConsumption = readings.length > 0 ? (totalCurrent / readings.length).toFixed(1) : 0;

  return (
    <div style={{ padding: '16px', maxWidth: '820px', margin: '0 auto', paddingBottom: '90px' }}>
      {/* Encabezado */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
            <BarChart3 color="#FFBC0D" size={24} />
            Consumo Eléctrico de la Red
          </h2>
          <p style={{ fontSize: '0.8rem', color: '#A0A0A0', margin: '2px 0 0 0' }}>
            Monitoreo diario consolidado de todos los locales
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Calendar size={18} color="#FFBC0D" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{ padding: '6px 10px', fontSize: '0.85rem', width: 'auto' }}
          />
          <button
            onClick={loadDashboardData}
            style={{ backgroundColor: '#262626', border: '1px solid #383838', color: '#FFBC0D', padding: '6px 10px', borderRadius: '8px' }}
            title="Recargar"
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={handleLockDashboard}
            style={{ backgroundColor: '#262626', border: '1px solid #383838', color: '#A0A0A0', padding: '6px 10px', borderRadius: '8px' }}
            title="Bloquear acceso"
          >
            <Unlock size={15} />
          </button>
        </div>
      </div>

      {/* Métricas Resumen Red */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <div className="card">
          <div style={{ fontSize: '0.78rem', color: '#888888' }}>Total Red ({selectedDate})</div>
          <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#FFBC0D', marginTop: '4px' }}>
            {totalCurrent.toLocaleString('es-AR', { maximumFractionDigits: 1 })} <span style={{ fontSize: '0.85rem' }}>kWh</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#A0A0A0', marginTop: '2px' }}>
            {readings.length} de {allStores.length} locales cargados hoy
          </div>
        </div>

        <div className="card">
          <div style={{ fontSize: '0.78rem', color: '#888888' }}>Mismo Día Año Anterior ({prevYearDate})</div>
          <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#38BDF8', marginTop: '4px' }}>
            {totalPrev.toLocaleString('es-AR', { maximumFractionDigits: 1 })} <span style={{ fontSize: '0.85rem' }}>kWh</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#A0A0A0', marginTop: '2px' }}>
            Promedio local: {averageConsumption} kWh
          </div>
        </div>

        <div className="card" style={{
          borderLeft: totalPrev > 0 ? (isSaving ? '4px solid #22c55e' : '4px solid #ef4444') : '4px solid #6b7280'
        }}>
          <div style={{ fontSize: '0.78rem', color: '#888888' }}>Variación Red Interanual</div>
          <div style={{
            fontSize: '1.5rem',
            fontWeight: '800',
            color: totalPrev > 0 ? (isSaving ? '#4ade80' : '#f87171') : '#A0A0A0',
            marginTop: '4px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            {totalPrev > 0 ? (
              <>
                {isSaving ? <ArrowDownRight size={22} /> : <ArrowUpRight size={22} />}
                {netDiff > 0 ? '+' : ''}{netDiff.toLocaleString('es-AR', { maximumFractionDigits: 1 })} kWh
              </>
            ) : (
              'Sin histórico'
            )}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#A0A0A0', marginTop: '2px' }}>
            {totalPrev > 0 ? `${netDiff > 0 ? '+' : ''}${netDiffPct}% vs año anterior` : 'Requiere datos de ' + prevYearDate}
          </div>
        </div>
      </div>

      {/* Lista de Locales */}
      <h3 style={{ fontSize: '1rem', fontWeight: '700', marginBottom: '10px', color: '#FFFFFF' }}>
        Estado por Local ({selectedDate})
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {allStores.map((store) => {
          const currentReading = readings.find((r) => r.store_id === store.id);
          const prevReading = prevYearReadings.find((r) => r.store_id === store.id);

          const hasReported = Boolean(currentReading);
          const consumption = currentReading ? parseFloat(currentReading.calculated_consumption) : null;
          const prevConsumption = prevReading ? parseFloat(prevReading.calculated_consumption) : null;

          let diff = null;
          let diffPct = null;
          if (consumption !== null && prevConsumption !== null) {
            diff = consumption - prevConsumption;
            diffPct = prevConsumption > 0 ? ((diff / prevConsumption) * 100).toFixed(1) : 0;
          }

          const isStoreSaving = diff !== null && diff <= 0;

          return (
            <div
              key={store.id}
              className="card"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 14px',
                borderLeft: hasReported ? '4px solid #22c55e' : '4px solid #4b5563'
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <strong style={{ fontSize: '0.98rem', color: '#FFFFFF' }}>{store.name}</strong>
                  <span style={{ fontSize: '0.7rem', color: '#A0A0A0', backgroundColor: '#262626', padding: '1px 6px', borderRadius: '4px' }}>
                    {store.code}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#888888', marginTop: '3px' }}>
                  {hasReported
                    ? `Display: ${currentReading.display_value} • ${currentReading.technician_name ? `Técnico: ${currentReading.technician_name}` : 'Registrado'}`
                    : 'Pendiente de carga'}
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                {hasReported && consumption !== null ? (
                  <>
                    <div style={{ fontWeight: '800', fontSize: '1.15rem', color: '#FFBC0D' }}>
                      {consumption.toLocaleString('es-AR')} kWh
                    </div>
                    {diff !== null && (
                      <span style={{
                        fontSize: '0.72rem',
                        color: isStoreSaving ? '#4ade80' : '#f87171',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        gap: '2px',
                        marginTop: '2px'
                      }}>
                        {isStoreSaving ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}
                        {diff > 0 ? '+' : ''}{diff.toFixed(1)} kWh ({diff > 0 ? '+' : ''}{diffPct}%)
                      </span>
                    )}
                  </>
                ) : (
                  <span style={{ fontSize: '0.8rem', color: '#6b7280', fontStyle: 'italic' }}>
                    Sin datos
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
