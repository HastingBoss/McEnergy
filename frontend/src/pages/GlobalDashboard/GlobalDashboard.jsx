import { useState, useEffect } from 'react';
import { supabase } from '../../services/supabaseClient';
import { BarChart3, AlertOctagon, TrendingUp, Calendar, ArrowDownRight, ArrowUpRight, Zap, RefreshCw } from 'lucide-react';
import { getPreviousYearDate } from '../../services/meterService';
import { useStore } from '../../context/StoreContext';

export default function GlobalDashboard() {
  const { stores: allStores } = useStore();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [readings, setReadings] = useState([]);
  const [prevYearReadings, setPrevYearReadings] = useState([]);
  const [loading, setLoading] = useState(true);

  const prevYearDate = getPreviousYearDate(selectedDate);

  useEffect(() => {
    loadDashboardData();
  }, [selectedDate]);

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
                  {store.meter_multiplier && store.meter_multiplier !== 1 && (
                    <span style={{ fontSize: '0.7rem', color: '#38BDF8', backgroundColor: '#1E293B', padding: '1px 6px', borderRadius: '4px' }}>
                      x{store.meter_multiplier}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#888888', marginTop: '3px' }}>
                  {hasReported
                    ? `Display: ${currentReading.display_value} • ${currentReading.technician_name ? `Técnico: ${currentReading.technician_name}` : 'Registrado'}`
                    : 'Pendiente de carga (12:00 PM)'}
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
