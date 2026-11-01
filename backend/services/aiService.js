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
 * Diagnóstico inteligente de cargas del medidor: detecta anomalías, días faltantes y valores sospechosos.
 * Reemplaza el modelo de reporte estático — produce un diagnóstico técnico orientado a acción.
 */
async function generateConsumptionAudit({ storeName, monthName, year, kpis = {}, anomalies = [], dailySummary = [], patternInsights = {} }) {
  // Construir resumen día a día para el diagnóstico
  const dayLines = dailySummary.length > 0
    ? dailySummary.map(d => {
        const status = d.isMissing
          ? 'SIN LECTURA'
          : d.isEstimated
            ? `ESTIMADO: ${d.kwh} kWh`
            : d.kwh === 0
              ? 'LECTURA EN CERO (0 kWh)'
              : `${d.kwh} kWh`;
        const gap = d.dayGap > 1 ? ` [GAP: ${d.dayGap} días sin datos previos]` : '';
        return `- Día ${d.day}: ${status}${gap}`;
      }).join('\n')
    : anomalies.length > 0
      ? anomalies.map(a => `- Día ${a.day}: ${a.reason} (${a.kwh} kWh)`).join('\n')
      : '- Sin datos de días individuales disponibles.';

  const prompt = `Sos el sistema de diagnóstico técnico de McEnergy para McDonald's Argentina.
Tu tarea es analizar las cargas de medidor del local ${storeName || 'desconocido'} en ${monthName} ${year} y producir un diagnóstico técnico conciso de los problemas encontrados.

Promedio diario normal del local: ${kpis.dailyAvgKwh?.toFixed(1) || 'desconocido'} kWh/día
Total acumulado: ${kpis.totalKwhCurrent?.toLocaleString('es-AR') || 0} kWh
Días con lecturas cargadas: resumen completo a continuación.

Detalle de cargas por día:
${dayLines}

REGLAS ESTRICTAS:
1. NUNCA generes un reporte de consumo. Tu salida es exclusivamente un diagnóstico de problemas en las cargas.
2. Para CADA problema encontrado, indicá: Día → Problema detectado → Causa probable → Acción recomendada.
3. Si un pico alto ocurre luego de días sin lectura (GAP), indicá que es probable acumulación de días y NO una anomalía real de consumo.
4. Si hay lecturas en cero sin reset de medidor, marcalas como sospechosas.
5. Días estimados no son un error, pero si hay muchos seguidos (más de 3), indicalo como alerta de cobertura de datos.
6. Si no hay ningún problema: respondé exactamente "✅ Sin anomalías detectadas en las cargas del mes."
7. Formato de salida: lista numerada, máximo 12 ítems. Sin introducciones ni conclusiones.

Formato de cada ítem:
[N]. Día [X]: [Problema] — Causa probable: [causa] — Acción: [acción concreta]`;

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

  const currentView = systemContext.currentView || 'reading';

  const readingInstruction = `Sos McEnergy ChatBot, asistente de carga de lecturas de medidores para el operario de guardia de McDonald's Argentina.
Tu rol es ayudar al operario del día a cargar la lectura correctamente y derivar problemas que no puede resolver a la administración.

Reglas estrictas:
- Respondé de forma muy breve y simple. Nada de jerga técnica que un operario no entienda.
- Si el problema requiere acceso al sistema, editar registros pasados, cambios de configuración o decisiones de mantenimiento, respondé EXACTAMENTE con: "Avisale a la administración: [acción concreta que deben hacer]".
- No expliques el panel del coordinador, la comparativa anual, ni funciones del dashboard.
- Tu único foco: el proceso de carga diaria de lectura del medidor.

Contexto de locales registrados:
${storesContext}

Historial:
${(history || []).map(h => `${h.role === 'user' ? 'Operario' : 'ChatBot'}: ${h.text}`).join('\n')}

Consulta del operario:
${message}`;

  const dashboardInstruction = `Sos McEnergy ChatBot, asistente técnico del Coordinador de Mantenimiento de McDonald's Argentina.
Ayudás a interpretar y operar el panel de control eléctrico: comparativa anual, estimaciones, auditoría IA, importación de lecturas, anomalías y configuración de medidores.

Procedimientos clave del sistema:
- Multiplicador TC: Convierte la lectura del display físico a kWh reales (ej: display 1000 x TC40 = 40.000 kWh).
- Reinicio de medidor (is_reset): Se marca al reemplazar o resetear el medidor para evitar picos falsos en el cálculo de consumo.
- Estimación automática: Completa días faltantes usando el promedio del mismo día del año anterior con ajuste de tendencia mensual.
- Anomalía "Revisar": Se dispara cuando el consumo diario supera 2.5x el promedio del mes, excluyendo días que siguen a un gap de lecturas (el pico sería acumulación, no consumo real).
- Auditoría IA: Diagnostica problema por problema en las cargas del mes — no genera un reporte de consumo general.
- Importación por lote: Procesa texto libre (chats de WhatsApp, notas) y extrae lecturas estructuradas.

Contexto de locales:
${storesContext}

Historial:
${(history || []).map(h => `${h.role === 'user' ? 'Coordinador' : 'ChatBot'}: ${h.text}`).join('\n')}

Consulta del coordinador:
${message}`;

  const systemInstruction = currentView === 'reading' ? readingInstruction : dashboardInstruction;

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
