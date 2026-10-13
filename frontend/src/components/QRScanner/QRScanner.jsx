import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Camera, RefreshCw, X, AlertCircle } from 'lucide-react';

/**
 * Componente Reutilizable de Lector QR para PWA Móvil
 * 
 * @param {Function} onScan - Callback invocado al detectar un código: (decodedText, decodedResult) => void
 * @param {Function} onClose - Callback al cerrar el escáner
 * @param {boolean} autoStopOnScan - Si debe detener la cámara tras el primer escaneo exitoso (default: true)
 */
export default function QRScanner({ onScan, onClose, autoStopOnScan = true }) {
  const scannerRef = useRef(null);
  const html5QrCodeRef = useRef(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const scannerElementId = 'qr-reader-container';

    const initializeScanner = async () => {
      try {
        const devices = await Html5Qrcode.getCameras();
        if (!isMounted) return;

        if (!devices || devices.length === 0) {
          setErrorMessage('No se detectaron cámaras en este dispositivo.');
          return;
        }

        setCameras(devices);
        
        // Priorizar la cámara trasera en dispositivos móviles
        const backCamera = devices.find((device) =>
          device.label.toLowerCase().includes('back') ||
          device.label.toLowerCase().includes('trasera') ||
          device.label.toLowerCase().includes('environment')
        );

        const cameraIdToUse = backCamera ? backCamera.id : devices[0].id;
        setSelectedCameraId(cameraIdToUse);

        const html5QrCode = new Html5Qrcode(scannerElementId, {
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          verbose: false
        });
        html5QrCodeRef.current = html5QrCode;

        await startCamera(html5QrCode, cameraIdToUse);
      } catch (err) {
        if (!isMounted) return;
        console.error('Error al iniciar cámara:', err);
        setErrorMessage('Permiso de cámara denegado o no disponible en este navegador.');
      }
    };

    initializeScanner();

    return () => {
      isMounted = false;
      stopScanner();
    };
  }, []);

  const startCamera = async (scannerInstance, cameraId) => {
    if (!scannerInstance) return;

    try {
      await scannerInstance.start(
        cameraId,
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0
        },
        (decodedText, decodedResult) => {
          // Vibración táctil si el dispositivo lo soporta
          if (navigator.vibrate) {
            navigator.vibrate(80);
          }

          if (onScan) {
            onScan(decodedText, decodedResult);
          }

          if (autoStopOnScan) {
            stopScanner();
            if (onClose) onClose();
          }
        },
        () => {
          // Frame sin QR (no reportar error continuo)
        }
      );
      setIsScanning(true);
      setErrorMessage(null);
    } catch (err) {
      console.error('Error al encender lector:', err);
      setErrorMessage('No se pudo inicializar la transmisión de video.');
    }
  };

  const stopScanner = async () => {
    if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
      try {
        await html5QrCodeRef.current.stop();
        html5QrCodeRef.current.clear();
      } catch (err) {
        console.error('Error al detener cámara:', err);
      } finally {
        setIsScanning(false);
      }
    }
  };

  const toggleCamera = async () => {
    if (cameras.length <= 1 || !html5QrCodeRef.current) return;

    const currentIndex = cameras.findIndex((c) => c.id === selectedCameraId);
    const nextIndex = (currentIndex + 1) % cameras.length;
    const nextCamera = cameras[nextIndex];

    await stopScanner();
    setSelectedCameraId(nextCamera.id);
    await startCamera(html5QrCodeRef.current, nextCamera.id);
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0,0,0,0.92)',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px'
    }}>
      {/* Barra superior de controles */}
      <div style={{
        width: '100%',
        maxWidth: '420px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Camera size={22} color="#FFBC0D" />
          <span style={{ fontWeight: '600', fontSize: '1rem', color: '#FFFFFF' }}>Escanear QR</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {cameras.length > 1 && (
            <button
              onClick={toggleCamera}
              className="btn-secondary"
              style={{ padding: '8px 12px', fontSize: '0.85rem' }}
              title="Cambiar cámara"
            >
              <RefreshCw size={16} />
              Girar
            </button>
          )}
          <button
            onClick={() => {
              stopScanner();
              if (onClose) onClose();
            }}
            className="btn-secondary"
            style={{ padding: '8px', borderRadius: '50%' }}
            title="Cerrar"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Visor de Cámara */}
      <div style={{
        width: '100%',
        maxWidth: '380px',
        borderRadius: '16px',
        overflow: 'hidden',
        border: '2px solid #FFBC0D',
        position: 'relative',
        backgroundColor: '#000000'
      }}>
        <div id="qr-reader-container" style={{ width: '100%' }}></div>
      </div>

      {errorMessage && (
        <div style={{
          marginTop: '16px',
          maxWidth: '380px',
          backgroundColor: '#3b1212',
          border: '1px solid #b91c1c',
          borderRadius: '8px',
          padding: '12px',
          display: 'flex',
          gap: '8px',
          color: '#fca5a5',
          fontSize: '0.9rem'
        }}>
          <AlertCircle size={20} />
          <span>{errorMessage}</span>
        </div>
      )}

      <p style={{ marginTop: '16px', color: '#A0A0A0', fontSize: '0.85rem', textAlign: 'center' }}>
        Alineá el código QR del repuesto dentro del cuadro del visor.
      </p>
    </div>
  );
}
