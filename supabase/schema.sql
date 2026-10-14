-- ==============================================================================
-- SCHEMA ELÉCTRICO: MCDONALD'S CONTROL DE MEDIDORES Y COMPARATIVA ANUAL
-- Engine: PostgreSQL 15+ (Supabase)
-- ==============================================================================

-- 1. TABLA: stores (Locales y Especificaciones Técnicas del Medidor)
CREATE TABLE IF NOT EXISTS public.stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(10) UNIQUE NOT NULL CHECK (code = UPPER(code)),
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT true NOT NULL,
    meter_model TEXT,
    display_indicator TEXT DEFAULT 'kWh',
    meter_multiplier NUMERIC(10, 4) DEFAULT 1.0000 CHECK (meter_multiplier > 0),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 2. TABLA: meter_readings (Lecturas Diarias y Consumo Calculado)
CREATE TABLE IF NOT EXISTS public.meter_readings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE NOT NULL,
    reading_date DATE NOT NULL,
    display_value NUMERIC(14, 3) NOT NULL CHECK (display_value >= 0),
    applied_multiplier NUMERIC(10, 4) DEFAULT 1.0000 NOT NULL CHECK (applied_multiplier > 0),
    kwh_reading NUMERIC(16, 3) NOT NULL CHECK (kwh_reading >= 0),
    is_reset BOOLEAN DEFAULT false NOT NULL,
    calculated_consumption NUMERIC(14, 3) CHECK (calculated_consumption IS NULL OR calculated_consumption >= 0),
    reading_days INT DEFAULT 1 NOT NULL CHECK (reading_days >= 1),
    is_estimated BOOLEAN DEFAULT false NOT NULL,
    notes TEXT,
    technician_name VARCHAR(120),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT uq_meter_readings_store_date UNIQUE (store_id, reading_date)
);

-- Índices de rendimiento para consultas y comparativa temporal
CREATE INDEX IF NOT EXISTS idx_meter_readings_store_date ON public.meter_readings(store_id, reading_date DESC);
CREATE INDEX IF NOT EXISTS idx_meter_readings_date ON public.meter_readings(reading_date);

-- 3. FUNCIONES Y TRIGGERS DE CÁLCULO AUTOMÁTICO
CREATE OR REPLACE FUNCTION public.process_meter_reading_calculation()
RETURNS TRIGGER AS $$
DECLARE
    v_multiplier NUMERIC(10, 4);
    v_prev_reading RECORD;
    v_day_diff INT;
BEGIN
    -- Obtener multiplicador configurado en el local si no se especificó o es por defecto
    IF NEW.applied_multiplier IS NULL OR NEW.applied_multiplier = 1.0000 THEN
        SELECT COALESCE(meter_multiplier, 1.0000) INTO v_multiplier
        FROM public.stores
        WHERE id = NEW.store_id;

        NEW.applied_multiplier := COALESCE(v_multiplier, 1.0000);
    END IF;

    -- Calcular lectura acumulada en kWh (Display * Multiplicador)
    NEW.kwh_reading := ROUND(NEW.display_value * NEW.applied_multiplier, 3);
    NEW.updated_at := now();

    -- Si está marcada como reset / lectura base
    IF NEW.is_reset THEN
        NEW.calculated_consumption := NULL;
        NEW.reading_days := 1;
        RETURN NEW;
    END IF;

    -- Cálculo de consumo frente a la lectura previa cronológica
    SELECT reading_date, kwh_reading INTO v_prev_reading
    FROM public.meter_readings
    WHERE store_id = NEW.store_id
      AND reading_date < NEW.reading_date
    ORDER BY reading_date DESC
    LIMIT 1;

    IF v_prev_reading IS NOT NULL THEN
        v_day_diff := NEW.reading_date - v_prev_reading.reading_date;

        -- Si el salto es mayor a 4 días (ej. semanas sin cargar), se toma como nueva lectura base
        IF v_day_diff > 4 THEN
            NEW.is_reset := true;
            NEW.calculated_consumption := NULL;
            NEW.reading_days := 1;
        ELSE
            NEW.calculated_consumption := GREATEST(0, ROUND(NEW.kwh_reading - v_prev_reading.kwh_reading, 3));
            NEW.reading_days := GREATEST(1, v_day_diff);
        END IF;
    ELSE
        NEW.is_reset := true;
        NEW.calculated_consumption := NULL;
        NEW.reading_days := 1;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_process_meter_reading_calculation ON public.meter_readings;
CREATE TRIGGER trg_process_meter_reading_calculation
BEFORE INSERT OR UPDATE ON public.meter_readings
FOR EACH ROW EXECUTE FUNCTION public.process_meter_reading_calculation();

