/**
 * Servicio frontend para comunicación con endpoints de Inteligencia Artificial (Gemini).
 */

const getApiBaseUrl = () => {
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return 'http://localhost:3001';
  }
  return import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || '';
};

const API_BASE = getApiBaseUrl();

/**
 * Escanea la fotografía de un display de medidor eléctrico con Gemini Vision.
 * @param {string} imageBase64 - Cadena en base64 de la imagen tomada.
 * @param {string} mimeType - Tipo MIME (ej: image/jpeg).
 * @param {object} storeInfo - Datos del local (nombre, medidor, multiplicador).
 */
export async function scanMeterDisplay(imageBase64, mimeType = 'image/jpeg', storeInfo = {}) {
  const response = await fetch(`${API_BASE}/api/ai/ocr-meter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, mimeType, storeInfo })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Error en escaneo OCR (${response.status})`);
  }

  return response.json();
}

/**
 * Parsea texto libre informal o chats de WhatsApp a registros de lecturas tabulares.
 * @param {string} rawText - Texto pegado por el usuario.
 * @param {Array} validStores - Lista de locales válidos para match.
 */
export async function parseUnstructuredReadings(rawText, validStores = []) {
  const response = await fetch(`${API_BASE}/api/ai/parse-readings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawText, validStores })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Error en procesamiento de texto (${response.status})`);
  }

  return response.json();
}

/**
 * Genera un diagnóstico y auditoría ejecutiva de consumos con recomendaciones.
 */
export async function generateConsumptionAudit({ storeName, monthName, year, kpis, anomalies, dailySummary, patternInsights }) {
  const response = await fetch(`${API_BASE}/api/ai/analyze-consumption`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storeName, monthName, year, kpis, anomalies, dailySummary, patternInsights })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Error generando auditoría (${response.status})`);
  }

  return response.json();
}

/**
 * Consulta al Asistente / Copiloto de Mantenimiento.
 */
export async function askCopilot(message, history = [], systemContext = {}) {
  const response = await fetch(`${API_BASE}/api/ai/copilot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, systemContext })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Error al consultar al copiloto (${response.status})`);
  }

  return response.json();
}

