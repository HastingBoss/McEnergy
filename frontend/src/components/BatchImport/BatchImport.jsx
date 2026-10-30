import { useState } from 'react';
import {
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  FileText,
  HelpCircle,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { useStore } from '../../context/StoreContext';

export default function BatchImport({ onImportSuccess }) {
  const { stores } = useStore();
  const [inputText, setInputText] = useState('');
  const [parsedRows, setParsedRows] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  // Parsear fecha flexible (YYYY-MM-DD o DD/MM/YYYY)
  const normalizeDate = (raw) => {
    if (!raw) return null;
    const clean = raw.trim();
    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
      return clean;
    }
    // DD/MM/YYYY o DD-MM-YYYY
    const parts = clean.split(/[/.-]/);
    if (parts.length === 3) {
      if (parts[2].length === 4) {
        // DD/MM/YYYY
        const day = parts[0].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        const year = parts[2];
        return `${year}-${month}-${day}`;
      }
    }
    return null;
  };

  // Parser de texto a filas estructuradas
  const handleParseText = (text) => {
    setInputText(text);
    setStatusMessage(null);

    const storeMap = new Map(stores.map((s) => [s.code.toUpperCase(), s]));
    const lines = text.split(/\r?\n/);
    const results = [];

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      // Omitir vacíos o comentarios
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
        return;
      }

      // Separar por tabuladores, comas, punto y coma o múltiples espacios
      let tokens = trimmed.split(/[\t,;]+/);
      if (tokens.length < 3) {
        tokens = trimmed.split(/\s+/);
      }
      tokens = tokens.map((t) => t.trim()).filter(Boolean);

      if (tokens.length < 3) {
        results.push({
          lineNumber: idx + 1,
          rawLine: trimmed,
          isValid: false,
          error: 'Faltan campos (se requiere: LOCAL, FECHA, VALOR)'
        });
        return;
      }

      const rawCode = tokens[0].toUpperCase();
      const rawDate = tokens[1];
      const rawVal = tokens[2].replace(',', '.'); // Soporte coma decimal europea/latam
      const isResetToken = tokens[3]?.toLowerCase();
      const isReset = isResetToken === 'reset' || isResetToken === 'true' || isResetToken === '1';

      const store = storeMap.get(rawCode);
      const parsedDate = normalizeDate(rawDate);
      const numVal = parseFloat(rawVal);

      const errors = [];
      if (!store) errors.push(`Local desconocido '${rawCode}'`);
      if (!parsedDate) errors.push(`Fecha inválida '${rawDate}' (usa AAAA-MM-DD o DD/MM/AAAA)`);
      if (isNaN(numVal) || numVal < 0) errors.push(`Valor numérico inválido '${rawVal}'`);

      results.push({
        lineNumber: idx + 1,
        rawLine: trimmed,
        isValid: errors.length === 0,
        error: errors.join(' • '),
        store,
        code: rawCode,
        date: parsedDate,
        displayValue: numVal,
        isReset
      });
    });

    setParsedRows(results);
  };

  const validRows = parsedRows.filter((r) => r.isValid);
  const invalidRows = parsedRows.filter((r) => !r.isValid);

  // Ejecutar inserción en Supabase
  const handleExecuteImport = async () => {
    if (validRows.length === 0) return;

    setIsProcessing(true);
    setStatusMessage(null);

    try {
      let insertedCount = 0;
      let errorCount = 0;

      for (const row of validRows) {
        const multiplier = parseFloat(row.store.meter_multiplier) || 1.0;
        const kwhReading = Number((row.displayValue * multiplier).toFixed(3));

        const payload = {
          store_id: row.store.id,
          reading_date: row.date,
          display_value: row.displayValue,
          applied_multiplier: multiplier,
          kwh_reading: kwhReading,
          is_reset: row.isReset,
          technician_name: 'Carga Masiva (Lote)',
          notes: row.isReset ? 'Lectura base manual (Lote)' : 'Carga por lote de auditoría',
          updated_at: new Date().toISOString()
        };

        const { error } = await supabase
          .from('meter_readings')
          .upsert(payload, { onConflict: 'store_id,reading_date' });

        if (error) {
          console.error(`Error al insertar ${row.code} [${row.date}]:`, error);
          errorCount++;
        } else {
          insertedCount++;
        }
      }

      setStatusMessage({
        type: errorCount === 0 ? 'success' : 'warning',
        text: `Lote procesado: ${insertedCount} lecturas guardadas correctamente.${errorCount > 0 ? ` (${errorCount} con error)` : ''}`
      });

      if (insertedCount > 0) {
        setInputText('');
        setParsedRows([]);
        if (onImportSuccess) onImportSuccess();
      }
    } catch (err) {
      console.error('Error general en carga masiva:', err);
      setStatusMessage({ type: 'error', text: 'Error al procesar el lote: ' + err.message });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLoadExample = () => {
    const example = `# Ejemplo de formato (puedes pegar directo desde Excel):
# LOCAL, FECHA, VALOR_CRUDO
MTD, 2026-10-10, 27550.0
MTD, 2026-10-11, 27572.5
MTD, 2026-10-12, 27600.0
AR3, 2026-10-12, 888500.0
DEN, 2026-10-12, 43120.4`;
    handleParseText(example);
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
            <UploadCloud color="#FFC72C" size={24} />
            Carga Masiva por Lote de Texto
          </h2>
          <p style={{ fontSize: '0.82rem', color: '#A0A0A0', margin: '3px 0 0 0' }}>
            Ingresa o pega múltiples lecturas para corregir días, cargar semanas completas o rellenar períodos de prueba.
          </p>
        </div>

        <button
          onClick={handleLoadExample}
          style={{
            backgroundColor: '#262626',
            border: '1px solid #383838',
            color: '#FFC72C',
            padding: '6px 12px',
            borderRadius: '8px',
            fontSize: '0.8rem',
            fontWeight: '700',
            cursor: 'pointer'
          }}
        >
          Cargar Ejemplo
        </button>
      </div>

      {statusMessage && (
        <div style={{
          padding: '12px 14px',
          borderRadius: '10px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: statusMessage.type === 'success' ? '#143823' : (statusMessage.type === 'warning' ? '#3b2f12' : '#3b1212'),
          color: statusMessage.type === 'success' ? '#86efac' : (statusMessage.type === 'warning' ? '#fde047' : '#fca5a5'),
          border: `1px solid ${statusMessage.type === 'success' ? '#22c55e' : (statusMessage.type === 'warning' ? '#eab308' : '#ef4444')}`,
          fontSize: '0.88rem'
        }}>
          {statusMessage.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Ventana de Texto */}
      <div className="card" style={{ padding: '18px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: '700', color: '#FFFFFF' }}>
            Pega el texto aquí (Una lectura por línea):
          </label>
          {inputText && (
            <button
              onClick={() => { setInputText(''); setParsedRows([]); }}
              style={{ background: 'transparent', border: 'none', color: '#888888', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem' }}
            >
              <Trash2 size={14} /> Limpiar
            </button>
          )}
        </div>

        <textarea
          rows={7}
          value={inputText}
          onChange={(e) => handleParseText(e.target.value)}
          placeholder={`Formato admitido (separado por coma, espacio o tabulador de Excel):
LOCAL, FECHA, VALOR
Ejemplo:
MTD, 2026-10-10, 27550.0
MTD, 2026-10-11, 27572.5
AR3, 2026-10-12, 888500.0`}
          style={{
            width: '100%',
            backgroundColor: '#0A0A0A',
            border: '2px solid #2D2D2D',
            borderRadius: '10px',
            color: '#FFC72C',
            fontFamily: 'monospace',
            fontSize: '0.9rem',
            padding: '12px',
            outline: 'none',
            resize: 'vertical'
          }}
        />

        <div style={{ fontSize: '0.75rem', color: '#888888', marginTop: '6px', display: 'flex', justifyContent: 'space-between' }}>
          <span>Locales admitidos: {stores.map((s) => s.code).join(', ')}</span>
          <span>Fechas: AAAA-MM-DD o DD/MM/AAAA</span>
        </div>
      </div>

      {/* Previsualización y Validación */}
      {parsedRows.length > 0 && (
        <div className="card" style={{ padding: '18px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#FFFFFF', margin: 0 }}>
              Previsualización ({validRows.length} válidas, {invalidRows.length} con error)
            </h3>
            <span style={{ fontSize: '0.8rem', color: validRows.length > 0 ? '#4ade80' : '#f87171', fontWeight: '700' }}>
              {validRows.length} listas para importar
            </span>
          </div>

          <div style={{ maxHeight: '250px', overflowY: 'auto', overflowX: 'auto', border: '1px solid #262626', borderRadius: '8px' }}>
            <table style={{ width: '100%', minWidth: '460px', borderCollapse: 'collapse', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
              <thead>
                <tr style={{ backgroundColor: '#1A1A1A', color: '#888888', textAlign: 'left', borderBottom: '1px solid #333' }}>
                  <th style={{ padding: '8px' }}>Línea</th>
                  <th style={{ padding: '8px' }}>Local</th>
                  <th style={{ padding: '8px' }}>Fecha</th>
                  <th style={{ padding: '8px' }}>Valor Display</th>
                  <th style={{ padding: '8px' }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((row, i) => (
                  <tr
                    key={i}
                    style={{
                      borderBottom: '1px solid #222',
                      backgroundColor: row.isValid ? 'transparent' : 'rgba(239, 68, 68, 0.1)'
                    }}
                  >
                    <td style={{ padding: '6px 8px', color: '#888888' }}>{row.lineNumber}</td>
                    <td style={{ padding: '6px 8px', fontWeight: '700', color: row.store ? '#FFC72C' : '#ef4444' }}>
                      {row.code}
                    </td>
                    <td style={{ padding: '6px 8px', color: '#CCCCCC' }}>{row.date || '-'}</td>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: '#FFFFFF' }}>
                      {row.displayValue ?? '-'}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      {row.isValid ? (
                        <span style={{ color: '#4ade80', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle2 size={14} /> Válido
                        </span>
                      ) : (
                        <span style={{ color: '#f87171', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <AlertTriangle size={14} /> {row.error}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={handleExecuteImport}
            disabled={isProcessing || validRows.length === 0}
            style={{
              width: '100%',
              backgroundColor: validRows.length > 0 ? '#FFC72C' : '#333333',
              color: validRows.length > 0 ? '#121212' : '#888888',
              padding: '14px',
              borderRadius: '10px',
              fontSize: '1rem',
              fontWeight: '800',
              marginTop: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              cursor: validRows.length > 0 && !isProcessing ? 'pointer' : 'not-allowed',
              boxShadow: validRows.length > 0 ? '0 4px 14px rgba(255, 188, 13, 0.3)' : 'none'
            }}
          >
            <UploadCloud size={18} />
            {isProcessing ? 'Procesando e insertando en base de datos...' : `Importar ${validRows.length} Lecturas Válidas`}
          </button>
        </div>
      )}
    </div>
  );
}
