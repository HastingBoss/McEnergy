import { useState, useEffect } from 'react';
import { Sparkles, X, Check, Copy, Send, RefreshCw, AlertCircle } from 'lucide-react';
import { generateConsumptionAudit } from '../../services/aiService';

export default function AiAuditModal({
  isOpen,
  onClose,
  storeName,
  monthName,
  year,
  kpis,
  anomalies = [],
  dailySummary = [],
  patternInsights = {}
}) {
  const [reportMarkdown, setReportMarkdown] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [copied, setCopied] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  const LOADING_STEPS = [
    'Consultando registros y lecturas del mes...',
    'Detectando picos, días faltantes y desvíos...',
    'Gemini Flash diagnosticando causas operativas...',
    'Sintetizando balance y acciones recomendadas...'
  ];

  useEffect(() => {
    let timer;
    if (isLoading) {
      setLoadingStep(0);
      setElapsedSec(0);
      timer = setInterval(() => {
        setElapsedSec((s) => s + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isLoading]);

  useEffect(() => {
    let stepTimer;
    if (isLoading) {
      stepTimer = setInterval(() => {
        setLoadingStep((prev) => (prev + 1) % LOADING_STEPS.length);
      }, 2200);
    }
    return () => clearInterval(stepTimer);
  }, [isLoading]);

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
        dailySummary,
        patternInsights
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
      backgroundColor: 'rgba(0,0,0,0.88)',
      backdropFilter: 'blur(6px)',
      zIndex: 9999, // Supera cualquier navbar o barra superior/inferior
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '12px'
    }}>
      <div style={{
        backgroundColor: '#27251F',
        border: '2px solid #FFC72C',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '560px',
        maxHeight: '88vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden', // Evita que el contenedor desplace el botón de cierre
        color: '#FFFFFF',
        boxShadow: '0 24px 48px rgba(0,0,0,0.95)'
      }}>
        {/* Header Fijo con Botón de Cierre Inamovible */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid #3A3833',
          backgroundColor: '#1E1C18',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={20} color="#FFC72C" />
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '900', color: '#FFFFFF' }}>
                Auditoría IA — Coordinador
              </h3>
              <span style={{ fontSize: '0.74rem', color: '#A0A0A0' }}>
                {storeName} • {monthName} {year}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar modal"
            style={{
              backgroundColor: '#1D1D1D',
              border: '1px solid #FFC72C',
              color: '#FFC72C',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '8px',
              minHeight: '38px',
              minWidth: '38px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Cuerpo Desplazable */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          {/* Mini Tarjeta KPI */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '6px',
            backgroundColor: '#1D1D1D',
            padding: '10px',
            borderRadius: '10px',
            border: '1px solid #3A3833',
            textAlign: 'center'
          }}>
            <div>
              <span style={{ fontSize: '0.65rem', color: '#888888', display: 'block' }}>Total {year}</span>
              <strong style={{ fontSize: '0.85rem', color: '#FFC72C' }}>
                {Math.round(kpis?.totalKwhCurrent || 0).toLocaleString('es-AR')}
              </strong>
            </div>
            <div>
              <span style={{ fontSize: '0.65rem', color: '#888888', display: 'block' }}>Año {year - 1}</span>
              <strong style={{ fontSize: '0.85rem', color: '#38BDF8' }}>
                {Math.round(kpis?.totalKwhPrior || 0).toLocaleString('es-AR')}
              </strong>
            </div>
            <div>
              <span style={{ fontSize: '0.65rem', color: '#888888', display: 'block' }}>Variación</span>
              <strong style={{ fontSize: '0.85rem', color: (kpis?.deltaPercent || 0) <= 0 ? '#4ade80' : '#f87171' }}>
                {kpis?.deltaPercent !== undefined ? `${kpis.deltaPercent > 0 ? '+' : ''}${kpis.deltaPercent}%` : 'N/A'}
              </strong>
            </div>
            <div>
              <span style={{ fontSize: '0.65rem', color: '#888888', display: 'block' }}>Prom/día</span>
              <strong style={{ fontSize: '0.85rem', color: '#FFFFFF' }}>
                {kpis?.dailyAvgKwh || 0}
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
              padding: '40px 20px',
              gap: '16px',
              backgroundColor: '#171717',
              borderRadius: '12px',
              border: '1px solid #2F2D28',
              position: 'relative',
              overflow: 'hidden'
            }}>
              {/* Barra superior de brillo animado */}
              <div className="ai-shimmer-bg" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px' }} />

              {/* Ícono central con efecto de anillos de pulso */}
              <div style={{ position: 'relative', width: '64px', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{
                  position: 'absolute',
                  inset: '-6px',
                  borderRadius: '50%',
                  border: '2px solid rgba(255, 199, 44, 0.4)',
                  animation: 'aiRippleRing 2s ease-out infinite'
                }} />
                <div style={{
                  position: 'absolute',
                  inset: '-14px',
                  borderRadius: '50%',
                  border: '1.5px solid rgba(255, 199, 44, 0.2)',
                  animation: 'aiRippleRing 2s ease-out infinite',
                  animationDelay: '0.6s'
                }} />
                <div style={{
                  width: '54px',
                  height: '54px',
                  borderRadius: '50%',
                  backgroundColor: '#27251F',
                  border: '2px solid #FFC72C',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 20px rgba(255, 199, 44, 0.4)',
                  zIndex: 2
                }}>
                  <Sparkles size={26} color="#FFC72C" className="animate-pulse" />
                </div>
              </div>

              {/* Textos dinámicos de progreso */}
              <div style={{ textAlign: 'center', maxWidth: '380px' }}>
                <div style={{
                  fontSize: '0.94rem',
                  fontWeight: '800',
                  color: '#FFFFFF',
                  marginBottom: '6px',
                  minHeight: '26px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'opacity 0.2s ease'
                }}>
                  <span>{LOADING_STEPS[loadingStep]}</span>
                </div>
                <p style={{ fontSize: '0.74rem', color: '#888', margin: 0 }}>
                  Motor Gemini 3.5 Flash procesando en tiempo real ({elapsedSec}s)
                </p>
              </div>

              {/* Puntos pulsantes sincronizados */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                <div className="ai-dot-1" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#FFC72C' }} />
                <div className="ai-dot-2" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#FFC72C' }} />
                <div className="ai-dot-3" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#FFC72C' }} />
              </div>
            </div>
          ) : errorMsg ? (
            <div style={{
              backgroundColor: 'rgba(218, 41, 28, 0.15)',
              border: '1px solid #DA291C',
              borderRadius: '10px',
              padding: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: '#FCA5A5',
              fontSize: '0.82rem'
            }}>
              <AlertCircle size={18} color="#DA291C" style={{ flexShrink: 0 }} />
              <span>{errorMsg}</span>
            </div>
          ) : (
            <div style={{
              backgroundColor: '#1D1D1D',
              border: '1px solid #3A3833',
              borderRadius: '10px',
              padding: '14px',
              fontSize: '0.84rem',
              lineHeight: '1.5',
              color: '#E0E0E0',
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit'
            }}>
              {reportMarkdown}
            </div>
          )}
        </div>

        {/* Footer Fijo con Botones de Acción */}
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid #3A3833',
          backgroundColor: '#1E1C18',
          display: 'flex',
          gap: '8px',
          flexShrink: 0
        }}>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isLoading}
            className="btn-secondary"
            style={{
              padding: '8px 12px',
              minHeight: '42px',
              borderRadius: '8px',
              fontSize: '0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: '5px'
            }}
          >
            <RefreshCw size={14} />
            Regenerar
          </button>

          <button
            type="button"
            onClick={handleCopy}
            disabled={isLoading || !reportMarkdown}
            className="btn-secondary"
            style={{
              padding: '8px 12px',
              minHeight: '42px',
              borderRadius: '8px',
              fontSize: '0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              color: copied ? '#4ade80' : '#FFFFFF'
            }}
          >
            {copied ? <Check size={14} color="#4ade80" /> : <Copy size={14} />}
            {copied ? '¡Copiado!' : 'Copiar'}
          </button>

          <button
            type="button"
            onClick={handleShareWhatsApp}
            disabled={isLoading || !reportMarkdown}
            className="btn-mcd-yellow"
            style={{
              flex: 1,
              padding: '8px 14px',
              minHeight: '42px',
              borderRadius: '8px',
              fontSize: '0.84rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              fontWeight: '800'
            }}
          >
            <Send size={15} />
            WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
}
