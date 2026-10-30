# Manual Operativo McEnergy — Control Eléctrico McDonald's

Guía de referencia técnica y operativa para técnicos de guardia y coordinadores de mantenimiento.

---

## 1. Guía Rápida para el Técnico de Guardia

La pantalla principal (`/`) está optimizada para ser a prueba de fallos, ágil y utilizar únicamente los valores visibles en el display físico del medidor.

### 1.1 Flujo Diario de Carga (12:00 PM)
1. **Seleccionar Local**: En el desplegable superior, elegí el local correspondiente (`MTD`, `AR3`, `AR6`, `DEN` o `DEV`).
2. **Consultar la Referencia Anterior**: En la tarjeta inferior podés ver la *Lectura día anterior* (muestra el valor exacto cargado el día previo como guía visual).
3. **Ingresar la Lectura del Display**:
   - Tipeá únicamente los números que ves en la pantalla del medidor (admite números enteros y coma/punto decimal).
   - **Nota técnica**: No multipliques por el factor TC; el sistema aplica el multiplicador internamente en la base de datos.
4. **Presionar "Cargar"**: Aparecerá un cuadro de confirmación con el valor ingresado en grande para evitar errores de tipeo.
5. **Confirmar**: El registro se guardará en la base de datos de inmediato.

### 1.2 Modificar una Lectura Ya Cargada
- Si la lectura de hoy ya fue registrada y necesitás corregir un número, hacé clic en **Modificar**.
- Confirmá que deseás editar el registro, ingresá el valor corregido y presioná **Guardar Cambios**.
- La base de datos recalculará automáticamente el consumo del día y actualizará las comparativas.

### 1.3 Envío de Reporte por WhatsApp
- Luego de registrar la lectura, presioná el botón **WhatsApp**.
- Abrirá automáticamente la conversación con el formato sintético oficial:
```text
*Reporte Eléctrico - McDonald's MTD*
📅 Fecha: 14/10/2026 (12:00 PM)
🔢 Display: 27646.2
```

---

## 2. Guía para el Coordinador y Administrador

El panel de gestión y auditoría se encuentra en la pestaña inferior **Red & Comparativa** (`/dashboard`).

### 2.1 Acceso Seguro con PIN
- El acceso está protegido por clave en la base de datos.
- **PIN predeterminado**: `2026`
- Una vez ingresado, la sesión permanece desbloqueada en el dispositivo. Para bloquear nuevamente, tocá el candado superior.

---

### 2.2 Vista 1: Red Global (Día)
Permite monitorear el consumo consolidado de los 5 locales en una fecha específica:
- **Total Red (kWh)**: Suma del consumo del día entre todos los locales cargados.
- **Mismo Día Año Anterior**: Comparativa directa contra la misma fecha de 2025.
- **Variación Red Interanual**: Indicador en verde (ahorro) o rojo (exceso) con delta en kWh y porcentaje.
- **Estado por Local**: Lista en tiempo real de qué locales ya registraron su medición y cuáles siguen pendientes.

---

### 2.3 Vista 2: Comparativa Anual (Mes a Mes)
Análisis de evolución temporal por local:
- Selector de Local, Mes y Año.
- **KPIs Consolidados del Mes**:
  - Acumulado del año en curso vs acumulado del año anterior.
  - Promedio diario de consumo real.
  - Variación interanual consolidada.
- **Detalle Diario (Días 1 al 31)**:
  - Fila por fila con el consumo diario en kWh de 2026 en amarillo y 2025 en celeste.
  - Diferencia y porcentaje de variación día a día.
  - Alerta visual `⚠️ Revisar` ante posibles valores anómalos o incongruencias (como 0 kWh con medidor activo o picos extremos).
  - Etiqueta `[Est]` para identificar mediciones estimadas de manera transparente.
  - Botón de acceso rápido **Excel** para descargar el mes en curso.
- **Edición, Carga y Estimación Inteligente**:
  - **Editar / Cargar Día**: Al hacer clic en cualquier fila o en el botón `+ Cargar / Estimar Día`, se abre el modal interactivo para cargar o corregir el display del medidor o el consumo diario.
  - **Asistente de Estimación**: Calcula en 1 clic la mejor proyección técnica:
    1. *Interpolación Lineal*: Divide de forma equitativa el consumo entre días anterior y posterior conocidos.
    2. *Promedio Diario del Mes*: Proyecta el consumo basándose en el comportamiento real del local.
    3. *Mismo Día Año Anterior*: Aplica la medición histórica del año previo como referencia.
  - **Autocompletar Faltantes**: El botón `✨ Autocompletar Faltantes` detecta todos los días vacíos del mes y genera una propuesta lista para confirmar y guardar en bloque.


---

### 2.4 Vista 3: Carga Masiva por Lote de Texto
Herramienta para backfilling, períodos de prueba o corrección de semanas completas:
1. Dirigite a la pestaña **Carga Masiva**.
2. Pegá en el cuadro de texto los registros (uno por línea).
3. **Formatos aceptados**:
   - Separado por comas: `MTD, 2026-10-10, 27550.0`
   - Copiado directo desde celdas de Excel (separado por tabulación): `MTD    2026-10-10    27550.0`
   - Formato de fecha flexible: `AAAA-MM-DD` o `DD/MM/AAAA`.
   - Admite punto o coma decimal (`27550.0` o `27550,0`).
4. **Previsualización en Vivo**: La tabla inferior valida local por local, marcando en verde las líneas correctas y en rojo las inválidas con el motivo exacto del error.
5. Presioná **Importar Lecturas Válidas**: Se ejecutan las inserciones (UPSERT) en Supabase y los triggers de base de datos recalculan en cascada los consumos de cada fecha y de los días posteriores.

