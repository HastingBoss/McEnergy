import { useState, useEffect } from 'react';
import { Zap } from 'lucide-react';

export default function SplashScreen({ isReady = true, onFinish }) {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (isReady) {
      // Breve pausa para asegurar renderizado fluido de la interfaz
      const timer = setTimeout(() => {
        setFading(true);
        const hideTimer = setTimeout(() => {
          setVisible(false);
          if (onFinish) onFinish();
        }, 400); // Duración del fade-out
        return () => clearTimeout(hideTimer);
      }, 700);

      return () => clearTimeout(timer);
    }
  }, [isReady]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#1D1D1D',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        pointerEvents: fading ? 'none' : 'auto',
        willChange: 'opacity'
      }}
    >
      {/* Contenedor de Logo & Animación de Pulso */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          className="animate-pulse-glow"
          style={{
            width: '84px',
            height: '84px',
            borderRadius: '22px',
            backgroundColor: '#DA291C',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 12px 30px rgba(218, 41, 28, 0.45)',
            border: '2px solid rgba(255, 199, 44, 0.3)'
          }}
        >
          <span style={{ fontSize: '46px', fontWeight: '900', color: '#FFC72C', lineHeight: 1, fontFamily: 'serif' }}>
            M
          </span>
        </div>

        {/* Icono de energía flotante */}
        <div style={{
          position: 'absolute',
          bottom: '-6px',
          right: '-6px',
          backgroundColor: '#FFC72C',
          borderRadius: '50%',
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 10px rgba(0,0,0,0.5)'
        }}>
          <Zap size={18} color="#1D1D1D" fill="#1D1D1D" />
        </div>
      </div>

      {/* Título de la Aplicación */}
      <div style={{ marginTop: '28px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.45rem', fontWeight: '900', color: '#FFFFFF', margin: 0, letterSpacing: '-0.3px' }}>
          McEnergy
        </h1>
        <p style={{ fontSize: '0.82rem', color: '#FFC72C', fontWeight: '700', marginTop: '4px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
          Control Eléctrico & Medidores
        </p>
      </div>

      {/* Indicador de Sincronización */}
      <div style={{
        marginTop: '36px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        backgroundColor: '#27251F',
        border: '1px solid #3A3833',
        borderRadius: '20px',
        padding: '8px 16px',
        fontSize: '0.78rem',
        color: '#A0A0A0'
      }}>
        <div style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: '#FFC72C',
          boxShadow: '0 0 8px #FFC72C'
        }} className="animate-pulse" />
        <span>Sincronizando medidores y base de datos...</span>
      </div>
    </div>
  );
}
