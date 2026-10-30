# ⚡ McEnergy — Control Eléctrico & Comparativa Anual (PWA)

[![React 19](https://img.shields.io/badge/React-19-blue?style=flat-square&logo=react)](https://react.dev)
[![Node.js Express](https://img.shields.io/badge/Node.js-Express-green?style=flat-square&logo=node.js)](https://nodejs.org)
[![Supabase Database](https://img.shields.io/badge/Supabase-Database-3ECF8E?style=flat-square&logo=supabase)](https://supabase.com)
[![PostgreSQL 17](https://img.shields.io/badge/PostgreSQL-17-4169E1?style=flat-square&logo=postgresql)](https://www.postgresql.org)
[![Vite 6](https://img.shields.io/badge/Vite-6-646CFF?style=flat-square&logo=vite)](https://vitejs.dev)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind_CSS-4-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com)
[![Deploy Vercel](https://img.shields.io/badge/Deploy-Vercel-black?style=flat-square&logo=vercel)](https://vercel.com)
[![PWA Mobile-First](https://img.shields.io/badge/PWA-Mobile--First-DA291C?style=flat-square&logo=pwa)](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)

Plataforma Web Progresiva (**PWA**) mobile-first orientada a la gestión técnica, registro diario y fiscalización del consumo energético en locales de McDonald's. Desarrollada como solución end-to-end para digitalizar la carga de medidores eléctricos, automatizar cálculos con factores de transformación de corriente (TC) y ofrecer comparativas interanuales inmediatas (2025 vs 2026), reemplazando planillas manuales en papel o Excel descentralizados.

**Demo en vivo:** [mc-energy-frontend.vercel.app](https://mc-energy-frontend.vercel.app) *(o tu dominio en Vercel)*  
**API Backend:** [mc-energy-be.vercel.app](https://mc-energy-be.vercel.app)

---

## ✨ Features

### Formulario de Lectura Diaria (`/`)

- **PWA Integrada:** Instalable en la pantalla de inicio del dispositivo móvil con `manifest.json` completo, iconografía corporativa y funcionamiento standalone sin barras de navegación.
- **HUD de Locales:** Selector instantáneo en encabezado entre los locales de la red (`AR6`, `AR3`, `MTD`, `DEV`, `DEN`), con persistencia en `localStorage` y acceso ágil sin barreras de autenticación.
- **Factor TC Automatizado:** Reconocimiento técnico del modelo de medidor (Schneider PM5350, Circutor CVM-C10), código de display (`1.8.0`, `Active Energy`, etc.) y multiplicación automática por relación de transformador de corriente (TC x40, x60 o x1).
- **Cálculo Reactivo 24h:** Deducción matemática inmediata del consumo diario:
  $$\text{kWh Total} = \text{Lectura Display} \times \text{Factor TC}$$
  $$\text{Consumo 24h} = \text{kWh Hoy} - \text{kWh Anterior}$$
- **Comparativa Interanual Instantánea:** Detección automática de la lectura del mismo día del año anterior con cálculo del desvío ($\Delta kWh$ y $\Delta \%$) e indicadores cromáticos (verde para ahorro, rojo para sobreconsumo).
- **Reinicio / Reemplazo de Medidor:** Opción técnica (`is_reset`) que previene falsos picos de consumo ante roturas o reemplazo físico del equipo.
- **Reporte WhatsApp Formateado:** Generación de informe preformateado y envío directo en un clic hacia canales de mantenimiento y gerencia.

### Comparativa Anual de Consumo (`/comparison`)

- **Análisis Mes a Mes:** Comparación consolidada interanual entre el año actual (2026) y el año base (2025) por local.
- **Tarjetas KPI:** Métricas en tiempo real de consumo total acumulado, variación interanual neta, porcentaje de ahorro y promedio de consumo diario.
- **Auditoría Día por Día:** Tabla interactiva del día 1 al 31 con desgloses detallados, lectura anterior, lectura actual y badges porcentuales de variación.
- **Detección Temprana de Desvíos:** Identificación inmediata de anomalías operativas (equipos de frío con fallas, luces descalibradas o fugas).

### Consumo Global de la Red (`/dashboard`)

- **Vista Panorámica de la Red:** Matriz consolidada del consumo eléctrico de los 5 locales para cualquier fecha seleccionada.
- **Consumo Total Red:** Agregación global de kWh del día frente a la misma fecha del año anterior.
- **Alerta de Reportes Pendientes:** Detección visual en tiempo real de qué locales aún no cargaron la lectura de la jornada.

### Módulos de Inteligencia Artificial (Gemini Flash)

- **OCR de Display de Medidor (`/`):** Escaneo con visión artificial de pantallas de medidores Schneider PM5350 y Circutor CVM-C10 desde la cámara móvil, detectando el código de energía activa `1.8.0` y auto-completando la lectura con verificación humana.
- **Parser de Mensajes y Chats (`/dashboard`):** Procesamiento de texto desestructurado (mensajes de WhatsApp o notas informales de técnicos) normalizándolos automáticamente a registros tabulares para importación en lote.
- **Auditoría Energética Inteligente (`/comparison`):** Diagnóstico automático mensual en lenguaje natural analizando anomalías, picos y desvíos interanuales con recomendaciones de mantenimiento preventivo y exportación a WhatsApp gerencial.
- **McEnergy ChatBot:** Asistente técnico conversacional en tiempo real disponible globalmente para resolver consultas de factores TC, modelos de medidores y procedimientos operativos (`is_reset`).

---

## 🛠️ Stack Tecnológico

| Capa | Tecnologías |
| :--- | :--- |
| **Frontend** | React 19, Vite 6, Tailwind CSS 4, Lucide Icons, React Router 7 |
| **Arquitectura Móvil** | Progressive Web App (PWA), Service Worker, Web App Manifest |
| **Backend API** | Node.js, Express, CORS, Supabase JS Client, Google Generative AI (`@google/generative-ai`) |
| **Motor de IA** | Gemini Flash (3.5 primario con fallback automático, Visión Multimodal, Structured JSON) |
| **Base de Datos** | PostgreSQL 17 (Supabase Managed), PL/pgSQL Triggers, Views, RLS |
| **Despliegue** | Vercel (Frontend SPA + Backend Serverless) |

---

## 🗄️ Esquema de Base de Datos (Supabase)

El esquema relacional y la lógica de negocio se encuentran consolidados en [`supabase/schema.sql`](supabase/schema.sql):

- **`stores`**: Catálogo de locales con especificaciones de medidor, código técnico de lectura (`display_indicator`) y multiplicador TC (`meter_multiplier`).
- **`meter_readings`**: Registro de lecturas con restricción de unicidad `(store_id, reading_date)`.
- **Triggers PL/pgSQL:**
  - `process_meter_reading_calculation`: Aplica multiplicador, calcula kWh y deduce consumo frente a la lectura cronológicamente anterior.
  - `recalculate_subsequent_reading`: Recalcula en cascada la lectura posterior si se modifica o inserta una fecha intermedia.
- **Vista `v_meter_readings_comparison`**: Une mediante `LEFT JOIN` la lectura de hoy con la del mismo día del año anterior (`reading_date - INTERVAL '1 year'`), calculando $\Delta kWh$ y $\Delta \%$ automáticamente.
- **Row Level Security (RLS)**: Políticas activas para acceso ágil desde las PWA de guardia.

---

## 🚀 Instalación y Puesta en Marcha

### Prerrequisitos
- Node.js 18+ instalado.
- Cuenta o proyecto activo en [Supabase](https://supabase.com).

### 1. Clonar el repositorio
```bash
git clone https://github.com/HastingBoss/McEnergy.git
cd McEnergy
```

### 2. Configurar Base de Datos
1. Acceder al **SQL Editor** en el panel de Supabase.
2. Ejecutar [`supabase/schema.sql`](supabase/schema.sql) para crear las tablas, triggers y vistas.
3. Ejecutar [`supabase/seed.sql`](supabase/seed.sql) para poblar los locales y el historial de prueba.

### 3. Configurar Variables de Entorno

**Frontend (`frontend/.env`):**
```env
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-public-key

VITE_BACKEND_URL=https://mc-energy-be.vercel.app
VITE_API_URL=https://mc-energy-be.vercel.app
```

**Backend (`backend/.env`):**
```env
PORT=3001
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-secret-key
GEMINI_API_KEY=tu-api-key-de-gemini
```

### 4. Ejecutar en Desarrollo

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

**Backend:**
```bash
cd backend
npm install
npm run dev
```

---

## 📄 Licencia

Distribuido bajo licencia MIT. Uso interno para locales de McDonald's.