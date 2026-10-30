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
  CheckCircle2,
  UploadCloud,
  Menu,
  X,
  ChevronRight,
  ShieldCheck,
  Building2
} from 'lucide-react';
import { getPreviousYearDate } from '../../services/meterService';
import { useStore } from '../../context/StoreContext';
import ConsumptionComparison from '../ConsumptionComparison/ConsumptionComparison';
import BatchImport from '../../components/BatchImport/BatchImport';
import AppFooter from '../../components/AppFooter/AppFooter';
import { downloadReportFile } from '../../services/reportExportService';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const NAV_SECTIONS = [
  {
    group: 'MONITOREO DE RED',
    items: [
      { id: 'network', label: 'Red Global (Día)', desc: 'Consumo diario consolidado', icon: BarChart3 },
      { id: 'comparison', label: 'Comparativa Anual', desc: 'Evolución mes a mes y estimaciones', icon: TrendingUp }
    ]
  },
  {
    group: 'GESTIÓN Y REPORTES',
    items: [
      { id: 'batch', label: 'Carga Masiva', desc: 'Importación de mediciones en lote', icon: UploadCloud },
      { id: 'export', label: 'Exportar Excel', desc: 'Informes gerenciales estructurados', icon: FileSpreadsheet }
    ]
  }
];

