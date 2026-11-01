import { useState } from 'react';
import { Sparkles, X, Check, AlertCircle, RefreshCw, MessageSquare } from 'lucide-react';
import { parseUnstructuredReadings } from '../../services/aiService';

export default function AiTextParserModal({ isOpen, onClose, stores, onApplyText }) {
  const [rawChatText, setRawChatText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [parsedReadings, setParsedReadings] = useState(null);
  const [unparsedLines, setUnparsedLines] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null);

  if (!isOpen) return null;

  const handleProcess = async () => {
    if (!rawChatText.trim()) {
      setErrorMsg('Por favor ingresa o pega el texto a analizar.');
      return;
    }

    setIsProcessing(true);
    setErrorMsg(null);
    setParsedReadings(null);
    setUnparsedLines([]);

    try {
      const result = await parseUnstructuredReadings(rawChatText, stores || []);
      if (result.success && Array.isArray(result.readings) && result.readings.length > 0) {
        setParsedReadings(result.readings);
        setUnparsedLines(result.unparsedLines || []);
      } else {
        setErrorMsg('No se detectaron lecturas claras con fecha y valor en el texto ingresado.');
      }
    } catch (err) {
      console.error('Error parseando texto con IA:', err);
      setErrorMsg(err.message || 'Error al conectar con Gemini para procesar el texto.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApply = () => {
    if (!parsedReadings || parsedReadings.length === 0) return;

    // Formatear a líneas CSV estándar: CODE, YYYY-MM-DD, VALUE
    const formattedText = parsedReadings
      .map(r => `${r.store_code}, ${r.reading_date}, ${r.reading_value}`)
      .join('\n');

    onApplyText(formattedText);
    handleClose();
  };

  const handleClose = () => {
    setRawChatText('');
    setParsedReadings(null);
    setUnparsedLines([]);
    setErrorMsg(null);
    setIsProcessing(false);
    onClose();
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0,0,0,0.85)',
      backdropFilter: 'blur(5px)',
      zIndex: 1100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px'
    }}>
      <div style={{
        backgroundColor: '#27251F',
        border: '2px solid #FFC72C',
        borderRadius: '18px',
        width: '100%',
        maxWidth: '520px',
        maxHeight: '90vh',
        overflowY: 'auto',
        padding: '22px',
        color: '#FFFFFF',
        boxShadow: '0 16px 36px rgba(0,0,0,0.85)'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid #3A3833', paddingBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={20} color="#FFC72C" />
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '900', color: '#FFFFFF' }}>
              Parser Inteligente con Gemini IA
            </h3>
          </div>
          <button
            onClick={handleClose}
            disabled={isProcessing}
            style={{ background: 'none', border: 'none', color: '#A0A0A0', cursor: 'pointer', padding: '4px' }}
          >
            <X size={20} />
          </button>
        </div>

        <p style={{ fontSize: '0.84rem', color: '#CCCCCC', marginBottom: '14px', lineHeight: '1.4' }}>
          Pegá un mensaje informal de WhatsApp, correos o notas rápidas de los técnicos de guardia. Gemini extraerá automáticamente el local, fecha y valor del medidor normalizándolos en lote.
        </p>

        {/* Textarea de entrada */}
        <div style={{ marginBottom: '14px' }}>
          <textarea
            rows={5}
            value={rawChatText}
            onChange={(e) => setRawChatText(e.target.value)}
            disabled={isProcessing}
            placeholder={`Ejemplo:
"Hola Luk, te paso los números: ayer 15/10 en MTD el medidor dio 27550.2 y hoy marco 27610. En devoto el 15/10 fue 18450"`}
            style={{
              width: '100%',
              backgroundColor: '#1D1D1D',
              border: '2px solid #3A3833',
              borderRadius: '12px',
              color: '#FFFFFF',
              fontSize: '0.88rem',
              padding: '12px',
              fontFamily: 'inherit',
              outline: 'none',
              resize: 'vertical'
            }}
          />
        </div>

        {isProcessing && (
          <div style={{
            backgroundColor: '#1E1B13',
            border: '1.5px solid #FFC72C',
            borderRadius: '12px',
            padding: '14px 16px',
            marginBottom: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: '0 0 16px rgba(255, 199, 44, 0.2)'
          }}>
            <div className="ai-shimmer-bg" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px' }} />
            <Sparkles size={22} color="#FFC72C" className="animate-pulse" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.86rem', fontWeight: '800', color: '#FFFFFF' }}>
                Gemini procesando texto y detectando lecturas...
              </div>
              <div style={{ fontSize: '0.74rem', color: '#A0A0A0' }}>
                Normalizando locales, fechas y mediciones en tiempo real
              </div>
            </div>
            <div style={{ display: 'flex', gap: '5px' }}>
              <span className="ai-dot-1" style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#FFC72C' }} />
              <span className="ai-dot-2" style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#FFC72C' }} />
              <span className="ai-dot-3" style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#FFC72C' }} />
            </div>
          </div>
        )}

        {errorMsg && (
          <div style={{
            backgroundColor: 'rgba(218, 41, 28, 0.15)',
            border: '1.5px solid #DA291C',
            borderRadius: '10px',
            padding: '10px 12px',
            marginBottom: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#FCA5A5',
            fontSize: '0.82rem'
          }}>
            <AlertCircle size={18} color="#DA291C" style={{ flexShrink: 0 }} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Resultados Detectados */}
        {parsedReadings && (
          <div style={{
            backgroundColor: 'rgba(34, 197, 94, 0.1)',
            border: '1.5px solid #22c55e',
            borderRadius: '12px',
            padding: '14px',
            marginBottom: '16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ color: '#4ade80', fontSize: '0.82rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Check size={16} /> {parsedReadings.length} lecturas detectadas
              </span>
            </div>

            <div style={{
              maxHeight: '140px',
              overflowY: 'auto',
              backgroundColor: '#1D1D1D',
              borderRadius: '8px',
              padding: '8px',
              fontFamily: 'monospace',
              fontSize: '0.82rem'
            }}>
              {parsedReadings.map((r, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 6px', borderBottom: idx < parsedReadings.length - 1 ? '1px solid #2D2D2D' : 'none' }}>
                  <span style={{ color: '#FFC72C', fontWeight: '800' }}>{r.store_code}</span>
                  <span style={{ color: '#CCCCCC' }}>{r.reading_date}</span>
                  <span style={{ color: '#4ade80', fontWeight: '800' }}>{r.reading_value}</span>
                </div>
              ))}
            </div>

            {unparsedLines.length > 0 && (
              <div style={{ marginTop: '8px', fontSize: '0.74rem', color: '#A0A0A0' }}>
                Omitidas por falta de datos: {unparsedLines.length} líneas.
              </div>
            )}
          </div>
        )}

        {/* Botones */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            onClick={parsedReadings ? () => { setParsedReadings(null); } : handleProcess}
            disabled={isProcessing || (!rawChatText.trim() && !parsedReadings)}
            className={parsedReadings ? 'btn-secondary' : 'btn-mcd-yellow'}
            style={{
              flex: 1,
              minHeight: '46px',
              borderRadius: '10px',
              fontSize: '0.92rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              fontWeight: '800'
            }}
          >
            {isProcessing ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                Procesando con Gemini...
              </>
            ) : parsedReadings ? (
              <>
                <RefreshCw size={16} />
                Reintentar
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Extraer Lecturas
              </>
            )}
          </button>

          {parsedReadings && (
            <button
              type="button"
              onClick={handleApply}
              className="btn-mcd-yellow"
              style={{
                flex: 1.2,
                minHeight: '46px',
                borderRadius: '10px',
                fontSize: '0.92rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                fontWeight: '800'
              }}
            >
              <Check size={18} />
              Cargar en Lote
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

