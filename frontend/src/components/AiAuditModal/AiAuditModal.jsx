import { useState, useEffect } from 'react';
import { Sparkles, X, Check, Copy, Send, RefreshCw, AlertCircle, FileText } from 'lucide-react';
import { generateConsumptionAudit } from '../../services/aiService';

export default function AiAuditModal({
  isOpen,
  onClose,
  storeName,
  monthName,
  year,
  kpis,
  anomalies = [],
  dailySummary = []
}) {
  const [reportMarkdown, setReportMarkdown] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      handleGenerate();
    } else {
      setReportMarkdown('');
      setErrorMsg(null);
      setCopied(false);
    }
  }, [isOpen]);

  const handleGenerate = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setCopied(false);

    try {
      const result = await generateConsumptionAudit({
        storeName,
        monthName,
        year,
        kpis,
        anomalies,
        dailySummary
      });

      if (result.markdown) {
        setReportMarkdown(result.markdown);
      } else {
        setErrorMsg('No se recibió contenido en el diagnóstico.');
      }
    } catch (err) {
      console.error('Error generando auditoría con IA:', err);
      setErrorMsg(err.message || 'Error de comunicación con Gemini.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!reportMarkdown) return;
    const header = `*Auditoría Energética McEnergy — ${storeName}*\nPeríodo: ${monthName} ${year}\n\n`;
    navigator.clipboard.writeText(header + reportMarkdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleShareWhatsApp = () => {
    if (!reportMarkdown) return;
    const message = `*Auditoría Energética McDonald's — ${storeName}*\n📅 *${monthName} ${year}*\n\n${reportMarkdown}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
  };

  if (!isOpen) return null;

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
        maxWidth: '640px',
        maxHeight: '90vh',
        overflowY: 'auto',
        padding: '24px',
        color: '#FFFFFF',
        boxShadow: '0 16px 36px rgba(0,0,0,0.85)',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid #3A3833', paddingBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={22} color="#FFC72C" />
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '900', color: '#FFFFFF' }}>
                Auditoría Energética IA
              </h3>
              <span style={{ fontSize: '0.78rem', color: '#A0A0A0' }}>
                {storeName} — {monthName} {year}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#A0A0A0', cursor: 'pointer', padding: '4px' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Resumen KPIs del período */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '8px',
          marginBottom: '16px',
          backgroundColor: '#1D1D1D',
          padding: '12px',
          borderRadius: '12px',
          border: '1px solid #3A3833'
        }}>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#888888', display: 'block' }}>Total {year}</span>
            <strong style={{ fontSize: '0.95rem', color: '#FFC72C' }}>
              {Math.round(kpis?.totalKwhCurrent || 0).toLocaleString('es-AR')} kWh
            </strong>
          </div>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#888888', display: 'block' }}>Total {year - 1}</span>
            <strong style={{ fontSize: '0.95rem', color: '#38BDF8' }}>
              {Math.round(kpis?.totalKwhPrior || 0).toLocaleString('es-AR')} kWh
            </strong>
          </div>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#888888', display: 'block' }}>Variación</span>
            <strong style={{ fontSize: '0.95rem', color: (kpis?.deltaPercent || 0) <= 0 ? '#4ade80' : '#f87171' }}>
              {kpis?.deltaPercent !== undefined ? `${kpis.deltaPercent > 0 ? '+' : ''}${kpis.deltaPercent}%` : 'N/A'}
            </strong>
          </div>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#888888', display: 'block' }}>Prom. Diario</span>
            <strong style={{ fontSize: '0.95rem', color: '#FFFFFF' }}>
              {kpis?.dailyAvgKwh || 0} kWh
            </strong>
          </div>
        </div>

        {/* Contenido / Estado de carga */}
        {isLoading ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px 16px',
            gap: '12px'
          }}>
            <RefreshCw size={32} color="#FFC72C" className="animate-spin" />
            <span style={{ fontSize: '0.95rem', fontWeight: '800', color: '#FFC72C' }}>
              Gemini analizando historial y anomalías...
            </span>
            <p style={{ fontSize: '0.78rem', color: '#A0A0A0', textAlign: 'center', maxWidth: '380px', margin: 0 }}>
              Auditando consumos diarios, detectando desvíos técnicos y formulando recomendaciones operativas.
            </p>
          </div>
        ) : errorMsg ? (
          <div style={{
            backgroundColor: 'rgba(218, 41, 28, 0.15)',
            border: '1.5px solid #DA291C',
            borderRadius: '12px',
            padding: '14px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            color: '#FCA5A5',
            fontSize: '0.88rem'
          }}>
            <AlertCircle size={20} color="#DA291C" style={{ flexShrink: 0 }} />
            <span>{errorMsg}</span>
          </div>
        ) : (
          <div style={{
            backgroundColor: '#1D1D1D',
            border: '1px solid #3A3833',
            borderRadius: '12px',
            padding: '18px',
            marginBottom: '16px',
            fontSize: '0.88rem',
            lineHeight: '1.6',
            color: '#E0E0E0',
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit'
          }}>
            {reportMarkdown}
          </div>
        )}

        {/* Footer Actions */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: 'auto' }}>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isLoading}
            className="btn-secondary"
            style={{
              padding: '10px 14px',
              borderRadius: '10px',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <RefreshCw size={15} />
            Regenerar
          </button>

          <button
            type="button"
            onClick={handleCopy}
            disabled={isLoading || !reportMarkdown}
            className="btn-secondary"
            style={{
              padding: '10px 14px',
              borderRadius: '10px',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: copied ? '#4ade80' : '#FFFFFF'
            }}
          >
            {copied ? <Check size={15} color="#4ade80" /> : <Copy size={15} />}
            {copied ? '¡Copiado!' : 'Copiar'}
          </button>

          <button
            type="button"
            onClick={handleShareWhatsApp}
            disabled={isLoading || !reportMarkdown}
            className="btn-mcd-yellow"
            style={{
              flex: 1,
              minWidth: '160px',
              padding: '10px 16px',
              borderRadius: '10px',
              fontSize: '0.88rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              fontWeight: '800'
            }}
          >
            <Send size={16} />
            WhatsApp Gerencial
          </button>
        </div>
      </div>
    </div>
  );
}

