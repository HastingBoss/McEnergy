import ExcelJS from 'exceljs';
import { supabase } from './supabaseClient';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

/**
 * Procesa la serie temporal del mes para un local, aplicando la interpolación
 * de días no cargados dividiendo el consumo acumulado del próximo día por los días faltantes.
 */
export function processStoreMonthlySeries(store, year, month, currentMonthReadings, prevYearReadings, priorReading = null) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const padMonth = String(month).padStart(2, '0');

  // Mapa de lecturas reales indexadas por día (1..31)
  const realMap = new Map();
  currentMonthReadings.forEach((r) => {
    const day = parseInt(r.reading_date.split('-')[2], 10);
    realMap.set(day, r);
  });

  const prevYearMap = new Map();
  prevYearReadings.forEach((r) => {
    const day = parseInt(r.reading_date.split('-')[2], 10);
    prevYearMap.set(day, r);
  });

  // Array inicial de días
  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const padDay = String(d).padStart(2, '0');
    const dateStr = `${year}-${padMonth}-${padDay}`;
    const realEntry = realMap.get(d) || null;
    const prevYearEntry = prevYearMap.get(d) || null;
    const prevKwh = prevYearEntry ? parseFloat(prevYearEntry.calculated_consumption) || 0 : null;
    const targetKwh = prevKwh !== null ? Number((prevKwh * 0.97).toFixed(2)) : null; // Meta de ahorro -3%

    days.push({
      day: d,
      date: dateStr,
      realEntry,
      displayValue: realEntry ? realEntry.display_value : null,
      kwhReading: realEntry ? realEntry.kwh_reading : null,
      consumption: null,
      isEstimated: false,
      status: 'SIN_DATO',
      prevYearConsumption: prevKwh,
      targetConsumption: targetKwh,
      diffVsTarget: null,
      diffVsPrev: null,
      diffVsPrevPct: null,
      isGoalMet: null
    });
  }

  // Identificar puntos ancla para interpolación (lectura anterior conocida -> lectura siguiente conocida)
  // Punto base inicial: priorReading (último registro antes del mes) o primera lectura del mes
  let lastAnchor = priorReading
    ? { day: 0, date: priorReading.reading_date, kwh: parseFloat(priorReading.kwh_reading) }
    : null;

  for (let i = 0; i < days.length; i++) {
    const currentDay = days[i];

    if (currentDay.realEntry) {
      const currentKwh = parseFloat(currentDay.realEntry.kwh_reading);

      if (lastAnchor) {
        const gapDays = currentDay.day - lastAnchor.day;

        if (gapDays === 1) {
          // Día consecutivo normal: consumo directo de 24h
          const dailyKwh = Math.max(0, currentKwh - lastAnchor.kwh);
          currentDay.consumption = Number(dailyKwh.toFixed(1));
          currentDay.isEstimated = false;
          currentDay.status = 'REAL';
        } else if (gapDays > 1) {
          // Salto de varios días: repartir equitativamente el delta entre los días faltantes y el día actual
          const deltaKwh = Math.max(0, currentKwh - lastAnchor.kwh);
          const avgDailyKwh = Number((deltaKwh / gapDays).toFixed(1));

          // Asignar a los días intermedios (no cargados) -> EN ROJO / ESTIMADOS
          const startIdx = Math.max(0, lastAnchor.day); // Si lastAnchor fue día 0 (mes anterior), startIdx es 0 (día 1)
          for (let fill = startIdx; fill < i; fill++) {
            days[fill].consumption = avgDailyKwh;
            days[fill].isEstimated = true;
            days[fill].status = 'ESTIMADO';
          }

          // Asignar al día que cerró el salto
          currentDay.consumption = avgDailyKwh;
          currentDay.isEstimated = false;
          currentDay.status = 'REAL';
        }
      } else {
        // Primera lectura encontrada sin ancla previa: lectura base
        currentDay.consumption = null;
        currentDay.isEstimated = false;
        currentDay.status = 'LECTURA_BASE';
      }

      lastAnchor = {
        day: currentDay.day,
        date: currentDay.date,
        kwh: currentKwh
      };
    }
  }

  // Calcular métricas derivadas (vs 2025 y vs Meta -3%)
  days.forEach((row) => {
    if (row.consumption !== null && row.targetConsumption !== null) {
      row.diffVsTarget = Number((row.consumption - row.targetConsumption).toFixed(1));
      row.diffVsPrev = Number((row.consumption - row.prevYearConsumption).toFixed(1));
      row.diffVsPrevPct = row.prevYearConsumption > 0
        ? Number(((row.diffVsPrev / row.prevYearConsumption) * 100).toFixed(1))
        : 0;
      row.isGoalMet = row.consumption <= row.targetConsumption;
    }
  });

  return days;
}

