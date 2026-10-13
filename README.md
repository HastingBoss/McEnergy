# McDonald's - Control Eléctrico & Comparativa Anual (PWA)

Aplicación Web Progresiva (**PWA**) mobile-first enfocada en el registro diario de medidores eléctricos, factor de cálculo por transformador de corriente (TC) y comparativa de consumo interanual frente al año pasado.

---

## 1. Módulos del Sistema

1. **Lectura Diaria de Medidor (`/`):**
   - Selector instantáneo de local en el encabezado (acceso libre sin contraseñas).
   - Especificaciones técnicas por local: Modelo de medidor, código de display (`1.8.0`, `Active Energy`, etc.) y multiplicador TC (ej. Schneider PM5350 con factor x40).
   - Cálculo reactivo automático: $\text{kWh Total} = \text{Display} \times \text{Multiplicador}$.
   - Consumo diario 24h: $\text{Consumo} = \text{kWh Hoy} - \text{kWh Anterior}$.
   - Comparativa automática frente a la misma fecha del año anterior ($\Delta kWh$ y $\Delta \%$ con indicadores de color).
   - Opción de "Reinicio / Reemplazo de medidor" (`is_reset`).
   - Envío preformateado directo a WhatsApp con reporte técnico.

2. **Comparativa Anual de Consumo (`/comparison`):**
   - Análisis mensual y anual (2026 vs 2025).
   - Tarjetas KPI: Consumo acumulado del mes actual vs año anterior, variación interanual y promedio diario.
   - Tabla comparativa día por día (1 al 31) con desvíos y variaciones porcentuales.

3. **Consumo Global de la Red (`/dashboard`):**
   - Vista panorámica de los 9 locales de la red para cualquier fecha seleccionada.
   - Total red acumulado hoy vs mismo día del año anterior.
   - Detección visual de locales con reporte pendiente y desvíos altos.

---

## 2. Base de Datos (Supabase)

El esquema optimizado para control eléctrico se encuentra en [`supabase/schema_electric.sql`](supabase/schema_electric.sql).

### Pasos de Instalación:
1. Abrir **SQL Editor** en el panel de Supabase.
2. Ejecutar [`supabase/schema_electric.sql`](supabase/schema_electric.sql) (crea las tablas `stores`, `meter_readings`, vistas de comparativa interanual, triggers automáticos de consumo y las semillas de los 9 locales).
3. Opcional: Ejecutar [`supabase/seed_historical_readings.sql`](supabase/seed_historical_readings.sql) para cargar lecturas históricas de 2025 y 2026 y validar inmediatamente el comparador.

---

## 3. Ejecución en Desarrollo

### Frontend:
```bash
cd frontend
npm install
npm run dev
```

Variables de entorno en `frontend/.env`:
```env
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key
```

### Backend (Opcional):
```bash
cd backend
npm install
npm start
```
