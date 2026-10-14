import { useState, useEffect } from 'react';
import { supabase } from '../../services/supabaseClient';
import {
  BarChart3,
  TrendingUp,
  Calendar,
  ArrowDownRight,
  ArrowUpRight,
  RefreshCw,
  Lock,
  Unlock,
  KeyRound,
  AlertCircle,
  FileSpreadsheet,
  Download,
  CheckCircle2
} from 'lucide-react';
import { getPreviousYearDate } from '../../services/meterService';
import { useStore } from '../../context/StoreContext';
import ConsumptionComparison from '../ConsumptionComparison/ConsumptionComparison';
import { downloadReportFile } from '../../services/reportExportService';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

export default function GlobalDashboard() {
  const { stores: allStores, currentStore } = useStore();
  const now = new Date();
  const [selectedDate, setSelectedDate] = useState(now.toISOString().split('T')[0]);
  const [readings, setReadings] = useState([]);
  const [prevYearReadings, setPrevYearReadings] = useState([]);
  const [loading, setLoading] = useState(true);

  // Tab unificada: 'network' (Red Global Día), 'comparison' (Comparativa Anual) o 'export' (Exportar Informe)
  const [activeTab, setActiveTab] = useState('network');

  // Estado para exportación a Excel
  const [exportMonth, setExportMonth] = useState(now.getMonth() + 1);
  const [exportYear, setExportYear] = useState(now.getFullYear());
  const [exportStoreId, setExportStoreId] = useState('all');
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(null);

  // Estado de autenticación para Coordinador / Admin
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem('mcd_dashboard_unlocked') === 'true';
  });
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(null);
  const [verifyingPin, setVerifyingPin] = useState(false);

  const prevYearDate = getPreviousYearDate(selectedDate);

  useEffect(() => {
    if (isAuthenticated && activeTab === 'network') {
      loadDashboardData();
    }
  }, [selectedDate, isAuthenticated, activeTab]);

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
            Panel de Gestión & Auditoría
          </h2>
          <p style={{ fontSize: '0.85rem', color: '#888888', margin: '0 0 20px' }}>
            Ingresa la clave de Coordinador o Administrador para acceder a la Red Global y Comparativas.
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

  // DASHBOARD DESBLOQUEADO (UNIFICADO)
  const totalCurrent = readings.reduce((acc, curr) => acc + (parseFloat(curr.calculated_consumption) || 0), 0);
  const totalPrev = prevYearReadings.reduce((acc, curr) => acc + (parseFloat(curr.calculated_consumption) || 0), 0);
  const netDiff = totalCurrent - totalPrev;
  const netDiffPct = totalPrev > 0 ? ((netDiff / totalPrev) * 100).toFixed(1) : 0;
  const isSaving = netDiff <= 0;

  const averageConsumption = readings.length > 0 ? (totalCurrent / readings.length).toFixed(1) : 0;

  return (
    <div style={{ padding: '16px', maxWidth: '820px', margin: '0 auto', paddingBottom: '90px' }}>
      {/* Selector de Pestañas Unificadas */}
      <div style={{
        display: 'flex',
        backgroundColor: '#1E1E1E',
        borderRadius: '12px',
        padding: '4px',
        marginBottom: '16px',
        border: '1px solid #2D2D2D'
      }}>
        <button
          onClick={() => setActiveTab('network')}
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '0.88rem',
            fontWeight: '700',
            backgroundColor: activeTab === 'network' ? '#FFBC0D' : 'transparent',
            color: activeTab === 'network' ? '#121212' : '#A0A0A0',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            transition: 'all 0.2s ease',
            cursor: 'pointer'
          }}
        >
          <BarChart3 size={16} />
          Red Global (Día)
        </button>

        <button
          onClick={() => setActiveTab('comparison')}
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '0.88rem',
            fontWeight: '700',
            backgroundColor: activeTab === 'comparison' ? '#FFBC0D' : 'transparent',
            color: activeTab === 'comparison' ? '#121212' : '#A0A0A0',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            transition: 'all 0.2s ease',
            cursor: 'pointer'
          }}
        >
          <TrendingUp size={16} />
          Comparativa Anual
        </button>

        <button
          onClick={() => setActiveTab('export')}
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '0.88rem',
            fontWeight: '700',
            backgroundColor: activeTab === 'export' ? '#FFBC0D' : 'transparent',
            color: activeTab === 'export' ? '#121212' : '#A0A0A0',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            transition: 'all 0.2s ease',
            cursor: 'pointer'
          }}
        >
          <FileSpreadsheet size={16} />
          Exportar Excel
        </button>

        <button
          onClick={handleLockDashboard}
          style={{
            backgroundColor: 'transparent',
            border: 'none',
            color: '#888888',
            padding: '10px 12px',
            borderRadius: '8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          title="Bloquear acceso"
        >
          <Unlock size={16} />
        </button>
      </div>

      {/* VISTA 1: RED GLOBAL (DÍA) */}
      {activeTab === 'network' && (
        <div>
          {/* Encabezado */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                <BarChart3 color="#FFBC0D" size={24} />
                Consumo Diario de la Red
              </h2>
              <p style={{ fontSize: '0.8rem', color: '#A0A0A0', margin: '2px 0 0 0' }}>
                Monitoreo consolidado de los 5 locales
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
      )}

      {/* VISTA 2: COMPARATIVA ANUAL (MES A MES) */}
      {activeTab === 'comparison' && (
        <ConsumptionComparison isEmbedded={true} />
      )}

      {/* VISTA 3: EXPORTACIÓN DE INFORMES EXCEL */}
      {activeTab === 'export' && (
        <div>
          <div style={{ marginBottom: '16px' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
              <FileSpreadsheet color="#FFBC0D" size={24} />
              Exportación de Informes Eléctricos (Excel)
            </h2>
            <p style={{ fontSize: '0.82rem', color: '#A0A0A0', margin: '4px 0 0 0' }}>
              Generación de planillas estructuradas con comparativa interanual, auditoría de carga y meta de ahorro.
            </p>
          </div>

          {/* Formulario de Configuración del Reporte */}
          <div className="card" style={{ padding: '20px', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: '700', color: '#FFFFFF', marginBottom: '14px' }}>
              Parámetros del Reporte
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '18px' }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: '#888888', display: 'block', marginBottom: '6px' }}>
                  Mes del Período
                </label>
                <select
                  value={exportMonth}
                  onChange={(e) => setExportMonth(Number(e.target.value))}
                  disabled={isExporting}
                  style={{ width: '100%', padding: '10px 12px', fontSize: '0.9rem' }}
                >
                  {MONTH_NAMES.map((name, idx) => (
                    <option key={idx} value={idx + 1}>{name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: '#888888', display: 'block', marginBottom: '6px' }}>
                  Año del Período
                </label>
                <select
                  value={exportYear}
                  onChange={(e) => setExportYear(Number(e.target.value))}
                  disabled={isExporting}
                  style={{ width: '100%', padding: '10px 12px', fontSize: '0.9rem' }}
                >
                  {[2024, 2025, 2026, 2027].map((yr) => (
                    <option key={yr} value={yr}>{yr}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: '#888888', display: 'block', marginBottom: '6px' }}>
                  Alcance del Reporte
                </label>
                <select
                  value={exportStoreId}
                  onChange={(e) => setExportStoreId(e.target.value)}
                  disabled={isExporting}
                  style={{ width: '100%', padding: '10px 12px', fontSize: '0.9rem' }}
                >
                  <option value="all">Toda la Red (Consolidado + 5 Locales)</option>
                  {allStores.map((st) => (
                    <option key={st.id} value={st.id}>Solo {st.name} ({st.code})</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Reglas aplicadas en la exportación */}
            <div style={{
              backgroundColor: '#121212',
              borderRadius: '10px',
              padding: '14px',
              marginBottom: '20px',
              border: '1px solid #262626'
            }}>
              <span style={{ fontSize: '0.75rem', fontWeight: '800', color: '#FFBC0D', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: '8px' }}>
                Reglas de Negocio en la Planilla
              </span>
              <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.82rem', color: '#CCCCCC', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <li>
                  <strong style={{ color: '#ef4444' }}>Días sin carga en rojo:</strong> Se identifican automáticamente las fechas omitidas y se calcula el consumo aproximado dividiendo el salto por los días transcurridos.
                </li>
                <li>
                  <strong style={{ color: '#22c55e' }}>Meta de Ahorro del 3%:</strong> Se evalúa si el consumo diario y mensual cumplió el objetivo de ahorro corporativo (Consumo 2025 × 0.97).
                </li>
                <li>
                  <strong style={{ color: '#38bdf8' }}>Estructura Multi-hoja:</strong> Hoja de resumen ejecutivo gerencial y pestañas detalladas por local con formato tabular para impresión o envío.
                </li>
              </ul>
            </div>

            {exportSuccess && (
              <div style={{
                padding: '12px 14px',
                borderRadius: '8px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                backgroundColor: '#143823',
                color: '#86efac',
                border: '1px solid #22c55e',
                fontSize: '0.88rem'
              }}>
                <CheckCircle2 size={18} />
                <span>{exportSuccess}</span>
              </div>
            )}

            <button
              onClick={async () => {
                setIsExporting(true);
                setExportSuccess(null);
                try {
                  await downloadReportFile({
                    year: exportYear,
                    month: exportMonth,
                    selectedStoreId: exportStoreId
                  });
                  setExportSuccess(`Planilla descargada con éxito para ${MONTH_NAMES[exportMonth - 1]} ${exportYear}.`);
                } catch (err) {
                  console.error('Error al descargar reporte:', err);
                  alert('Error al generar el archivo Excel: ' + err.message);
                } finally {
                  setIsExporting(false);
                }
              }}
              disabled={isExporting}
              style={{
                width: '100%',
                backgroundColor: '#FFBC0D',
                color: '#121212',
                padding: '16px',
                borderRadius: '10px',
                fontSize: '1.05rem',
                fontWeight: '800',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                boxShadow: '0 4px 14px rgba(255, 188, 13, 0.3)',
                cursor: isExporting ? 'wait' : 'pointer'
              }}
            >
              <Download size={20} />
              {isExporting ? 'Procesando mediciones y generando Excel...' : 'Descargar Informe en Excel (.xlsx)'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
