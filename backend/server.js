process.env.TZ = 'America/Argentina/Buenos_Aires';

const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Inicialización de Supabase con Service Role (si se requiere para tareas administrativas)
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAdmin = (supabaseUrl && supabaseServiceKey) 
  ? createClient(supabaseUrl, supabaseServiceKey) 
  : null;

// Healthcheck y diagnóstico de tiempo de servidor
app.get('/api/health', (req, res) => {
  const now = new Date();
  res.json({
    status: 'ok',
    service: 'mcd-maintenance-backend',
    serverTime: now.toISOString(),
    localTime: now.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
  });
});

// Endpoint auxiliar para formateo de mensaje de WhatsApp y validación de lectura
app.post('/api/report/format-whatsapp', (req, res) => {
  const { storeName, readingValue, calculatedConsumption, technicianName } = req.body;

  if (!storeName || readingValue === undefined) {
    return res.status(400).json({ error: 'Faltan parámetros requeridos.' });
  }

  const dateStr = new Date().toLocaleDateString('es-AR');
  const message = `*Reporte Eléctrico - ${storeName}*\n` +
    `📅 Fecha: ${dateStr}\n` +
    `⚡ Lectura: ${readingValue} kWh\n` +
    `📊 Consumo 24h: ${calculatedConsumption || 0} kWh\n` +
    `👨‍🔧 Técnico: ${technicianName || 'No especificado'}`;

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;

  res.json({
    message,
    whatsappUrl
  });
});

app.listen(PORT, () => {
  console.log(`McDonald's Maintenance Backend running on port ${PORT}`);
});

module.exports = app;
