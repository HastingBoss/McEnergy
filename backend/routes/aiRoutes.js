const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');

// POST /api/ai/ocr-meter - Reconocimiento visual del display del medidor
router.post('/ocr-meter', async (req, res) => {
  try {
    const { imageBase64, mimeType, storeInfo } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'Se requiere imageBase64 para el escaneo del display.' });
    }

    const data = await aiService.ocrMeterDisplay({ imageBase64, mimeType, storeInfo });
    res.json(data);
  } catch (error) {
    console.error('Error en /api/ai/ocr-meter:', error);
    res.status(500).json({ error: error.message || 'Error procesando OCR con Gemini.' });
  }
});

// POST /api/ai/parse-readings - Parser inteligente de texto libre o chats de WhatsApp
router.post('/parse-readings', async (req, res) => {
  try {
    const { rawText, validStores } = req.body;
    if (!rawText || !rawText.trim()) {
      return res.status(400).json({ error: 'El campo rawText es requerido.' });
    }

    const data = await aiService.parseUnstructuredReadings({ rawText, validStores });
    res.json(data);
  } catch (error) {
    console.error('Error en /api/ai/parse-readings:', error);
    res.status(500).json({ error: error.message || 'Error parseando lecturas con IA.' });
  }
});

// POST /api/ai/analyze-consumption - Diagnóstico y auditoría gerencial
router.post('/analyze-consumption', async (req, res) => {
  try {
    const { storeName, monthName, year, kpis, anomalies, dailySummary } = req.body;
    const data = await aiService.generateConsumptionAudit({
      storeName,
      monthName,
      year,
      kpis,
      anomalies,
      dailySummary
    });
    res.json(data);
  } catch (error) {
    console.error('Error en /api/ai/analyze-consumption:', error);
    res.status(500).json({ error: error.message || 'Error generando análisis con IA.' });
  }
});

// POST /api/ai/copilot - Asistente técnico conversacional
router.post('/copilot', async (req, res) => {
  try {
    const { message, history, systemContext } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'El mensaje es obligatorio.' });
    }

    const data = await aiService.copilotChat({ message, history, systemContext });
    res.json(data);
  } catch (error) {
    console.error('Error en /api/ai/copilot:', error);
    res.status(500).json({ error: error.message || 'Error consultando al copiloto IA.' });
  }
});

module.exports = router;