-- Trigger complementario: Recalcular la lectura POSTERIOR si se inserta/actualiza una lectura intermedia
CREATE OR REPLACE FUNCTION public.recalculate_subsequent_reading()
RETURNS TRIGGER AS $$
DECLARE
    v_next_id UUID;
    v_next_kwh NUMERIC(16, 3);
    v_next_date DATE;
    v_next_is_reset BOOLEAN;
BEGIN
    SELECT id, kwh_reading, reading_date, is_reset
    INTO v_next_id, v_next_kwh, v_next_date, v_next_is_reset
    FROM public.meter_readings
    WHERE store_id = NEW.store_id
      AND reading_date > NEW.reading_date
    ORDER BY reading_date ASC
    LIMIT 1;

    IF v_next_id IS NOT NULL AND NOT v_next_is_reset THEN
        UPDATE public.meter_readings
        SET calculated_consumption = GREATEST(0, ROUND(v_next_kwh - NEW.kwh_reading, 3)),
            reading_days = GREATEST(1, v_next_date - NEW.reading_date),
            updated_at = now()
        WHERE id = v_next_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recalculate_subsequent_reading ON public.meter_readings;
CREATE TRIGGER trg_recalculate_subsequent_reading
AFTER INSERT OR UPDATE OF kwh_reading, display_value ON public.meter_readings
FOR EACH ROW EXECUTE FUNCTION public.recalculate_subsequent_reading();

-- 4. VISTA: Comparativa Diaria con el Año Anterior
CREATE OR REPLACE VIEW public.v_meter_readings_comparison AS
SELECT 
    curr.id AS reading_id,
    curr.store_id,
    s.code AS store_code,
    s.name AS store_name,
    s.meter_model,
    curr.reading_date,
    curr.display_value,
    curr.applied_multiplier,
    curr.kwh_reading,
    curr.calculated_consumption AS consumption_today,
    curr.is_reset,
    curr.technician_name,
    curr.notes,
    -- Datos del mismo día del año anterior (intervalo de 1 año)
    prev.reading_date AS prev_year_date,
    prev.calculated_consumption AS consumption_prev_year,
    (curr.calculated_consumption - prev.calculated_consumption) AS diff_kwh,
    CASE 
        WHEN prev.calculated_consumption > 0 THEN 
            ROUND(((curr.calculated_consumption - prev.calculated_consumption) / prev.calculated_consumption * 100), 2)
        ELSE NULL 
    END AS diff_percentage
FROM public.meter_readings curr
JOIN public.stores s ON curr.store_id = s.id
LEFT JOIN public.meter_readings prev ON 
    curr.store_id = prev.store_id 
    AND prev.reading_date = (curr.reading_date - INTERVAL '1 year')::DATE;

-- 5. POLÍTICAS RLS (Sin barrera de login para acceso ágil mobile-first)
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meter_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read stores" ON public.stores;
CREATE POLICY "Public read stores" ON public.stores
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public write stores" ON public.stores;
CREATE POLICY "Public write stores" ON public.stores
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public read meter_readings" ON public.meter_readings;
CREATE POLICY "Public read meter_readings" ON public.meter_readings
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public write meter_readings" ON public.meter_readings;
CREATE POLICY "Public write meter_readings" ON public.meter_readings
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 6. SEMILLAS: Los 5 Locales con sus Especificaciones de Medidores
INSERT INTO public.stores (code, name, is_active, meter_model, display_indicator, meter_multiplier) VALUES
('AR6', 'McDonald''s AR6', true, 'Circutor CVM-C10', 'kWh', 1.0000),
('AR3', 'McDonald''s AR3', true, 'Schneider PM5350', 'kWh', 1.0000),
('MTD', 'McDonald''s MTD', true, 'Schneider PM5350', '1.8.0', 60.0000),
('DEV', 'McDonald''s DEV', true, 'Schneider PM5350', '1.8.0', 40.0000),
('DEN', 'McDonald''s DEN', true, 'Circutor CVM-C10', 'Active Energy', 40.0000)
ON CONFLICT (code) DO UPDATE
SET meter_model = EXCLUDED.meter_model,
    display_indicator = EXCLUDED.display_indicator,
    meter_multiplier = EXCLUDED.meter_multiplier,
    is_active = EXCLUDED.is_active;

-- 7. TABLA: app_config & FUNCIÓN DE ACCESO AL DASHBOARD
CREATE TABLE IF NOT EXISTS public.app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read app_config" ON public.app_config;
CREATE POLICY "Public read app_config" ON public.app_config
    FOR SELECT TO anon, authenticated USING (key != 'dashboard_pin');

INSERT INTO public.app_config (key, value, description)
VALUES ('dashboard_pin', '2026', 'Clave de acceso para Coordinador y Administrador')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.verify_dashboard_pin(pin_input TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.app_config
        WHERE key = 'dashboard_pin' AND value = TRIM(pin_input)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.verify_dashboard_pin(TEXT) TO anon, authenticated;

