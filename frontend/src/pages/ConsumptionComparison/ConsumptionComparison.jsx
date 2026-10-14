import { useState, useEffect } from 'react';
import { TrendingUp, ArrowDownRight, ArrowUpRight, Calendar, Building2, RefreshCw, FileSpreadsheet } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { fetchMonthlyComparison } from '../../services/meterService';
import { downloadReportFile } from '../../services/reportExportService';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

export default function ConsumptionComparison({ isEmbedded = false }) {
  const { stores, currentStore, setCurrentStore } = useStore();

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [currentYearData, setCurrentYearData] = useState([]);
  const [prevYearData, setPrevYearData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (currentStore?.id) {
      loadComparison();
    }
  }, [currentStore?.id, selectedYear, selectedMonth]);

  const loadComparison = async () => {
    if (!currentStore?.id) return;
    setLoading(true);
    const { currentYearData, prevYearData } = await fetchMonthlyComparison(
      currentStore.id,
      selectedYear,
      selectedMonth
    );
    setCurrentYearData(currentYearData);
    setPrevYearData(prevYearData);
    setLoading(false);
  };

  // Cálculos consolidados del mes
  const totalCurrentMonth = currentYearData.reduce(
    (acc, curr) => acc + (parseFloat(curr.calculated_consumption) || 0),
    0
  );

  const totalPrevMonth = prevYearData.reduce(
    (acc, curr) => acc + (parseFloat(curr.calculated_consumption) || 0),
    0
  );

  const netDiff = totalCurrentMonth - totalPrevMonth;
  const netDiffPct = totalPrevMonth > 0 ? ((netDiff / totalPrevMonth) * 100).toFixed(1) : 0;
  const isSaving = netDiff <= 0;

  const currentDaysReported = currentYearData.filter((r) => r.calculated_consumption !== null).length;
  const prevDaysReported = prevYearData.filter((r) => r.calculated_consumption !== null).length;

  const currentDailyAvg = currentDaysReported > 0 ? (totalCurrentMonth / currentDaysReported).toFixed(1) : 0;
  const prevDailyAvg = prevDaysReported > 0 ? (totalPrevMonth / prevDaysReported).toFixed(1) : 0;

  // Mapa por día del mes (1..31) para comparar fila por fila
  const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
  const comparisonRows = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const padDay = String(day).padStart(2, '0');
    const padMonth = String(selectedMonth).padStart(2, '0');

    const currentDateStr = `${selectedYear}-${padMonth}-${padDay}`;
    const prevDateStr = `${selectedYear - 1}-${padMonth}-${padDay}`;

    const currentEntry = currentYearData.find((r) => r.reading_date === currentDateStr);
    const prevEntry = prevYearData.find((r) => r.reading_date === prevDateStr);

    const currentCons = currentEntry?.calculated_consumption ?? null;
    const prevCons = prevEntry?.calculated_consumption ?? null;

    let diff = null;
    let diffPct = null;
    if (currentCons !== null && prevCons !== null) {
      diff = currentCons - prevCons;
      diffPct = prevCons > 0 ? ((diff / prevCons) * 100).toFixed(1) : 0;
    }

    return {
      day,
      currentCons,
      prevCons,
      diff,
      diffPct
    };
  });

  return (
    <div style={isEmbedded ? { marginTop: '4px' } : { padding: '16px', maxWidth: '800px', margin: '0 auto', paddingBottom: '90px' }}>
      {/* Título y Selector de Local/Mes/Año */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
            <TrendingUp color="#FFBC0D" size={24} />
            Comparativa Anual ({currentStore?.code})
          </h2>
          <p style={{ fontSize: '0.8rem', color: '#A0A0A0', margin: '2px 0 0 0' }}>
            {currentStore?.name} • {selectedYear} vs {selectedYear - 1}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={currentStore?.id || ''}
            onChange={(e) => {
              const s = stores.find((st) => st.id === e.target.value);
              if (s) setCurrentStore(s);
            }}
            style={{ width: 'auto', padding: '6px 10px', fontSize: '0.85rem' }}
          >
            {stores.map((st) => (
              <option key={st.id} value={st.id}>{st.name} ({st.code})</option>
            ))}
          </select>

          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
            style={{ width: 'auto', padding: '6px 10px', fontSize: '0.85rem' }}
          >
            {MONTH_NAMES.map((name, idx) => (
              <option key={idx} value={idx + 1}>{name}</option>
            ))}
          </select>

          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            style={{ width: 'auto', padding: '6px 10px', fontSize: '0.85rem' }}
          >
            {[2024, 2025, 2026, 2027].map((yr) => (
              <option key={yr} value={yr}>{yr}</option>
            ))}
          </select>

          <button
            onClick={loadComparison}
            style={{
              backgroundColor: '#262626',
              border: '1px solid #383838',
              color: '#FFBC0D',
              padding: '6px 10px',
              borderRadius: '8px'
            }}
            title="Actualizar datos"
          >
            <RefreshCw size={16} />
          </button>

          <button
            onClick={async () => {
              setIsExporting(true);
              try {
                await downloadReportFile({
                  year: selectedYear,
                  month: selectedMonth,
                  selectedStoreId: currentStore?.id
                });
              } catch (err) {
                console.error('Error al exportar:', err);
                alert('Error al exportar Excel: ' + err.message);
              } finally {
                setIsExporting(false);
              }
            }}
            disabled={isExporting}
            style={{
              backgroundColor: '#262626',
              border: '1px solid #383838',
              color: '#22c55e',
              padding: '6px 10px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.82rem',
              fontWeight: '700'
            }}
            title="Exportar este mes a Excel (.xlsx)"
          >
            <FileSpreadsheet size={16} />
            {isExporting ? '...' : 'Excel'}
          </button>
        </div>
      </div>

      {/* Tarjetas de Resumen KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {/* Acumulado Este Año */}
        <div className="card">
          <div style={{ fontSize: '0.78rem', color: '#888888' }}>
            Acumulado {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: '800', color: '#FFBC0D', marginTop: '4px' }}>
            {totalCurrentMonth.toLocaleString('es-AR', { maximumFractionDigits: 1 })} <span style={{ fontSize: '0.85rem' }}>kWh</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#A0A0A0', marginTop: '2px' }}>
            Promedio diario: {currentDailyAvg} kWh ({currentDaysReported} días)
          </div>
        </div>

        {/* Acumulado Año Anterior */}
        <div className="card">
          <div style={{ fontSize: '0.78rem', color: '#888888' }}>
            Acumulado {MONTH_NAMES[selectedMonth - 1]} {selectedYear - 1}
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: '800', color: '#38BDF8', marginTop: '4px' }}>
            {totalPrevMonth.toLocaleString('es-AR', { maximumFractionDigits: 1 })} <span style={{ fontSize: '0.85rem' }}>kWh</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#A0A0A0', marginTop: '2px' }}>
            Promedio diario: {prevDailyAvg} kWh ({prevDaysReported} días)
          </div>
        </div>

        {/* Variación Neta */}
        <div className="card" style={{
          borderLeft: totalPrevMonth > 0 ? (isSaving ? '4px solid #22c55e' : '4px solid #ef4444') : '4px solid #6b7280'
        }}>
          <div style={{ fontSize: '0.78rem', color: '#888888' }}>Variación Interanual</div>
          <div style={{
            fontSize: '1.45rem',
            fontWeight: '800',
            color: totalPrevMonth > 0 ? (isSaving ? '#4ade80' : '#f87171') : '#A0A0A0',
            marginTop: '4px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            {totalPrevMonth > 0 ? (
              <>
                {isSaving ? <ArrowDownRight size={22} /> : <ArrowUpRight size={22} />}
                {netDiff > 0 ? '+' : ''}{netDiff.toLocaleString('es-AR', { maximumFractionDigits: 1 })} kWh
              </>
            ) : (
              'Sin histórico'
            )}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#A0A0A0', marginTop: '2px' }}>
            {totalPrevMonth > 0 ? `${netDiff > 0 ? '+' : ''}${netDiffPct}% vs mismo período` : 'Requiere datos del año pasado'}
          </div>
        </div>
      </div>

      {/* Tabla Detalle Día por Día */}
      <div className="card" style={{ padding: '14px', overflowX: 'auto' }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: '700', marginBottom: '12px', color: '#FFFFFF' }}>
          Detalle Diario de Consumo (kWh)
        </h3>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #333333', textAlign: 'left', color: '#888888' }}>
              <th style={{ padding: '8px 6px' }}>Día</th>
              <th style={{ padding: '8px 6px' }}>{selectedYear}</th>
              <th style={{ padding: '8px 6px' }}>{selectedYear - 1}</th>
              <th style={{ padding: '8px 6px' }}>Diferencia</th>
              <th style={{ padding: '8px 6px', textAlign: 'right' }}>% Var</th>
            </tr>
          </thead>
          <tbody>
            {comparisonRows.map((row) => {
              const hasData = row.currentCons !== null || row.prevCons !== null;
              if (!hasData) return null;

              const isDaySaving = row.diff !== null && row.diff <= 0;

              return (
                <tr
                  key={row.day}
                  style={{
                    borderBottom: '1px solid #222222',
                    backgroundColor: row.day % 2 === 0 ? '#1A1A1A' : 'transparent'
                  }}
                >
                  <td style={{ padding: '8px 6px', fontWeight: '700', color: '#FFFFFF' }}>
                    {row.day}
                  </td>
                  <td style={{ padding: '8px 6px', color: '#FFBC0D', fontWeight: '600' }}>
                    {row.currentCons !== null ? `${row.currentCons.toFixed(1)} kWh` : '-'}
                  </td>
                  <td style={{ padding: '8px 6px', color: '#38BDF8' }}>
                    {row.prevCons !== null ? `${row.prevCons.toFixed(1)} kWh` : '-'}
                  </td>
                  <td style={{
                    padding: '8px 6px',
                    fontWeight: '600',
                    color: row.diff === null ? '#666666' : (isDaySaving ? '#4ade80' : '#f87171')
                  }}>
                    {row.diff !== null ? `${row.diff > 0 ? '+' : ''}${row.diff.toFixed(1)} kWh` : '-'}
                  </td>
                  <td style={{
                    padding: '8px 6px',
                    textAlign: 'right',
                    fontWeight: '600',
                    color: row.diffPct === null ? '#666666' : (isDaySaving ? '#4ade80' : '#f87171')
                  }}>
                    {row.diffPct !== null ? `${row.diff > 0 ? '+' : ''}${row.diffPct}%` : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {comparisonRows.every((r) => r.currentCons === null && r.prevCons === null) && (
          <p style={{ textAlign: 'center', color: '#888888', padding: '24px 0', fontSize: '0.85rem' }}>
            No hay lecturas registradas en {MONTH_NAMES[selectedMonth - 1]} para {currentStore?.name}.
          </p>
        )}
      </div>
    </div>
  );
}