/**
 * Obtiene de Supabase toda la información del mes actual y del año anterior para la red.
 */
export async function fetchFullReportData(year, month) {
  const padMonth = String(month).padStart(2, '0');
  const startDateCurrent = `${year}-${padMonth}-01`;
  const endDateCurrent = `${year}-${padMonth}-31`;

  const prevYear = year - 1;
  const startDatePrev = `${prevYear}-${padMonth}-01`;
  const endDatePrev = `${prevYear}-${padMonth}-31`;

  // 1. Obtener locales
  const { data: stores, error: storesError } = await supabase
    .from('stores')
    .select('*')
    .order('code', { ascending: true });

  if (storesError) throw storesError;

  // 2. Obtener lecturas de ambos años
  const [currentRes, prevRes, priorRes] = await Promise.all([
    supabase
      .from('meter_readings')
      .select('*')
      .gte('reading_date', startDateCurrent)
      .lte('reading_date', endDateCurrent)
      .order('reading_date', { ascending: true }),
    supabase
      .from('meter_readings')
      .select('*')
      .gte('reading_date', startDatePrev)
      .lte('reading_date', endDatePrev)
      .order('reading_date', { ascending: true }),
    supabase
      .from('meter_readings')
      .select('*')
      .lt('reading_date', startDateCurrent)
      .order('reading_date', { ascending: false })
  ]);

  if (currentRes.error) throw currentRes.error;
  if (prevRes.error) throw prevRes.error;

  // Organizar datos por local
  const processedStores = stores.map((store) => {
    const storeCurrent = (currentRes.data || []).filter((r) => r.store_id === store.id);
    const storePrev = (prevRes.data || []).filter((r) => r.store_id === store.id);
    const priorReading = (priorRes.data || []).find((r) => r.store_id === store.id) || null;

    const series = processStoreMonthlySeries(store, year, month, storeCurrent, storePrev, priorReading);

    // Totales del local
    const totalCurrent = series.reduce((acc, d) => acc + (d.consumption || 0), 0);
    const totalPrev = series.reduce((acc, d) => acc + (d.prevYearConsumption || 0), 0);
    const totalTarget = series.reduce((acc, d) => acc + (d.targetConsumption || 0), 0);
    const estimatedDaysCount = series.filter((d) => d.isEstimated).length;
    const reportedDaysCount = series.filter((d) => d.consumption !== null).length;

    const netDiff = totalCurrent - totalPrev;
    const netDiffPct = totalPrev > 0 ? Number(((netDiff / totalPrev) * 100).toFixed(1)) : 0;
    const isGoalMet = totalPrev > 0 ? totalCurrent <= totalTarget : null;

    return {
      store,
      series,
      summary: {
        totalCurrent: Number(totalCurrent.toFixed(1)),
        totalPrev: Number(totalPrev.toFixed(1)),
        totalTarget: Number(totalTarget.toFixed(1)),
        netDiff: Number(netDiff.toFixed(1)),
        netDiffPct,
        isGoalMet,
        estimatedDaysCount,
        reportedDaysCount
      }
    };
  });

  return {
    year,
    month,
    monthName: MONTH_NAMES[month - 1],
    stores: processedStores
  };
}

/**
 * Genera el archivo Excel (.xlsx) con estilos profesionales, branding McDonald's
 * y alertas en rojo para días no cargados.
 */
