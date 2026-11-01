import { useState, useRef, useEffect } from 'react';
import { Camera, Upload, X, Check, RefreshCw, AlertCircle, Sparkles, Pencil } from 'lucide-react';
import { scanMeterDisplay } from '../../services/aiService';

export default function MeterOcrModal({ isOpen, onClose, currentStore, onApplyReading }) {
  const [imagePreview, setImagePreview] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [ocrResult, setOcrResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedValue, setEditedValue] = useState('');
  const [scanStep, setScanStep] = useState(0);
  const [scanSec, setScanSec] = useState(0);

  const SCAN_STEPS = [
    'Enfocando display del medidor...',
    'Buscando indicador de energía activa (1.8.0)...',
    'Gemini Vision procesando dígitos de lectura...',
    'Filtrando ceros y verificando decimales...'
  ];

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  useEffect(() => {
    let t1, t2;
    if (isScanning) {
      setScanStep(0);
      setScanSec(0);
      t1 = setInterval(() => setScanSec((s) => s + 1), 1000);
      t2 = setInterval(() => setScanStep((step) => (step + 1) % SCAN_STEPS.length), 2000);
    }
    return () => {
      clearInterval(t1);
      clearInterval(t2);
    };
  }, [isScanning]);

  if (!isOpen) return null;

  // Redimensiona y comprime imagen para evitar payloads pesados en conexiones móviles
  const compressImage = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
          const maxDim = 1280;
          let width = img.width;
          let height = img.height;

          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve(compressedDataUrl);
        };
        img.onerror = reject;
      };
      reader.onerror = reject;
    });
  };

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setErrorMsg(null);
      setOcrResult(null);
      setIsScanning(true);

      const base64Image = await compressImage(file);
      setImagePreview(base64Image);

      const result = await scanMeterDisplay(base64Image, 'image/jpeg', {
        name: currentStore?.name,
        code: currentStore?.code,
        meter_model: currentStore?.meter_model,
        display_indicator: currentStore?.display_indicator
      });

      if (result.success && result.readingValue !== null && result.readingValue !== undefined) {
        setOcrResult(result);
      } else {
        setErrorMsg(result.notes || 'No se pudo detectar con certeza el valor de energía activa (1.8.0). Intentá con una foto más nítida o de frente al display.');
      }
    } catch (err) {
      console.error('Error durante escaneo OCR:', err);
      setErrorMsg(err.message || 'Error de comunicación con el motor de IA.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleApply = () => {
    if (isEditing) {
      handleApplyEdited();
      return;
    }
    if (ocrResult?.readingValue !== undefined && ocrResult.readingValue !== null) {
      onApplyReading(ocrResult.readingValue);
      handleClose();
    }
  };

  const handleClose = () => {
    setImagePreview(null);
    setOcrResult(null);
    setErrorMsg(null);
    setIsScanning(false);
    setIsEditing(false);
    setEditedValue('');
    onClose();
  };

  const resetCapture = () => {
    setImagePreview(null);
    setOcrResult(null);
    setErrorMsg(null);
    setIsEditing(false);
    setEditedValue('');
  };

  const handleStartEdit = () => {
    setEditedValue(String(ocrResult.readingValue));
    setIsEditing(true);
  };

  const handleApplyEdited = () => {
    const parsed = parseFloat(editedValue.replace(',', '.'));
    if (!isNaN(parsed)) {
      onApplyReading(parsed);
      handleClose();
    }
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
        maxWidth: '440px',
        maxHeight: '90vh',
        overflowY: 'auto',
        padding: '20px',
        color: '#FFFFFF',
        boxShadow: '0 16px 36px rgba(0,0,0,0.85)',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid #3A3833', paddingBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={20} color="#FFC72C" />
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '900', color: '#FFFFFF' }}>
              Escanear Display con IA
            </h3>
          </div>
          <button
            onClick={handleClose}
            disabled={isScanning}
            style={{ background: 'none', border: 'none', color: '#A0A0A0', cursor: 'pointer', padding: '4px' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Info Local */}
        <div style={{ fontSize: '0.8rem', color: '#A0A0A0', marginBottom: '14px', backgroundColor: '#1D1D1D', padding: '8px 12px', borderRadius: '8px' }}>
          Local: <strong style={{ color: '#FFC72C' }}>{currentStore?.name} ({currentStore?.code})</strong>
          {currentStore?.meter_model && <span> | Medidor: {currentStore.meter_model}</span>}
        </div>

        {/* Inputs ocultos para Cámara y Galería */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={handleFileSelected}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileSelected}
        />

        {/* Contenido Dinámico */}
        {!imagePreview ? (
          <div>
            <p style={{ fontSize: '0.86rem', color: '#CCCCCC', marginBottom: '18px', lineHeight: '1.4' }}>
              Fotografiá la pantalla del medidor eléctrico. Gemini identificará de forma automática el indicador de consumo activo (<strong>{currentStore?.display_indicator || '1.8.0'}</strong>) y cargará la cifra en el formulario.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '10px' }}>
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="btn-mcd-yellow"
                style={{
                  minHeight: '52px',
                  borderRadius: '12px',
                  fontSize: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  fontWeight: '800'
                }}
              >
                <Camera size={22} />
                Tomar Foto con Cámara
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn-secondary"
                style={{
                  minHeight: '48px',
                  borderRadius: '12px',
                  fontSize: '0.92rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                <Upload size={18} />
                Seleccionar de Galería
              </button>
            </div>
          </div>
        ) : (
          <div>
            {/* Vista Previa con Overlay de Escaneo */}
            <div style={{
              position: 'relative',
              borderRadius: '12px',
              overflow: 'hidden',
              backgroundColor: '#000',
              maxHeight: '260px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '16px',
              border: '2px solid #3A3833'
            }}>
              <img
                src={imagePreview}
                alt="Medidor"
                style={{ maxWidth: '100%', maxHeight: '260px', objectFit: 'contain' }}
              />

              {isScanning && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundColor: 'rgba(0,0,0,0.72)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '14px',
                  padding: '16px'
                }}>
                  {/* Láser de escaneo animado vertical */}
                  <div className="ai-scan-laser" />

                  {/* Corner targets */}
                  <div style={{ position: 'absolute', top: 12, left: 12, width: 20, height: 20, borderTop: '2px solid #FFC72C', borderLeft: '2px solid #FFC72C' }} />
                  <div style={{ position: 'absolute', top: 12, right: 12, width: 20, height: 20, borderTop: '2px solid #FFC72C', borderRight: '2px solid #FFC72C' }} />
                  <div style={{ position: 'absolute', bottom: 12, left: 12, width: 20, height: 20, borderBottom: '2px solid #FFC72C', borderLeft: '2px solid #FFC72C' }} />
                  <div style={{ position: 'absolute', bottom: 12, right: 12, width: 20, height: 20, borderBottom: '2px solid #FFC72C', borderRight: '2px solid #FFC72C' }} />

                  {/* Ícono central pulsante */}
                  <div style={{
                    width: '50px',
                    height: '50px',
                    borderRadius: '50%',
                    backgroundColor: '#1E1E1E',
                    border: '2px solid #FFC72C',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 0 20px rgba(255, 199, 44, 0.5)'
                  }}>
                    <Camera size={22} color="#FFC72C" className="animate-pulse" />
                  </div>

                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.92rem', color: '#FFC72C', fontWeight: '800', marginBottom: '4px' }}>
                      {SCAN_STEPS[scanStep]}
                    </div>
                    <span style={{ fontSize: '0.74rem', color: '#A0A0A0' }}>
                      Gemini Vision analizando ({scanSec}s)
                    </span>
                  </div>

                  {/* Puntos pulsantes */}
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <div className="ai-dot-1" style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#FFC72C' }} />
                    <div className="ai-dot-2" style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#FFC72C' }} />
                    <div className="ai-dot-3" style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#FFC72C' }} />
                  </div>
                </div>
              )}
            </div>

            {/* Resultado Exitoso */}
            {ocrResult && (
              <div style={{
                backgroundColor: 'rgba(34, 197, 94, 0.12)',
                border: '1.5px solid #22c55e',
                borderRadius: '12px',
                padding: '14px',
                marginBottom: '16px',
                textAlign: 'center'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', color: '#4ade80', fontSize: '0.8rem', fontWeight: '800', marginBottom: '8px' }}>
                  <Check size={16} /> LECTURA IDENTIFICADA
                </div>

                {/* Valor editable */}
                {isEditing ? (
                  <div style={{ display: 'flex', alignItems: 'stretch', justifyContent: 'center', gap: '8px', marginBottom: '10px' }}>
                    <input
                      type="number"
                      value={editedValue}
                      onChange={(e) => setEditedValue(e.target.value)}
                      autoFocus
                      style={{
                        fontSize: '2rem',
                        fontWeight: '900',
                        fontFamily: 'monospace',
                        color: '#FFC72C',
                        backgroundColor: '#1D1D1D',
                        border: '2px solid #FFC72C',
                        borderRadius: '8px',
                        padding: '0 10px',
                        textAlign: 'center',
                        width: '180px',
                        height: '52px',
                        outline: 'none'
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleApplyEdited}
                      className="btn-mcd-yellow"
                      style={{ height: '52px', padding: '0 16px', borderRadius: '8px', fontSize: '0.88rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <Check size={15} /> OK
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '10px' }}>
                    <div style={{ fontSize: '2.4rem', fontWeight: '900', color: '#FFC72C', fontFamily: 'monospace', letterSpacing: '1px' }}>
                      {ocrResult.readingValue}
                    </div>
                    <button
                      type="button"
                      onClick={handleStartEdit}
                      title="Editar valor"
                      style={{ background: 'none', border: '1px solid #3A3833', borderRadius: '6px', color: '#A0A0A0', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center' }}
                    >
                      <Pencil size={14} />
                    </button>
                  </div>
                )}

                <div style={{ fontSize: '0.75rem', color: '#A0A0A0', marginTop: '2px', fontStyle: 'italic' }}>
                  Revisá que la lectura sea correcta antes de guardar.
                </div>
              </div>
            )}

            {/* Error o Lectura Incierta */}
            {errorMsg && (
              <div style={{
                backgroundColor: 'rgba(218, 41, 28, 0.15)',
                border: '1.5px solid #DA291C',
                borderRadius: '12px',
                padding: '12px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                color: '#FCA5A5',
                fontSize: '0.82rem'
              }}>
                <AlertCircle size={18} color="#DA291C" style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Botones de Acción */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={resetCapture}
                disabled={isScanning}
                className="btn-secondary"
                style={{
                  flex: 1,
                  minHeight: '46px',
                  borderRadius: '10px',
                  fontSize: '0.88rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                <RefreshCw size={16} />
                Otra Foto
              </button>

              {ocrResult && (
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={isScanning}
                  className="btn-mcd-yellow"
                  style={{
                    flex: 1.4,
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
                  Usar Lectura
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

