# Documentación de Arquitectura de IA — McEnergy PWA

Documentación técnica de la integración de Inteligencia Artificial para el monitoreo energético y asistencia técnica en locales de McDonald's Argentina (Arcos Dorados).

---

## 🤖 Tecnología y Modelos

- **Modelo Primario**: `gemini-3.5-flash` (configurable vía variable `GEMINI_MODEL`).
- **Modelo de Respaldo (Fallback)**: `gemini-2.5-flash` (ejecución automática en caso de saturación temporal 503 o cuota 429).
- **Librería Backend**: `@google/generative-ai` (Node.js SDK).
- **Librería Frontend**: React 19 + Fetch API desacoplada mediante servicio centralizado (`aiService.js`).
- **Arquitectura de Despliegue**: Backend-mediated proxy. Las credenciales de API nunca se exponen en el cliente ni viajan en el bundle de Vite.

---

## 🔐 Seguridad y Gestión de Variables de Entorno

- **Variable de Entorno**: `GEMINI_API_KEY` (configurada exclusivamente en `backend/.env`).
- **Seguridad en Despliegue**: Excluida de Git mediante `.gitignore`. Para producción en Vercel, debe configurarse en el panel de **Environment Variables** del backend `mc-energy-be`.
- **Manejo de Carga de Imágenes**: `express.json({ limit: '15mb' })` y `express.urlencoded({ extended: true, limit: '15mb' })` para aceptar transmisiones de fotos en Base64 sin requerir dependencias de multipart/form-data ni almacenamiento transitorio en disco.

---

## 🛠️ Endpoints de la API Backend (`/api/ai`)

### 1. `POST /api/ai/ocr-meter`
Reconocimiento óptico y extracción de la lectura activa del display.
- **Entrada (`JSON`)**:
  ```json
  {
    "imageBase64": "data:image/jpeg;base64,...",
    "mimeType": "image/jpeg",
    "storeInfo": {
      "name": "Cabildo",
      "code": "MTD",
      "meter_model": "Schneider PM5350",
      "display_indicator": "1.8.0"
    }
  }
  ```
- **Salida (`JSON`)**:
  ```json
  {
    "success": true,
    "readingValue": 27646.2,
    "confidence": 0.96,
    "detectedIndicator": "1.8.0",
    "detectedUnit": "kWh",
    "notes": "Lectura identificada con claridad en la pantalla principal."
  }
  ```

### 2. `POST /api/ai/parse-readings`
Parser inteligente de texto no estructurado para Carga Masiva.
- **Entrada (`JSON`)**:
  ```json
  {
    "rawText": "Ayer 15 de octubre el medidor de Cabildo dio 27550.2 y devoto 18450",
    "validStores": [{ "code": "MTD", "name": "Cabildo" }, { "code": "DEV", "name": "Devoto" }]
  }
  ```
- **Salida (`JSON`)**:
  ```json
  {
    "success": true,
    "readings": [
      { "store_code": "MTD", "reading_date": "2026-10-15", "reading_value": 27550.2 },
      { "store_code": "DEV", "reading_date": "2026-10-15", "reading_value": 18450 }
    ],
    "unparsedLines": []
  }
  ```

### 3. `POST /api/ai/analyze-consumption`
Generación de diagnósticos ejecutivos de eficiencia energética y anomalías.
- **Entrada (`JSON`)**: Metadatos de consumo del período (total kWh actual vs anterior, $\Delta \%$, promedio diario, anomalías detectadas).
- **Salida (`JSON`)**:
  ```json
  {
    "markdown": "### 1. Diagnóstico Ejecutivo\n...\n### 2. Hallazgos Críticos\n...\n### 3. Recomendaciones Operativas\n..."
  }
  ```

### 4. `POST /api/ai/copilot`
Asistente técnico conversacional contextualizado con la red de McDonald's.
- **Entrada (`JSON`)**: `{ message, history, systemContext }`
- **Salida (`JSON`)**: `{ reply: string }`

---

## 📱 Módulos de Frontend (UI/UX)

1. **`MeterOcrModal.jsx`**:
   - Compresión previa en canvas a escala máxima de 1280px para optimizar consumo de red 3G/4G en salas de máquinas.
   - Enfoque *Human-in-the-loop*: la IA sugiere el valor y lo coloca en el formulario, pero requiere la confirmación explícita del técnico de guardia antes de impactar en Supabase.
2. **`AiTextParserModal.jsx`**:
   - Integrado en la vista de carga masiva para tokenizar mensajes informales de chat y cargarlos a la grilla con 1 clic.
3. **`AiAuditModal.jsx`**:
   - Renderizado de auditoría en la vista mensual con acciones directas para copiar o reenviar el informe a gerencia por WhatsApp.
4. **`CopilotChat.jsx`**:
   - Widget flotante global (`fixed`) con chips de consulta rápida sobre especificaciones técnicas de transformadores de corriente (TC), modelos de medidores y políticas de reseteo (`is_reset`).