---

### 2.5 Vista 4: Exportación de Informes Excel (.xlsx)
Generación de reportes ejecutivos listos para enviar a gerencia:
- **Alcance**: Podés exportar toda la red (libro completo) o un local puntual.
- **Estructura del Libro Excel generado**:
  - **Hoja 1 (`Resumen Red`)**: Scorecard gerencial con totales por local, comparativa contra 2025, consumo meta y estado de cumplimiento.
  - **Hojas 2 a 6 (`AR3`, `AR6`, `DEN`, `DEV`, `MTD`)**: Desglose diario detallado (Días 1 al 31) con lectura cruda del display, kWh procesados, consumo diario y estado.
- **Auditoría de Omisiones**: Los días que no se registraron se destacan en **fondo rojo suave y texto rojo**, aplicando la interpolación equitativa del salto de carga para no distorsionar las métricas.
- **Meta Corporativa del -3%**: Evalúa de forma automática si cada día y el total mensual cumplieron la meta de reducción del 3% respecto a 2025 (`Consumo 2025 × 0.97`), etiquetando `CUMPLE` en verde o `NO CUMPLE` en rojo.

---

## 3. Especificaciones Técnicas de Locales y Medidores

| Código | Local McDonald's | Modelo de Medidor | Factor Multiplicador (TC) | Tipo de Medición |
|---|---|---|---|---|
| **AR3** | McDonald's AR3 | Schneider PM5350 | **x1.0000** | Lectura Directa en kWh |
| **AR6** | McDonald's AR6 | Circutor CVM-C10 | **x1.0000** | Lectura Directa en kWh |
| **DEN** | McDonald's DEN | Circutor CVM-C10 | **x40.0000** | Transformador Corriente (TC) |
| **DEV** | McDonald's DEV | Schneider PM5350 | **x40.0000** | Transformador Corriente (TC) |
| **MTD** | McDonald's MTD | Schneider PM5350 | **x60.0000** | Transformador Corriente (TC) |

### Regla de Procesamiento en Base de Datos:
$$\text{kwh\_reading} = \text{display\_value} \times \text{meter\_multiplier}$$
$$\text{calculated\_consumption} = \text{kwh\_reading}_{\text{hoy}} - \text{kwh\_reading}_{\text{anterior}}$$
- En la interfaz de carga siempre se muestra el `display_value` (dato crudo) como referencia para el técnico.
- En la base de datos se almacena tanto el `display_value` como el `kwh_reading` y el `calculated_consumption`.
- Saltos mayores a 4 días sin carga se marcan como lectura base (`is_reset = true`) para evitar imputar semanas enteras a un solo día.

---

## 4. Instalación como PWA en Dispositivos Móviles

### En Dispositivos Android (Chrome / Edge)
1. Abrir la URL de la aplicación.
2. Tocar el botón emergente inferior **Instalar** o los tres puntos del navegador > *Instalar aplicación*.
3. La aplicación se añadirá al cajón de aplicaciones y funcionará en pantalla completa.

### En Dispositivos Apple (iPhone / iPad - Safari)
1. Abrir la URL de la aplicación en **Safari**.
2. Tocar el botón **Compartir** (icono de cuadrado con flecha hacia arriba en la barra inferior).
3. Desplazar hacia abajo y seleccionar **"Agregar al inicio"** (o *"Add to Home Screen"*).
4. Asignar el nombre `McEnergy` y presionar **Agregar**.
5. Al abrirla desde la pantalla de inicio, se ejecutará en modo standalone nativo sin barra de navegador y el aviso de instalación no volverá a aparecer.

---

## 5. Módulos de Inteligencia Artificial (Gemini Flash)

McEnergy integra la suite de modelos Gemini Flash (versión configurable 3.5 con fallback automático) en el backend para agilizar la operación y asistir al equipo técnico y de coordinación:

### 5.1 Escaneo Óptico (OCR) del Display del Medidor (`/`)
- En el formulario diario de carga, el botón **Escanear con IA** permite capturar una foto directa desde la cámara del celular o seleccionar de la galería.
- El modelo analiza la pantalla de equipos Schneider PM5350 y Circutor CVM-C10, identificando el código de energía activa (`1.8.0` / `kWh`).
- Devuelve la cifra detectada con nivel de certeza e inserta el valor en el campo de carga para confirmación del técnico (manteniendo validación humana).

### 5.2 Parser de Mensajes de WhatsApp y Notas en Carga Masiva (`/dashboard`)
- En la pestaña **Carga Masiva**, el botón **Estructurar con IA** permite pegar textos informales o mensajes de chat de guardia.
- Gemini extrae el local, fecha y lectura normalizándolos en el formato estándar `LOCAL, AAAA-MM-DD, VALOR` para importar directamente en lote.

### 5.3 Auditoría y Recomendaciones Ejecutivas (`/comparison`)
- En la vista comparativa interanual, el botón **Auditoría IA** genera un diagnóstico técnico del mes analizando totales, variaciones interanuales, desvíos y consumos anómalos.
- Proporciona hallazgos críticos y recomendaciones de mantenimiento preventivo (revisión de cámaras frigoríficas, iluminación o transformadores de corriente), con botones para copiar o compartir por WhatsApp con gerencia.

### 5.4 McEnergy Copilot (Asistente Técnico 24/7)
- Botón flotante accesible desde cualquier pantalla.
- Responde consultas sobre especificaciones de medidores, factores TC por local, procedimientos ante reemplazo de equipos (`is_reset`) y dudas de operación.

