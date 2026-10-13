import { useState, useEffect } from 'react';
import './InstallPWA.css';

export default function InstallPWA() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`PWA install user outcome: ${outcome}`);

    setDeferredPrompt(null);
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="install-pwa-banner">
      <button 
        className="install-pwa-close-button" 
        onClick={() => setIsVisible(false)}
        aria-label="Cerrar"
      >
        ✕
      </button>
      <div className="install-pwa-content">
        <div className="install-pwa-icon">🍔</div>
        <div className="install-pwa-text">
          <h3>Instalá la App de Mantenimiento</h3>
          <p>Acceso rápido a cámara QR y registro diario sin conexión.</p>
        </div>
      </div>
      <button className="install-pwa-button" onClick={handleInstallClick}>
        Instalar
      </button>
    </div>
  );
}