export async function generateMonthlyExcelReport({ year, month, selectedStoreId = 'all' }) {
  const data = await fetchFullReportData(year, month);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'McEnergy PWA - McDonald\'s';
  workbook.created = new Date();

  // Filtrar si es un local específico o todos
  const storesToExport = selectedStoreId === 'all'
    ? data.stores
    : data.stores.filter((s) => s.store.id === selectedStoreId);

  // 1. HOJA 1: RESUMEN CONSOLIDADO DE LA RED
  const summarySheet = workbook.addWorksheet('Resumen Red', {
    views: [{ showGridLines: true }]
  });

  // Título
  summarySheet.mergeCells('A1:I1');
  const title = summarySheet.getCell('A1');
  title.value = `INFORME MENSUAL DE CONTROL ENERGÉTICO & AHORRO - McEnergy`;
  title.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  title.alignment = { vertical: 'middle', horizontal: 'center' };
  summarySheet.getRow(1).height = 28;

  // Subtítulo
  summarySheet.mergeCells('A2:I2');
  const sub = summarySheet.getCell('A2');
  sub.value = `Período: ${data.monthName} ${year} vs ${year - 1} | Meta Corporativa: -3% de Ahorro Eléctrico`;
  sub.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FFFFD100' } };
  sub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };
  sub.alignment = { vertical: 'middle', horizontal: 'center' };
  summarySheet.getRow(2).height = 22;

  // Encabezados tabla resumen
  const headersSummary = [
    'Código', 'Local', 'Consumo Actual (kWh)', 'Consumo Anterior (kWh)',
    'Meta -3% (kWh)', 'Dif vs Meta (kWh)', 'Var Interanual (%)', 'Días Estimados', 'Estado Meta'
  ];
  summarySheet.getRow(4).values = headersSummary;
  summarySheet.getRow(4).height = 24;
  summarySheet.getRow(4).eachCell((cell) => {
    cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDA291C' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  let rowIdx = 5;
  let netTotalCurrent = 0;
  let netTotalPrev = 0;
  let netTotalTarget = 0;

  storesToExport.forEach((item) => {
    const s = item.summary;
    netTotalCurrent += s.totalCurrent;
    netTotalPrev += s.totalPrev;
    netTotalTarget += s.totalTarget;

    const row = summarySheet.getRow(rowIdx);
    row.values = [
      item.store.code,
      item.store.name,
      s.totalCurrent,
      s.totalPrev,
      s.totalTarget,
      Number((s.totalCurrent - s.totalTarget).toFixed(1)),
      s.netDiffPct / 100,
      s.estimatedDaysCount > 0 ? `${s.estimatedDaysCount} días` : '0 días',
      s.isGoalMet ? 'CUMPLE (-3%)' : 'NO CUMPLE'
    ];

    // Formato numérico
    row.getCell(3).numFmt = '#,##0.0 "kWh"';
    row.getCell(4).numFmt = '#,##0.0 "kWh"';
    row.getCell(5).numFmt = '#,##0.0 "kWh"';
    row.getCell(6).numFmt = '+#,##0.0;-#,##0.0;0.0';
    row.getCell(7).numFmt = '+0.0%;-0.0%;0.0%';

    // Resaltar días estimados si hubo faltantes
    if (s.estimatedDaysCount > 0) {
      row.getCell(8).font = { color: { argb: 'FFB91C1C' }, bold: true };
    }

    // Color meta
    row.getCell(9).font = { color: { argb: s.isGoalMet ? 'FF15803D' : 'FFB91C1C' }, bold: true };
    row.getCell(9).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: s.isGoalMet ? 'FFDCFCE7' : 'FFFEE2E2' }
    };

    rowIdx++;
  });

  // Fila Total Red
  const totalRow = summarySheet.getRow(rowIdx);
  const totalDiffVsTarget = Number((netTotalCurrent - netTotalTarget).toFixed(1));
  const totalDiffPct = netTotalPrev > 0 ? (netTotalCurrent - netTotalPrev) / netTotalPrev : 0;
  const isNetworkGoalMet = netTotalPrev > 0 && netTotalCurrent <= netTotalTarget;

  totalRow.values = [
    'TOTAL',
    'CONSOLIDADO RED',
    netTotalCurrent,
    netTotalPrev,
    netTotalTarget,
    totalDiffVsTarget,
    totalDiffPct,
    '-',
    isNetworkGoalMet ? 'CUMPLE (-3%)' : 'NO CUMPLE'
  ];
  totalRow.height = 24;
  totalRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  });
  totalRow.getCell(3).numFmt = '#,##0.0 "kWh"';
  totalRow.getCell(4).numFmt = '#,##0.0 "kWh"';
  totalRow.getCell(5).numFmt = '#,##0.0 "kWh"';
  totalRow.getCell(6).numFmt = '+#,##0.0;-#,##0.0;0.0';
  totalRow.getCell(7).numFmt = '+0.0%;-0.0%;0.0%';

  summarySheet.columns = [
    { width: 10 },
    { width: 22 },
    { width: 22 },
    { width: 22 },
    { width: 20 },
    { width: 18 },
    { width: 18 },
    { width: 16 },
    { width: 18 }
  ];

  // 2. HOJAS INDIVIDUALES POR LOCAL
  storesToExport.forEach((item) => {
    const sheetName = `${item.store.code}`;
    const storeSheet = workbook.addWorksheet(sheetName, {
      views: [{ showGridLines: true }]
    });

    // Cabecera local
    storeSheet.mergeCells('A1:J1');
    const stTitle = storeSheet.getCell('A1');
    stTitle.value = `Detalle Diario - ${item.store.name} (${item.store.code})`;
    stTitle.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    stTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    stTitle.alignment = { vertical: 'middle', horizontal: 'center' };
    storeSheet.getRow(1).height = 26;

    storeSheet.mergeCells('A2:J2');
    const stSub = storeSheet.getCell('A2');
    stSub.value = `Período: ${data.monthName} ${year} • TC Multiplicador: x${item.store.meter_multiplier || 1} • Rojo: Días no cargados (consumo estimado equitativo)`;
    stSub.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FFFFD100' } };
    stSub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };
    stSub.alignment = { vertical: 'middle', horizontal: 'center' };
    storeSheet.getRow(2).height = 20;

    // Encabezados
    const headersStore = [
      'Día', 'Fecha', 'Lectura Display (Crudo)', 'Lectura Acum. (kWh)',
      'Consumo Diario (kWh)', 'Estado Carga', `Consumo ${year - 1} (kWh)`,
      'Meta -3% (kWh)', 'Dif vs Meta', 'Cumplimiento'
    ];
    storeSheet.getRow(4).values = headersStore;
    storeSheet.getRow(4).height = 24;
    storeSheet.getRow(4).eachCell((cell) => {
      cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDA291C' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    let sRowIdx = 5;
    item.series.forEach((dayRow) => {
      const row = storeSheet.getRow(sRowIdx);
      const isEst = dayRow.isEstimated;

      row.values = [
        dayRow.day,
        dayRow.date,
        dayRow.displayValue !== null ? dayRow.displayValue : '-',
        dayRow.kwhReading !== null ? dayRow.kwhReading : '-',
        dayRow.consumption !== null ? dayRow.consumption : '-',
        dayRow.status === 'ESTIMADO' ? 'Estimado (Sin Carga)' : (dayRow.status === 'REAL' ? 'Lectura Real' : 'Base / Sin Registro'),
        dayRow.prevYearConsumption !== null ? dayRow.prevYearConsumption : '-',
        dayRow.targetConsumption !== null ? dayRow.targetConsumption : '-',
        dayRow.diffVsTarget !== null ? dayRow.diffVsTarget : '-',
        dayRow.isGoalMet === true ? 'CUMPLE' : (dayRow.isGoalMet === false ? 'NO CUMPLE' : '-')
      ];

      // Formato numérico si hay valor
      if (typeof dayRow.consumption === 'number') row.getCell(5).numFmt = '#,##0.0';
      if (typeof dayRow.prevYearConsumption === 'number') row.getCell(7).numFmt = '#,##0.0';
      if (typeof dayRow.targetConsumption === 'number') row.getCell(8).numFmt = '#,##0.0';
      if (typeof dayRow.diffVsTarget === 'number') row.getCell(9).numFmt = '+#,##0.0;-#,##0.0;0.0';

      // DESTACAR EN ROJO LOS DÍAS QUE NO SE CARGARON
      if (isEst) {
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }; // Fondo rojo suave
        });
        row.getCell(5).font = { color: { argb: 'FFB91C1C' }, bold: true }; // Texto rojo
        row.getCell(6).font = { color: { argb: 'FFB91C1C' }, bold: true };
      }

      // Colores de cumplimiento meta
      if (dayRow.isGoalMet === true) {
        row.getCell(10).font = { color: { argb: 'FF15803D' }, bold: true };
      } else if (dayRow.isGoalMet === false) {
        row.getCell(10).font = { color: { argb: 'FFB91C1C' }, bold: true };
      }

      sRowIdx++;
    });

    storeSheet.columns = [
      { width: 8 },
      { width: 14 },
      { width: 22 },
      { width: 22 },
      { width: 22 },
      { width: 24 },
      { width: 20 },
      { width: 18 },
      { width: 16 },
      { width: 16 }
    ];
  });

  return {
    workbook,
    filename: `Reporte_Energia_McD_${data.monthName}_${year}.xlsx`
  };
}

/**
 * Dispara la descarga del archivo en el navegador
 */
export async function downloadReportFile({ year, month, selectedStoreId = 'all' }) {
  const { workbook, filename } = await generateMonthlyExcelReport({ year, month, selectedStoreId });
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
