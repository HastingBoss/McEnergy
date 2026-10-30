const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY || '';
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

// Modelo configurable con fallback automático ante picos de demanda o cuota (ej: 503 / 429)
const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const FALLBACK_MODEL = 'gemini-2.5-flash';

async function generateWithFallback(promptOrParts, generationConfig = {}) {
  if (!genAI) {
    throw new Error('GEMINI_API_KEY no está configurada en las variables de entorno del backend.');
  }

  try {
    const model = genAI.getGenerativeModel({
      model: PRIMARY_MODEL,
      generationConfig
    });
    const result = await model.generateContent(promptOrParts);
    return result.response;
  } catch (primaryErr) {
    console.warn(`[IA Warning] Error en modelo primario (${PRIMARY_MODEL}): ${primaryErr.message}. Ejecutando fallback a ${FALLBACK_MODEL}...`);
    try {
      const fallbackModel = genAI.getGenerativeModel({
        model: FALLBACK_MODEL,
        generationConfig
      });
      const result = await fallbackModel.generateContent(promptOrParts);
      return result.response;
    } catch (fallbackErr) {
      console.error(`[IA Error] Fallaron ambos modelos (${PRIMARY_MODEL} y ${FALLBACK_MODEL}):`, fallbackErr);
      throw primaryErr;
    }
  }
}

/**
 * Procesa la imagen del display de un medidor eléctrico usando visión multimodal.
 */
async function ocrMeterDisplay({ imageBase64, mimeType = 'image/jpeg', storeInfo = {} }) {
  const prompt = `Actuás como un ingeniero especialista en medidores eléctricos industriales (Schneider PM5350, Circutor CVM-C10, etc.) para locales de McDonald's Argentina.
Tu tarea es leer con máxima precisión el valor numérico de la lectura de Energía Activa Total (kWh) en el display de la imagen adjunta.

Contexto del local:
- Local: ${storeInfo.name || 'No especificado'} (${storeInfo.code || 'N/A'})
- Modelo de medidor esperado: ${storeInfo.meter_model || 'Schneider / Circutor'}
- Código o indicador del display: ${storeInfo.display_indicator || '1.8.0 / Active Energy / Total kWh'}

Reglas de lectura:
1. Buscá el indicador '1.8.0', 'Active Energy', 'EA' o el valor numérico principal acumulado en kWh.
2. Identificá correctamente si contiene puntos o comas decimales (ej. 27646.2 o 276462).
3. Si el display muestra ceros a la izquierda (ej. 0027646.2), descartalos en el valor numérico (27646.2).
4. No apliques factor de transformación (TC); devolvé exactamente la cifra que figura en la pantalla del medidor.

Responde ÚNICAMENTE un objeto JSON con este esquema exacto:
{
  "success": true | false,
  "readingValue": number | null,
  "confidence": number (entre 0.0 y 1.0),
  "detectedIndicator": string (ej: "1.8.0"),
  "detectedUnit": string (ej: "kWh"),
  "notes": string (comentario técnico breve o motivo de error si no es legible)
}`;

  const imagePart = {
    inlineData: {
      data: imageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, ''),
      mimeType: mimeType || 'image/jpeg'
    }
  };

  const response = await generateWithFallback([prompt, imagePart], {
    responseMimeType: 'application/json',
    temperature: 0.1
  });

  return JSON.parse(response.text());
}

/**
 * Parsea texto libre o mensajes informales de WhatsApp para extraer lecturas estructuradas.
 */
async function parseUnstructuredReadings({ rawText, validStores = [] }) {
  const storesDesc = validStores.length > 0
    ? validStores.map(s => `- Código: "${s.code}", Nombre: "${s.name}"`).join('\n')
    : `- Códigos válidos: AR3, AR6, MTD, DEV, DEN`;

  const today = new Date().toISOString().split('T')[0];

  const prompt = `Sos un parser de datos técnicos de mantenimiento. 
Tu labor es extraer registros de lecturas de medidores a partir del texto desestructurado ingresado (ej. notas, chats de WhatsApp, listas en texto plano).

Fecha de referencia actual del sistema: ${today} (Año actual: 2026).
Locales válidos en la red:
${storesDesc}

Reglas:
1. Normalizá cada lectura a la estructura:
   - store_code: Código exacto del local (ej: "MTD", "AR3", "AR6", "DEV", "DEN").
   - reading_date: Fecha en formato "YYYY-MM-DD". Si mencionan "hoy", usa ${today}. Si dicen "ayer", calcula el día anterior.
   - reading_value: Número flotante de la lectura del display (usa punto decimal).
2. Si un registro no tiene local identificable o valor numérico, descartalo.
3. Si el año no está explícito, asume 2026.

Texto a procesar:
"""
${rawText}
"""

Responde ÚNICAMENTE un objeto JSON:
{
  "success": true,
  "readings": [
    {
      "store_code": string,
      "reading_date": "YYYY-MM-DD",
      "reading_value": number,
      "original_fragment": string
    }
  ],
  "unparsedLines": [string]
}`;

  const response = await generateWithFallback(prompt, {
    responseMimeType: 'application/json',
    temperature: 0.1
  });

  return JSON.parse(response.text());
}

