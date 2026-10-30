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
1. Buscá el indicador '1.8.0', 'Active Energy', 'EA' o 'TOTAL kWh' en el display.
2. Muchos medidores (ABB Alpha II, Circutor, Schneider) muestran el display dividido en DOS GRUPOS separados por un espacio o guión: un grupo de 3 dígitos de REGISTRO/PROGRAMA (ej. "003", "001") y el grupo de la LECTURA real de energía (ej. "43537.2"). El grupo de registro NO es parte de la lectura de energía.
3. Tomá ÚNICAMENTE el grupo de mayor número de dígitos como la lectura de energía. Si ves "003 43537.2", el valor correcto es 43537.2 (no 343537.2).
4. Descartá ceros a la izquierda del grupo de lectura (ej. "043537.2" → 43537.2).
5. Identificá correctamente si contiene punto o coma decimal (ej. 27646.2 o 276462).
6. No apliques factor de transformación (TC); devolvé exactamente la cifra del grupo de energía del display.

Responde ÚNICAMENTE un objeto JSON con este esquema exacto:
{
  "success": true | false,
  "readingValue": number | null,
  "notes": string (solo si no es legible, describí el motivo en máximo 10 palabras)
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
 * Genera análisis de consumo, anomalías y recomendaciones gerenciales (Conciso para Coordinadores).
 */
async function generateConsumptionAudit({ storeName, monthName, year, kpis = {}, anomalies = [], patternInsights = {} }) {
  const { weekendAvgKwh, weekdayAvgKwh, topHighDays = [], targetKwh, meetsTarget } = patternInsights;

  const topDaysText = topHighDays.length > 0
    ? topHighDays.map(d => `- ${d.dayName} ${d.day} de ${monthName}: ${d.kwh.toLocaleString('es-AR')} kWh (${d.diffVsPrevYear > 0 ? '+' : ''}${d.diffVsPrevYear?.toFixed(1)} kWh vs año anterior)`).join('\n')
    : 'No hay registros suficientes de días pico.';

  const weekendComparison = (weekendAvgKwh && weekdayAvgKwh)
    ? `Promedio fin de semana: ${weekendAvgKwh.toLocaleString('es-AR')} kWh/día vs Días hábiles: ${weekdayAvgKwh.toLocaleString('es-AR')} kWh/día (Diferencia: ${(weekendAvgKwh - weekdayAvgKwh > 0 ? '+' : '')}${(weekendAvgKwh - weekdayAvgKwh).toFixed(1)} kWh)`
    : 'Datos insuficientes para comparar fines de semana.';

  const prompt = `Sos el Coordinador de Mantenimiento de McDonald's Argentina (Arcos Dorados).
Elaborá un reporte de auditoría energética BREVE, SINTÉTICO Y DIRECTO para el coordinador sobre el local ${storeName || 'Red Global'} en ${monthName} ${year}.

Métricas consolidadas reales:
- Consumo ${year}: ${kpis.totalKwhCurrent?.toLocaleString('es-AR') || 0} kWh
- Consumo ${year - 1}: ${kpis.totalKwhPrior?.toLocaleString('es-AR') || 0} kWh
- Variación interanual: ${kpis.deltaPercent !== undefined ? (kpis.deltaPercent > 0 ? '+' : '') + kpis.deltaPercent.toFixed(2) + '%' : 'N/A'} (${kpis.deltaKwh !== undefined ? (kpis.deltaKwh > 0 ? '+' : '') + kpis.deltaKwh.toFixed(1) + ' kWh' : ''})
- Meta corporativa (-3% vs ${year - 1}): Meta de ${targetKwh ? targetKwh.toLocaleString('es-AR') + ' kWh' : 'N/A'} (${meetsTarget ? 'CUMPLE META' : 'NO CUMPLE META'})
- Promedio diario: ${kpis.dailyAvgKwh?.toFixed(1) || 0} kWh/día
- Comparativa Fines de semana vs Días de semana: ${weekendComparison}
- Días con mayor consumo registrado:
${topDaysText}
- Alertas / Incongruencias detectadas: ${anomalíasFormat(anomalies)}

REGLAS DE ORO:
1. MÁXIMO 10 a 14 LÍNEAS TOTALES. Nada de introducciones ni párrafos largos de teoría.
2. Enfocate exclusivamente en el balance de consumo, ahorro/sobreconsumo y el comportamiento en fines de semana o feriados.
3. Si un día pico coincide con fin de semana o feriado nacional (ej: 12 de Octubre, fines de semana largos), marcalo puntualmente.
4. Prohibido inventar supuestos sobre equipos (no inventes fotosensibles, freidoras o anomalías que no existieron).

Estructura obligatoria en Markdown:
📊 *Balance y Ahorro:*
- Consumo: ${kpis.totalKwhCurrent?.toLocaleString('es-AR') || 0} kWh vs ${kpis.totalKwhPrior?.toLocaleString('es-AR') || 0} kWh (${kpis.deltaPercent > 0 ? '+' : ''}${kpis.deltaPercent?.toFixed(1)}%)
- Meta -3%: [CUMPLE con ahorro de X kWh / NO CUMPLE por exceso de X kWh]
- Promedio: ${kpis.dailyAvgKwh?.toFixed(1) || 0} kWh/día

📅 *Fines de Semana, Feriados y Picos:*
- Fines de semana vs Semana: [Síntesis en 1 línea del promedio y si los findes traccionaron al alza]
- Días con mayor demanda: [Citar brevemente las 1-2 fechas pico con día de la semana y si fue feriado/finde]
${anomalies.length > 0 ? '- Desvíos/Alertas: [1 línea con las alertas registradas]' : ''}

⚡ *Acción Operativa:*
- [1 sola recomendación concreta y accionable para el técnico de guardia en base al sobreconsumo o felicitación técnica por ahorro]`;

  const response = await generateWithFallback(prompt, {
    temperature: 0.1
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

  const systemInstruction = `Sos McEnergy ChatBot, el asistente técnico especializado en el sistema de control y monitoreo eléctrico de McDonald's Argentina.
Respondé de manera técnica, concisa y directa.

Contexto de la red:
${storesContext}

Procedimientos clave:
- Multiplicador TC: Convierte la lectura del display físico a kWh reales consumidos.
- Reinicio de medidor (is_reset): Debe marcarse cuando se reemplaza el medidor físico o se resetea a cero para evitar picos falsos.
- Horario de lectura: Todos los días a las 12:00 PM (mediodía).
- Comparativa: Se audita el consumo de 2026 frente a 2025 día a día.

Historial de la conversación:
${(history || []).map(h => `${h.role === 'user' ? 'Usuario' : 'ChatBot'}: ${h.text}`).join('\n')}

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
