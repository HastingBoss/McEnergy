import { useState, useEffect } from 'react';
import { X, Share, PlusSquare } from 'lucide-react';
import './InstallPWA.css';

/**
 * Detecta si la aplicación ya se está ejecutando instalada en modo standalone
 */
function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    document.referrer.includes('android-app://') ||
    localStorage.getItem('mcd_pwa_installed') === 'true'
  );
}

/**
 * Detecta si el usuario está navegando desde un dispositivo iOS (iPhone / iPad / iPod)
 */
function isIos() {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua) && !window.MSStream;
}

export default function InstallPWA() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isIosPrompt, setIsIosPrompt] = useState(false);

  useEffect(() => {
    // Si ya está instalada como PWA o el usuario la cerró permanentemente, no mostrar
    if (isStandalone() || localStorage.getItem('mcd_pwa_dismissed') === 'true') {
      return;
    }

    // Caso A: Dispositivos iOS / Apple (Safari no soporta evento beforeinstallprompt)
    if (isIos()) {
      setIsIosPrompt(true);
      setIsVisible(true);
      return;
    }

    // Caso B: Android / Chrome / Edge con prompt nativo
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsVisible(true);
    };

    const handleAppInstalled = () => {
      localStorage.setItem('mcd_pwa_installed', 'true');
      setIsVisible(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleDismiss = () => {
    localStorage.setItem('mcd_pwa_dismissed', 'true');
    setIsVisible(false);
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      localStorage.setItem('mcd_pwa_installed', 'true');
    }
    setDeferredPrompt(null);
    setIsVisible(false);
  };

  // Si ya está abierta como PWA instalada, nunca renderizar
  if (!isVisible || isStandalone()) return null;

  return (
    <div className="install-pwa-banner">
      <div className="install-pwa-content">
        <div className="install-pwa-icon">⚡</div>
        <div className="install-pwa-text">
          <h3>Instalar McEnergy</h3>
          {isIosPrompt ? (
            <p style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
              Tocá <Share size={13} color="#38BDF8" /> y luego <strong>"Agregar al inicio"</strong> <PlusSquare size={13} color="#FFBC0D" />
            </p>
          ) : (
            <p>Acceso directo desde la pantalla de inicio.</p>
          )}
        </div>
      </div>
      <div className="install-pwa-actions">
        {!isIosPrompt && (
          <button className="install-pwa-button" onClick={handleInstallClick}>
            Instalar
          </button>
        )}
        <button 
          className="install-pwa-close-button" 
          onClick={handleDismiss}
          aria-label="Cerrar aviso de instalación"
          title="Cerrar"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