/**
 * Genera análisis de consumo, anomalías y recomendaciones gerenciales.
 */
async function generateConsumptionAudit({ storeName, monthName, year, kpis = {}, anomalies = [], dailySummary = [] }) {
  const prompt = `Sos un consultor Senior de Eficiencia Energética para McDonald's Argentina (Arcos Dorados).
Elaborá un diagnóstico ejecutivo conciso y técnico sobre el consumo eléctrico del mes de ${monthName} ${year} para el local ${storeName || 'Red Global'}.

Datos del período:
- Total Consumo ${year}: ${kpis.totalKwhCurrent?.toLocaleString('es-AR') || 0} kWh
- Total Consumo ${year - 1}: ${kpis.totalKwhPrior?.toLocaleString('es-AR') || 0} kWh
- Variación Interanual: ${kpis.deltaPercent !== undefined ? kpis.deltaPercent.toFixed(2) + '%' : 'N/A'} (${kpis.deltaKwh !== undefined ? kpis.deltaKwh.toFixed(1) + ' kWh' : ''})
- Promedio Diario Real: ${kpis.dailyAvgKwh?.toFixed(1) || 0} kWh/día
- Días con Alertas/Anomalías: ${anomalíasFormat(anomalies)}

Estructurá la respuesta en Markdown limpio:
### 1. Diagnóstico Ejecutivo
(Evaluación del desempeño en 2-3 oraciones técnicas directas indicando si hubo sobreconsumo o ahorro real)

### 2. Hallazgos Críticos y Desvíos
(Lista de puntos destacados: días con picos anormales, ceros en el medidor, o fines de semana con comportamiento inusual)

### 3. Recomendaciones Operativas para Mantenimiento
(Recomendaciones técnicas directas: revisión de condensadores de frío, horarios de freezers/turn-on, chequeo de iluminación nocturna o calibración del TC)`;

  const response = await generateWithFallback(prompt, {
    temperature: 0.2
  });

  return {
    markdown: response.text().trim()
  };
}

function anomalíasFormat(anomalies) {
  if (!anomalies || anomalies.length === 0) return 'Ninguna anomalía detectada.';
  return anomalies.slice(0, 5).map(a => `Día ${a.day}: ${a.reason || 'Desvío marcado'} (${a.kwh || 0} kWh)`).join('; ');
}

/**
 * Asistente técnico conversacional para coordinadores y técnicos de guardia.
 */
async function copilotChat({ message, history = [], systemContext = {} }) {
  const storesContext = systemContext.stores
    ? systemContext.stores.map(s => `- ${s.name} (${s.code}): Medidor ${s.meter_model || 'Schneider PM5350'}, Display ${s.display_indicator || '1.8.0'}, TC x${s.meter_multiplier || 1}`).join('\n')
    : 'AR3, AR6, MTD, DEV, DEN con multiplicadores TC x40, x60 o x1.';

  const systemInstruction = `Sos McEnergy Copilot, el asistente técnico especializado en el sistema de control y monitoreo eléctrico de McDonald's Argentina.
Respondé de manera técnica, concisa y directa.

Contexto de la red:
${storesContext}

Procedimientos clave:
- Multiplicador TC: Convierte la lectura del display físico a kWh reales consumidos.
- Reinicio de medidor (is_reset): Debe marcarse cuando se reemplaza el medidor físico o se resetea a cero para evitar picos falsos.
- Horario de lectura: Todos los días a las 12:00 PM (mediodía).
- Comparativa: Se audita el consumo de 2026 frente a 2025 día a día.

Historial de la conversación:
${(history || []).map(h => `${h.role === 'user' ? 'Usuario' : 'Copilot'}: ${h.text}`).join('\n')}

Consulta actual del usuario:
${message}`;

  const response = await generateWithFallback(systemInstruction, {
    temperature: 0.3
  });

  return {
    reply: response.text().trim()
  };
}

module.exports = {
  ocrMeterDisplay,
  parseUnstructuredReadings,
  generateConsumptionAudit,
  copilotChat
};