export default function GlobalDashboard() {
  const { stores: allStores, currentStore } = useStore();
  const now = new Date();
  const [selectedDate, setSelectedDate] = useState(now.toISOString().split('T')[0]);
  const [readings, setReadings] = useState([]);
  const [prevYearReadings, setPrevYearReadings] = useState([]);
  const [loading, setLoading] = useState(true);

  // Navegación: 'network' | 'comparison' | 'batch' | 'export'
  const [activeTab, setActiveTab] = useState('network');
  const [isSidebarOpenMobile, setIsSidebarOpenMobile] = useState(false);

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
    setIsSidebarOpenMobile(false);
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

  // PANTALLA DE ACCESO CON PIN (BLOQUEADA)
  if (!isAuthenticated) {
    return (
      <div style={{
        padding: '24px 16px',
        maxWidth: '420px',
        margin: '40px auto 90px auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center'
      }}>
        <div className="card animate-slide-up" style={{
          width: '100%',
          backgroundColor: '#27251F',
          border: '1px solid #3A3833',
          borderRadius: '18px',
          padding: '28px 20px',
          boxShadow: '0 12px 36px rgba(0,0,0,0.7)',
          textAlign: 'center'
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            backgroundColor: '#DA291C',
            borderRadius: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px auto',
            color: '#FFC72C',
            boxShadow: '0 6px 18px rgba(218, 41, 28, 0.4)'
          }}>
            <Lock size={32} />
          </div>

          <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: '#FFFFFF', margin: 0 }}>
            Panel de Control y Red
          </h2>
          <p style={{ fontSize: '0.82rem', color: '#A0A0A0', marginTop: '6px', marginBottom: '22px' }}>
            Acceso exclusivo para Coordinadores de Mantenimiento y Auditoría.
          </p>

          <form onSubmit={handleVerifyPin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="Ingresar PIN"
                autoFocus
                style={{
                  textAlign: 'center',
                  fontSize: '1.6rem',
                  letterSpacing: '8px',
                  fontWeight: '800',
                  color: '#FFC72C',
                  backgroundColor: '#1D1D1D',
                  border: '1px solid #3A3833',
                  padding: '12px',
                  minHeight: '52px',
                  borderRadius: '12px'
                }}
              />
            </div>

            {pinError && (
              <div style={{
                color: '#f87171',
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                padding: '8px',
                borderRadius: '8px',
                border: '1px solid #ef4444'
              }}>
                <AlertCircle size={16} />
                <span>{pinError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={verifyingPin || !pinInput}
              style={{
                width: '100%',
                backgroundColor: '#FFC72C',
                color: '#121212',
                padding: '12px',
                minHeight: '48px',
                borderRadius: '12px',
                fontSize: '1rem',
                fontWeight: '800',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              <KeyRound size={18} />
              {verifyingPin ? 'Verificando...' : 'Desbloquear Panel'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // CÁLCULOS CONSOLIDADOS RED
  const totalCurrent = readings.reduce((acc, curr) => acc + (parseFloat(curr.calculated_consumption) || 0), 0);
  const totalPrev = prevYearReadings.reduce((acc, curr) => acc + (parseFloat(curr.calculated_consumption) || 0), 0);
  const netDiff = totalCurrent - totalPrev;
  const netDiffPct = totalPrev > 0 ? ((netDiff / totalPrev) * 100).toFixed(1) : 0;
  const isSaving = netDiff <= 0;
  const averageConsumption = readings.length > 0 ? (totalCurrent / readings.length).toFixed(1) : 0;

  // Título e ícono de la vista activa para el header móvil
  const currentNavFlat = NAV_SECTIONS.flatMap(g => g.items).find(i => i.id === activeTab);
  const ActiveNavIcon = currentNavFlat?.icon || BarChart3;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#1D1D1D' }}>
      {/* Barra Superior Móvil con Botón de Menú en Cascada (< 768px) */}
      <div style={{
        backgroundColor: '#27251F',
        borderBottom: '1px solid #3A3833',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 90
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => setIsSidebarOpenMobile(true)}
            style={{
              backgroundColor: '#1D1D1D',
              border: '1px solid #3A3833',
              borderRadius: '10px',
              minHeight: '44px',
              padding: '8px 12px',
              color: '#FFC72C',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer'
            }}
            title="Abrir menú de navegación"
          >
            <Menu size={20} />
            <span style={{ fontSize: '0.85rem', fontWeight: '800' }}>Vistas</span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ActiveNavIcon size={18} color="#FFC72C" />
            <span style={{ fontSize: '0.92rem', fontWeight: '800', color: '#FFFFFF' }}>
              {currentNavFlat?.label}
            </span>
          </div>
        </div>

        <button
          onClick={handleLockDashboard}
          style={{
            backgroundColor: 'transparent',
            border: '1px solid #3A3833',
            color: '#A0A0A0',
            borderRadius: '10px',
            minHeight: '40px',
            padding: '6px 10px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '0.75rem'
          }}
          title="Bloquear panel"
        >
          <Unlock size={14} color="#f87171" />
          <span>Bloquear</span>
        </button>
      </div>

      {/* Drawer Lateral en Cascada (Móvil) */}
      {isSidebarOpenMobile && (
        <div
          onClick={() => setIsSidebarOpenMobile(false)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            zIndex: 1000,
            display: 'flex',
            justifyContent: 'flex-start'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="animate-slide-up"
            style={{
              backgroundColor: '#1D1D1D',
              width: '85%',
              maxWidth: '320px',
              height: '100%',
              borderRight: '1px solid #3A3833',
              display: 'flex',
              flexDirection: 'column',
              padding: '20px 16px',
              boxShadow: '10px 0 30px rgba(0,0,0,0.8)'
            }}
          >
            {/* Header del Drawer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '16px', borderBottom: '1px solid #3A3833', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  backgroundColor: '#DA291C',
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#FFC72C',
                  fontWeight: '900',
                  fontSize: '18px'
                }}>
                  M
                </div>
                <div>
                  <h3 style={{ fontSize: '1rem', fontWeight: '800', color: '#FFFFFF', margin: 0 }}>
                    Panel de Control
                  </h3>
                  <p style={{ fontSize: '0.72rem', color: '#A0A0A0', margin: 0 }}>
                    Navegación en Cascada
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsSidebarOpenMobile(false)}
                style={{
                  backgroundColor: '#27251F',
                  color: '#A0A0A0',
                  borderRadius: '50%',
                  width: '36px',
                  height: '36px',
                  minHeight: '36px',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid #3A3833'
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Grupos de Navegación */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {NAV_SECTIONS.map((sec) => (
                <div key={sec.group}>
                  <div style={{ fontSize: '0.68rem', fontWeight: '800', color: '#FFC72C', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: '8px', paddingLeft: '4px' }}>
                    {sec.group}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {sec.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeTab === item.id;

                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            setActiveTab(item.id);
                            setIsSidebarOpenMobile(false);
                          }}
                          style={{
                            minHeight: '50px',
                            padding: '10px 12px',
                            borderRadius: '12px',
                            backgroundColor: isActive ? 'rgba(255, 199, 44, 0.15)' : '#27251F',
                            border: isActive ? '1px solid #FFC72C' : '1px solid transparent',
                            color: isActive ? '#FFC72C' : '#FFFFFF',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            textAlign: 'left',
                            width: '100%',
                            cursor: 'pointer'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <Icon size={18} color={isActive ? '#FFC72C' : '#A0A0A0'} />
                            <div>
                              <div style={{ fontSize: '0.88rem', fontWeight: isActive ? '800' : '700' }}>
                                {item.label}
                              </div>
                              <div style={{ fontSize: '0.72rem', color: '#888888' }}>
                                {item.desc}
                              </div>
                            </div>
                          </div>
                          {isActive && <ChevronRight size={16} color="#FFC72C" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer del Drawer */}
            <div style={{ paddingTop: '16px', borderTop: '1px solid #3A3833' }}>
              <button
                onClick={handleLockDashboard}
                style={{
                  width: '100%',
                  minHeight: '48px',
                  backgroundColor: '#27251F',
                  border: '1px solid #ef4444',
                  color: '#f87171',
                  borderRadius: '12px',
                  padding: '10px',
                  fontSize: '0.85rem',
                  fontWeight: '700',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                <Lock size={16} />
                Bloquear Acceso
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contenido Principal */}
      <div style={{
        flex: 1,
        padding: '16px',
        maxWidth: activeTab === 'comparison' ? '880px' : '820px',
        width: '100%',
        margin: '0 auto',
        paddingBottom: '90px'
      }}>
        {/* VISTA 1: RED GLOBAL (DÍA) */}
        {activeTab === 'network' && (
          <div className="animate-fade-in">
            {/* Encabezado */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                  <BarChart3 color="#FFC72C" size={24} />
                  Consumo Diario de la Red
                </h2>
                <p style={{ fontSize: '0.8rem', color: '#A0A0A0', margin: '2px 0 0 0' }}>
                  Monitoreo consolidado de los 5 locales
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Calendar size={18} color="#FFC72C" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  style={{ padding: '8px 12px', fontSize: '0.85rem', width: 'auto', minHeight: '44px' }}
                />
                <button
                  onClick={loadDashboardData}
                  style={{
                    backgroundColor: '#27251F',
                    border: '1px solid #3A3833',
                    color: '#FFC72C',
                    padding: '8px 12px',
                    minHeight: '44px',
                    borderRadius: '10px'
                  }}
                  title="Actualizar datos"
                >
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>

            {/* Métricas Principales (KPIs) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '20px' }}>
              {/* Total Red Hoy */}
              <div className="card">
                <div style={{ fontSize: '0.8rem', color: '#888888' }}>Total Red {selectedDate}</div>
                <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#FFC72C', marginTop: '4px' }}>
                  {totalCurrent.toLocaleString('es-AR', { maximumFractionDigits: 1 })} <span style={{ fontSize: '0.9rem' }}>kWh</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#A0A0A0', marginTop: '2px' }}>
                  Promedio: {averageConsumption} kWh por local
                </div>
              </div>

              {/* Mismo Día Año Anterior */}
              <div className="card">
                <div style={{ fontSize: '0.8rem', color: '#888888' }}>Mismo Día Año Anterior ({prevYearDate})</div>
                <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#38BDF8', marginTop: '4px' }}>
                  {totalPrev.toLocaleString('es-AR', { maximumFractionDigits: 1 })} <span style={{ fontSize: '0.9rem' }}>kWh</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#A0A0A0', marginTop: '2px' }}>
                  {prevYearReadings.length} de 5 locales medidos en 2025
                </div>
              </div>

              {/* Variación Red */}
              <div className="card" style={{
                borderLeft: totalPrev > 0 ? (isSaving ? '4px solid #22c55e' : '4px solid #DA291C') : '4px solid #6b7280'
              }}>
                <div style={{ fontSize: '0.8rem', color: '#888888' }}>Variación Red Interanual</div>
                <div style={{
                  fontSize: '1.6rem',
                  fontWeight: '800',
                  color: totalPrev > 0 ? (isSaving ? '#4ade80' : '#f87171') : '#A0A0A0',
                  marginTop: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  {totalPrev > 0 ? (
                    <>
                      {isSaving ? <ArrowDownRight size={24} /> : <ArrowUpRight size={24} />}
                      {netDiff > 0 ? '+' : ''}{netDiff.toLocaleString('es-AR', { maximumFractionDigits: 1 })} kWh
                    </>
                  ) : (
                    'Sin histórico'
                  )}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#A0A0A0', marginTop: '2px' }}>
                  {totalPrev > 0 ? `${netDiff > 0 ? '+' : ''}${netDiffPct}% vs 2025` : 'Requiere datos del año pasado'}
                </div>
              </div>
            </div>

            {/* Tabla Detalle por Local */}
            <div className="card" style={{ padding: '16px', overflowX: 'auto' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: '700', marginBottom: '12px', color: '#FFFFFF' }}>
                Detalle por Local (5 Tiendas)
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {allStores.map((store) => {
                  const currentReading = readings.find((r) => r.store_id === store.id);
                  const prevReading = prevYearReadings.find((r) => r.store_id === store.id);

                  const consumption = currentReading?.calculated_consumption;
                  const prevConsumption = prevReading?.calculated_consumption;

                  let diff = null;
                  let diffPct = null;
                  if (consumption !== null && consumption !== undefined && prevConsumption !== null && prevConsumption !== undefined) {
                    diff = consumption - prevConsumption;
                    diffPct = prevConsumption > 0 ? ((diff / prevConsumption) * 100).toFixed(1) : 0;
                  }

                  const isLocalSaving = diff !== null && diff <= 0;

                  return (
                    <div
                      key={store.id}
                      style={{
                        backgroundColor: '#1D1D1D',
                        border: '1px solid #3A3833',
                        borderRadius: '12px',
                        padding: '14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '12px'
                      }}
                    >
                      <div style={{ minWidth: '140px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <strong style={{ fontSize: '0.98rem', color: '#FFFFFF' }}>{store.name}</strong>
                          <span style={{ fontSize: '0.72rem', backgroundColor: '#27251F', color: '#FFC72C', padding: '2px 6px', borderRadius: '4px', fontWeight: '700' }}>
                            {store.code}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.74rem', color: '#888888', marginTop: '2px' }}>
                          Display: {currentReading ? currentReading.display_value : 'Pendiente'}
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '1.15rem', fontWeight: '800', color: currentReading ? '#FFC72C' : '#666666' }}>
                          {consumption !== null && consumption !== undefined ? `${consumption.toFixed(1)} kWh` : (currentReading ? 'Base' : 'Sin Cargar')}
                        </div>
                        {diff !== null && (
                          <div style={{ fontSize: '0.75rem', fontWeight: '700', color: isLocalSaving ? '#4ade80' : '#f87171' }}>
                            {diff > 0 ? '+' : ''}{diff.toFixed(1)} kWh ({diff > 0 ? '+' : ''}{diffPct}%)
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* VISTA 2: COMPARATIVA ANUAL (MES A MES) */}
        {activeTab === 'comparison' && (
          <div className="animate-fade-in">
            <ConsumptionComparison isEmbedded={true} />
          </div>
        )}

        {/* VISTA 3: CARGA MASIVA POR LOTE DE TEXTO */}
        {activeTab === 'batch' && (
          <div className="animate-fade-in">
            <BatchImport onImportSuccess={loadDashboardData} />
          </div>
        )}

        {/* VISTA 4: EXPORTACIÓN DE INFORMES EXCEL */}
        {activeTab === 'export' && (
          <div className="animate-fade-in">
            <div style={{ marginBottom: '16px' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                <FileSpreadsheet color="#FFC72C" size={24} />
                Exportación de Informes Eléctricos (Excel)
              </h2>
              <p style={{ fontSize: '0.82rem', color: '#A0A0A0', margin: '4px 0 0 0' }}>
                Generación de planillas estructuradas con comparativa interanual y auditoría.
              </p>
            </div>

            <div className="card" style={{ padding: '20px', marginBottom: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '18px' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#888888', display: 'block', marginBottom: '6px' }}>
                    Mes del Período
                  </label>
                  <select
                    value={exportMonth}
                    onChange={(e) => setExportMonth(Number(e.target.value))}
                    disabled={isExporting}
                    style={{ minHeight: '48px' }}
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
                    style={{ minHeight: '48px' }}
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
                    style={{ minHeight: '48px' }}
                  >
                    <option value="all">Toda la Red (Consolidado + 5 Locales)</option>
                    {allStores.map((st) => (
                      <option key={st.id} value={st.id}>Solo {st.name} ({st.code})</option>
                    ))}
                  </select>
                </div>
              </div>

              {exportSuccess && (
                <div style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  backgroundColor: 'rgba(34, 197, 94, 0.15)',
                  color: '#86efac',
                  border: '1px solid #22c55e',
                  fontSize: '0.85rem'
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
                className="btn-mcd-yellow"
                style={{
                  width: '100%',
                  minHeight: '48px',
                  padding: '14px',
                  borderRadius: '12px',
                  fontSize: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  boxShadow: '0 4px 14px rgba(255, 199, 44, 0.3)'
                }}
              >
                <Download size={20} />
                {isExporting ? 'Procesando mediciones y generando Excel...' : 'Descargar Informe en Excel (.xlsx)'}
              </button>
            </div>
          </div>
        )}
      </div>

      <AppFooter />
    </div>
  );
}
