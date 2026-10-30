import { useState, useEffect } from 'react';
import {
  TrendingUp,
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  Building2,
  RefreshCw,
  FileSpreadsheet,
  Edit3,
  Plus,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Clock
} from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { fetchMonthlyComparison } from '../../services/meterService';
import { downloadReportFile } from '../../services/reportExportService';
import DayEditEstimateModal from '../../components/DayEditEstimateModal/DayEditEstimateModal';
import BatchEstimateModal from '../../components/BatchEstimateModal/BatchEstimateModal';

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

  // Estados para modales de edición / estimación
  const [modalState, setModalState] = useState({
    isOpen: false,
    dateString: null,
    currentEntry: null,
    prevYearEntry: null
  });
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);

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
  const currentEstimatedDays = currentYearData.filter((r) => r.is_estimated).length;
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

    // Detección de posibles incongruencias (0 kWh con lectura cargada, o pico > 2.5x promedio)
    const isAnomaly = currentCons !== null && (
      (currentCons === 0 && !currentEntry?.is_reset) ||
      (currentDailyAvg > 0 && currentCons > currentDailyAvg * 2.5)
    );

    return {
      day,
      currentDateStr,
      prevDateStr,
      currentEntry,
      prevEntry,
      currentCons,
      prevCons,
      diff,
      diffPct,
      isEstimated: !!currentEntry?.is_estimated,
      isReset: !!currentEntry?.is_reset,
      isAnomaly
    };
  });

  // Cantidad de días faltantes en el mes
  const missingDaysCount = comparisonRows.filter((r) => !r.currentEntry).length;

  // Abrir modal para un día específico
  const handleOpenDayModal = (row) => {
    setModalState({
      isOpen: true,
      dateString: row.currentDateStr,
      currentEntry: row.currentEntry,
      prevYearEntry: row.prevEntry
    });
  };

  // Abrir modal de carga manual genérico (primer día faltante o día 1)
  const handleOpenAddDayModal = () => {
    const firstMissing = comparisonRows.find((r) => !r.currentEntry);
    const targetRow = firstMissing || comparisonRows[0];
    handleOpenDayModal(targetRow);
  };

  return (
    <div style={isEmbedded ? { marginTop: '4px' } : { padding: '16px', maxWidth: '850px', margin: '0 auto', paddingBottom: '90px' }}>
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

      {/* Barra de Acciones de Estimación y Corrección */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#1E1E1E',
        border: '1px solid #333',
        borderRadius: '10px',
        padding: '10px 14px',
        marginBottom: '16px',
        flexWrap: 'wrap',
        gap: '10px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: '#CCCCCC' }}>
          <Clock size={16} color="#FFBC0D" />
          <span>
            {missingDaysCount > 0 ? (
              <>Hay <strong style={{ color: '#FFBC0D' }}>{missingDaysCount} días sin lectura</strong> en {MONTH_NAMES[selectedMonth - 1]}</>
            ) : (
              <span style={{ color: '#4ade80' }}>✓ Mes completo (31/31 días con registro)</span>
            )}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={handleOpenAddDayModal}
            style={{
              backgroundColor: '#2A2A2A',
              color: '#FFFFFF',
              border: '1px solid #444',
              borderRadius: '8px',
              padding: '6px 12px',
              fontSize: '0.8rem',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            title="Cargar o corregir una fecha puntual"
          >
            <Plus size={15} color="#FFBC0D" />
            Cargar / Estimar Día
          </button>

          {missingDaysCount > 0 && (
            <button
              type="button"
              onClick={() => setIsBatchModalOpen(true)}
              style={{
                backgroundColor: 'rgba(255, 188, 13, 0.15)',
                color: '#FFBC0D',
                border: '1px solid #FFBC0D',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '0.8rem',
                fontWeight: '700',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
              title="Estimar automáticamente todos los días faltantes del mes"
            >
              <Sparkles size={15} />
              Autocompletar Faltantes ({missingDaysCount})
            </button>
          )}
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
            Promedio diario: {currentDailyAvg} kWh ({currentDaysReported} días{currentEstimatedDays > 0 ? ` • ${currentEstimatedDays} est.` : ''})
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#FFFFFF', margin: 0 }}>
            Detalle Diario de Consumo (kWh)
          </h3>
          <span style={{ fontSize: '0.74rem', color: '#888888' }}>
            💡 Haz clic en cualquier fila para editar o estimar la lectura de ese día
          </span>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #333333', textAlign: 'left', color: '#888888' }}>
              <th style={{ padding: '8px 6px', width: '45px' }}>Día</th>
              <th style={{ padding: '8px 6px' }}>{selectedYear}</th>
              <th style={{ padding: '8px 6px' }}>{selectedYear - 1}</th>
              <th style={{ padding: '8px 6px' }}>Diferencia</th>
              <th style={{ padding: '8px 6px', textAlign: 'right' }}>% Var</th>
              <th style={{ padding: '8px 6px', textAlign: 'center', width: '90px' }}>Acción</th>
            </tr>
          </thead>
          <tbody>
            {comparisonRows.map((row) => {
              const hasData = row.currentCons !== null || row.prevCons !== null || row.currentEntry !== null;
              if (!hasData) return null;

              const isDaySaving = row.diff !== null && row.diff <= 0;

              return (
                <tr
                  key={row.day}
                  onClick={() => handleOpenDayModal(row)}
                  style={{
                    borderBottom: '1px solid #222222',
                    backgroundColor: row.isAnomaly
                      ? 'rgba(239, 68, 68, 0.08)'
                      : (row.day % 2 === 0 ? '#1A1A1A' : 'transparent'),
                    cursor: 'pointer',
                    transition: 'background-color 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = row.isAnomaly ? 'rgba(239, 68, 68, 0.18)' : '#262626';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = row.isAnomaly
                      ? 'rgba(239, 68, 68, 0.08)'
                      : (row.day % 2 === 0 ? '#1A1A1A' : 'transparent');
                  }}
                >
                  <td style={{ padding: '8px 6px', fontWeight: '700', color: '#FFFFFF' }}>
                    {row.day}
                  </td>

                  {/* Consumo año seleccionado */}
                  <td style={{ padding: '8px 6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      {row.currentCons !== null ? (
                        <span style={{ color: '#FFBC0D', fontWeight: '600' }}>
                          {row.currentCons.toFixed(1)} kWh
                        </span>
                      ) : (
                        <span style={{ color: '#666666' }}>-</span>
                      )}

                      {/* Etiqueta Estimado */}
                      {row.isEstimated && (
                        <span style={{
                          fontSize: '0.66rem',
                          backgroundColor: '#3b2f05',
                          color: '#FFBC0D',
                          border: '1px solid #b48509',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          fontWeight: '700'
                        }} title="Lectura estimada automáticamente">
                          [Est]
                        </span>
                      )}

                      {/* Indicador de anomalía */}
                      {row.isAnomaly && (
                        <span style={{
                          fontSize: '0.66rem',
                          backgroundColor: '#450a0a',
                          color: '#f87171',
                          border: '1px solid #ef4444',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          fontWeight: '700',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '2px'
                        }} title="Posible valor anómalo o incongruencia (0 kWh o pico inusual)">
                          <AlertTriangle size={10} /> Revisar
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Consumo año anterior */}
                  <td style={{ padding: '8px 6px', color: '#38BDF8' }}>
                    {row.prevCons !== null ? `${row.prevCons.toFixed(1)} kWh` : '-'}
                  </td>

                  {/* Diferencia */}
                  <td style={{
                    padding: '8px 6px',
                    fontWeight: '600',
                    color: row.diff === null ? '#666666' : (isDaySaving ? '#4ade80' : '#f87171')
                  }}>
                    {row.diff !== null ? `${row.diff > 0 ? '+' : ''}${row.diff.toFixed(1)} kWh` : '-'}
                  </td>

                  {/* Porcentaje de variación */}
                  <td style={{
                    padding: '8px 6px',
                    textAlign: 'right',
                    fontWeight: '600',
                    color: row.diffPct === null ? '#666666' : (isDaySaving ? '#4ade80' : '#f87171')
                  }}>
                    {row.diffPct !== null ? `${row.diff > 0 ? '+' : ''}${row.diffPct}%` : '-'}
                  </td>

                  {/* Botón de Acción directa */}
                  <td style={{ padding: '6px', textAlign: 'center' }}>
                    {row.currentEntry ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenDayModal(row);
                        }}
                        style={{
                          backgroundColor: '#262626',
                          border: '1px solid #383838',
                          color: '#FFFFFF',
                          borderRadius: '6px',
                          padding: '4px 8px',
                          fontSize: '0.72rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          cursor: 'pointer'
                        }}
                        title="Editar lectura de este día"
                      >
                        <Edit3 size={12} color="#FFBC0D" />
                        Editar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenDayModal(row);
                        }}
                        style={{
                          backgroundColor: 'rgba(255, 188, 13, 0.12)',
                          border: '1px solid #b48509',
                          color: '#FFBC0D',
                          borderRadius: '6px',
                          padding: '4px 8px',
                          fontSize: '0.72rem',
                          fontWeight: '700',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          cursor: 'pointer'
                        }}
                        title="Cargar o estimar día faltante"
                      >
                        <Sparkles size={12} />
                        Estimar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {comparisonRows.every((r) => r.currentCons === null && r.prevCons === null && !r.currentEntry) && (
          <p style={{ textAlign: 'center', color: '#888888', padding: '24px 0', fontSize: '0.85rem' }}>
            No hay lecturas registradas en {MONTH_NAMES[selectedMonth - 1]} para {currentStore?.name}.
          </p>
        )}
      </div>

      {/* Modal para Editar / Estimar un día específico */}
      <DayEditEstimateModal
        isOpen={modalState.isOpen}
        onClose={() => setModalState({ isOpen: false, dateString: null, currentEntry: null, prevYearEntry: null })}
        store={currentStore}
        dateString={modalState.dateString}
        currentEntry={modalState.currentEntry}
        prevYearEntry={modalState.prevYearEntry}
        currentMonthReadings={currentYearData}
        onSaved={loadComparison}
      />

      {/* Modal para Autocompletar días faltantes en lote */}
      <BatchEstimateModal
        isOpen={isBatchModalOpen}
        onClose={() => setIsBatchModalOpen(false)}
        store={currentStore}
        year={selectedYear}
        month={selectedMonth}
        currentYearData={currentYearData}
        prevYearData={prevYearData}
        onCompleted={loadComparison}
      />
    </div>
  );
}
