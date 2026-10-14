import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import './InstallPWA.css';

export default function InstallPWA() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isVisible, setIsVisible] = useState(() => {
    return sessionStorage.getItem('mcd_pwa_dismissed') !== 'true';
  });

  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      if (sessionStorage.getItem('mcd_pwa_dismissed') !== 'true') {
        setIsVisible(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleDismiss = () => {
    sessionStorage.setItem('mcd_pwa_dismissed', 'true');
    setIsVisible(false);
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`PWA install user outcome: ${outcome}`);

    setDeferredPrompt(null);
    handleDismiss();
  };

  if (!isVisible) return null;

  return (
    <div className="install-pwa-banner">
      <div className="install-pwa-content">
        <div className="install-pwa-icon">⚡</div>
        <div className="install-pwa-text">
          <h3>Instalar McEnergy</h3>
          <p>Acceso rápido y registro diario sin conexión.</p>
        </div>
      </div>
      <div className="install-pwa-actions">
        <button className="install-pwa-button" onClick={handleInstallClick}>
          Instalar
        </button>
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
